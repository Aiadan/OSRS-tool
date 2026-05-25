// Shared utilities for the OSRS Tool.
//
// Exports a single window.TO namespace consumed by wc-fletch-fm.js and
// fish-cook.js. Owns:
//   - The hash-based router (#/, #/wc-fletch-fm, #/fish-cook).
//   - Section persistence (training-optimizer:last-section).
//   - Shared hiscores lookup (one RSN, fills all section inputs).
//   - Formatting helpers, clamp helpers, sort compare, Chart.js common opts.
//   - A dormant WikiSync WebSocket client kept here for future tools.

window.TO = (function () {
  'use strict';

  // ---- Storage keys ------------------------------------------------------

  const KEY_LAST_SECTION = 'training-optimizer:last-section';
  const KEY_RSN          = 'training-optimizer:rsn';
  const KEY_SKILL_XP     = 'training-optimizer:skill-xp';
  const KEY_LEGACY_V1    = 'training-optimizer:v1';   // pre-multisection storage
  const VALID_SECTIONS   = new Set(['wc-fletch-fm', 'fish-cook', 'thieving']);

  // ---- OSRS XP table ----------------------------------------------------
  // Standard cumulative-XP table: XP_TABLE[L] = experience required to reach
  // level L (1..99). Used for overtake projections — given the user's current
  // raw XP from hiscores, work out how much more they need for the next
  // method-overtake threshold.
  const XP_TABLE = (() => {
    const t = new Array(100);
    t[1] = 0;
    let total = 0;
    for (let L = 1; L < 99; L++) {
      total += Math.floor(L + 300 * Math.pow(2, L / 7));
      t[L + 1] = Math.floor(total / 4);
    }
    return t;
  })();
  function xpAt(level) {
    if (level < 1) return 0;
    if (level > 99) return XP_TABLE[99];
    return XP_TABLE[level];
  }
  function levelForXp(xp) {
    for (let L = 99; L >= 1; L--) {
      if (XP_TABLE[L] <= xp) return L;
    }
    return 1;
  }

  // Per-skill raw XP cache — written by the hiscores fetch (which reads the
  // third comma-separated field per skill line), consumed by the section
  // modules' overtake projections. Falls back to the minimum XP for the
  // currently-displayed level when the user has manually edited the level
  // since the last hiscores lookup (so the cached XP no longer matches).
  function loadSkillXpMap() {
    try { return JSON.parse(localStorage.getItem(KEY_SKILL_XP) || '{}'); }
    catch (e) { return {}; }
  }
  function saveSkillXpMap(obj) {
    try { localStorage.setItem(KEY_SKILL_XP, JSON.stringify(obj)); }
    catch (e) {}
  }
  function getSkillXp(inputId) {
    const el = document.getElementById(inputId);
    if (!el) return 0;
    const lvl = Math.max(1, Math.min(99, parseInt(el.value, 10) || 1));
    const stored = loadSkillXpMap()[inputId];
    if (stored != null && levelForXp(stored) === lvl) return stored;
    return xpAt(lvl);
  }

  // ---- Formatting --------------------------------------------------------

  function fmt(n, opts = {}) {
    if (n == null || !isFinite(n)) return '—';
    const { decimals = 0, suffix = '' } = opts;
    return n.toLocaleString(undefined, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals
    }) + suffix;
  }

  function fmtPct(n) {
    if (n == null || !isFinite(n)) return '—';
    return (n * 100).toFixed(1) + '%';
  }

  function fmtTime(seconds) {
    if (!isFinite(seconds)) return '—';
    if (seconds < 60) return seconds.toFixed(1) + 's';
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return `${m}m ${s}s`;
  }
  // "1h 24m" style for the overtake projections — different cadence from
  // fmtTime above which is per-action ("11.1s", "2m 30s").
  function fmtDuration(hours) {
    if (!isFinite(hours) || hours < 0) return '—';
    if (hours < 1 / 60) return '<1m';
    if (hours < 1) return `${Math.round(hours * 60)}m`;
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    if (m === 60) return `${h + 1}h`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }

  function clampInt(id, lo, hi) {
    const el = document.getElementById(id);
    const v = parseInt(el.value, 10);
    if (Number.isNaN(v)) return parseInt(el.defaultValue, 10);
    return Math.max(lo, Math.min(hi, v));
  }

  function clampFloat(id, lo, hi) {
    const el = document.getElementById(id);
    const v = parseFloat(el.value);
    if (Number.isNaN(v)) return parseFloat(el.defaultValue);
    return Math.max(lo, Math.min(hi, v));
  }

  function setStatus(el, text, cls) {
    if (!el) return;
    el.textContent = text;
    el.className = 'status' + (cls ? ' ' + cls : '');
  }

  // Generic compare for sort-state objects { sortFields: { key: value } }.
  function compareBy(a, b, key) {
    const av = a.sortFields[key];
    const bv = b.sortFields[key];
    if (av === bv) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv);
    return av < bv ? -1 : 1;
  }

  // ---- Chart.js shared options ------------------------------------------

  function chartCommon(extra) {
    return Object.assign({
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 200 },
      // `mode: 'nearest'` + `intersect: false` + `axis: 'xy'` makes the
      // tooltip latch onto the closest line by Euclidean distance, so you
      // get a hit anywhere near a curve — not just on the vertices. Works
      // the same for bar charts (the closest bar wins).
      interaction: { mode: 'nearest', intersect: false, axis: 'xy' },
      hover:       { mode: 'nearest', intersect: false, axis: 'xy' },
      plugins: {
        legend: { labels: { color: '#e8e7e3' } },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${fmt(ctx.parsed.y)} XP/h`
          }
        }
      }
    }, extra || {});
  }

  function axisOpts(extra) {
    return Object.assign({
      ticks: { color: '#9a9890' },
      grid: { color: 'rgba(255,255,255,0.06)' }
    }, extra || {});
  }

  // ---- Section registration + router ------------------------------------

  const sections = {};   // id -> { init, render }

  function registerSection(id, mod) {
    if (!VALID_SECTIONS.has(id)) throw new Error(`unknown section id: ${id}`);
    sections[id] = mod;
  }

  function navigate(id) {
    if (id !== 'home' && !VALID_SECTIONS.has(id)) id = 'home';
    setVisibleView(id);
    // Remember the last explicitly-shown view — including 'home'. Going to the
    // index is itself a choice, so a later bare-URL load restores the index
    // rather than jumping back into a section the user already navigated away
    // from. (Key name kept for back-compat; it now holds a view, not just a
    // section. 'home' isn't a VALID_SECTION, so restore falls through to index.)
    try { localStorage.setItem(KEY_LAST_SECTION, id); } catch (e) {}
    const homeLink = document.getElementById('home-link');
    if (homeLink) homeLink.style.visibility = (id === 'home') ? 'hidden' : 'visible';
  }

  function setVisibleView(id) {
    document.querySelectorAll('.view').forEach(el => {
      const isMatch = (id === 'home' && el.dataset.view === 'home') || el.dataset.view === id;
      el.classList.toggle('hidden', !isMatch);
    });
  }

  function parseHash() {
    const h = (window.location.hash || '').replace(/^#\/?/, '').trim();
    if (h === '' || h === 'home') return 'home';
    return VALID_SECTIONS.has(h) ? h : 'home';
  }

  function restoreInitialView() {
    const fromHash = parseHash();
    if (fromHash !== 'home') return navigate(fromHash);
    // fromHash is 'home'. An explicit home hash (#/, #, #/home) means the user
    // deliberately went to the index — e.g. clicked "All training tools" — so
    // stay there on refresh. Only a bare URL with no hash at all (a fresh open
    // or a bookmark of the root) restores the last-viewed section.
    if ((window.location.hash || '').length > 0) return navigate('home');
    let last = null;
    try { last = localStorage.getItem(KEY_LAST_SECTION); } catch (e) {}
    if (last && VALID_SECTIONS.has(last)) {
      // Reflect the restored section in the URL. Otherwise the hash stays at
      // #/ while a section is shown, and the "All training tools" link
      // (href="#/") becomes a no-op — clicking it doesn't change the hash, so
      // no hashchange fires and the home view never loads.
      try { history.replaceState(null, '', '#/' + last); } catch (e) {}
      return navigate(last);
    }
    navigate('home');
  }

  // ---- Hiscores lookup (wiki CORS proxy) --------------------------------
  //
  // Endpoint: https://oldschool.runescape.wiki/cors/m=hiscore_oldschool/index_lite.ws?player=<RSN>
  // Response: plain text, one line per skill, "rank,level,xp" comma-separated.
  // Skill order:
  //   0  Overall      8  Cooking       16 Herblore
  //   1  Attack       9  Woodcutting   17 Agility
  //   2  Defence     10 Fletching      18 Thieving
  //   3  Strength    11 Fishing        19 Slayer
  //   4  Hitpoints   12 Firemaking     20 Farming
  //   5  Ranged      13 Crafting       21 Runecrafting
  //   6  Prayer      14 Smithing       22 Hunter
  //   7  Magic       15 Mining         23 Construction
  // Unranked skills come back as "-1,-1,-1".

  const HISCORES_URL = 'https://oldschool.runescape.wiki/cors/m=hiscore_oldschool/index_lite.ws';

  // input id -> { hiscoresIndex, label }
  const HISCORES_INPUTS = {
    'wc-level':      { idx: 9,  label: 'Woodcutting' },
    'fletch-level':  { idx: 10, label: 'Fletching' },
    'fm-level':      { idx: 12, label: 'Firemaking' },
    'fc-fish-level': { idx: 11, label: 'Fishing' },
    'fc-cook-level': { idx: 8,  label: 'Cooking' },
    'th-level':      { idx: 18, label: 'Thieving' }
  };

  // Stamp the page with the version from TRAINING_DATA.meta (single source).
  function wireVersion() {
    const el = document.getElementById('app-version');
    const v  = window.TRAINING_DATA && window.TRAINING_DATA.meta && window.TRAINING_DATA.meta.version;
    if (el && v) el.textContent = 'v' + v;
  }

  // Each section's data/calc notes live in a .banner that's collapsed by
  // default; the (i) button in the section title reveals it on demand (linked
  // by aria-controls). Wired once — the buttons exist in every view's markup.
  function wireInfoToggles() {
    document.querySelectorAll('.info-btn[aria-controls]').forEach((btn) => {
      const panel = document.getElementById(btn.getAttribute('aria-controls'));
      if (!panel) return;
      btn.addEventListener('click', () => {
        const open = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', String(open));
        panel.hidden = !open;
        if (TO.syncStickyThead) TO.syncStickyThead();
      });
    });
  }

  // Visual "in sync with hiscores" indicator on each tracked level input. A
  // field is synced when the stored hiscores XP exists AND maps back to the
  // current level value — i.e. exactly when getSkillXp() would use the real XP
  // rather than fall back to the level minimum. So the indicator tells you
  // whether the overtake projections are running on your true XP or an estimate.
  function updateSyncIndicators() {
    const xpMap = loadSkillXpMap();
    for (const inputId of Object.keys(HISCORES_INPUTS)) {
      const el = document.getElementById(inputId);
      if (!el) continue;
      const lvl    = Math.max(1, Math.min(99, parseInt(el.value, 10) || 1));
      const stored = xpMap[inputId];
      const synced = stored != null && levelForXp(stored) === lvl;
      const label  = el.closest('label');
      if (label) label.classList.toggle('xp-synced', synced);
      el.title = synced
        ? 'In sync — this level’s XP is from your last hiscores lookup.'
        : 'Not from hiscores — XP is estimated as this level’s minimum (look yourself up, or you’ve edited it since).';
    }
  }

  function wireSyncIndicators() {
    for (const inputId of Object.keys(HISCORES_INPUTS)) {
      const el = document.getElementById(inputId);
      if (!el) continue;
      el.addEventListener('input', updateSyncIndicators);
      el.addEventListener('change', updateSyncIndicators);
    }
    updateSyncIndicators();   // reflect any stored state on load
  }

  function wireHiscores() {
    const input  = document.getElementById('rsn-input');
    const btn    = document.getElementById('rsn-btn');
    if (!input || !btn) return;
    let savedRsn = '';
    try { savedRsn = localStorage.getItem(KEY_RSN) || ''; } catch (e) {}
    if (savedRsn) input.value = savedRsn;
    btn.addEventListener('click', lookupHiscores);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); lookupHiscores(); }
    });
  }

  async function lookupHiscores() {
    const input  = document.getElementById('rsn-input');
    const btn    = document.getElementById('rsn-btn');
    const status = document.getElementById('rsn-status');
    const rsn = input.value.trim();
    if (!rsn) { setStatus(status, 'Enter your in-game name first.', 'warn'); return; }

    setStatus(status, `Looking up ${rsn}…`, 'loading');
    btn.disabled = true;
    try {
      const res = await fetch(`${HISCORES_URL}?player=${encodeURIComponent(rsn)}`);
      if (!res.ok) {
        if (res.status === 404) throw new Error('player not found on hiscores');
        throw new Error(`HTTP ${res.status}`);
      }
      const text  = await res.text();
      const lines = text.trim().split(/\r?\n/);

      const applied = [], unranked = [];
      const xpMap = loadSkillXpMap();
      for (const inputId of Object.keys(HISCORES_INPUTS)) {
        const el = document.getElementById(inputId);
        if (!el) continue;
        const { idx, label } = HISCORES_INPUTS[inputId];
        const line = lines[idx];
        if (!line) { unranked.push(label); continue; }
        const parts = line.split(',');
        const lvl = parseInt(parts[1], 10);
        const xp  = parseInt(parts[2], 10);
        if (Number.isNaN(lvl) || lvl < 1) { unranked.push(label); continue; }
        el.value = Math.max(1, Math.min(99, lvl));
        if (!Number.isNaN(xp) && xp >= 0) xpMap[inputId] = xp;
        applied.push(label);
      }
      saveSkillXpMap(xpMap);

      try { localStorage.setItem(KEY_RSN, rsn); } catch (e) {}
      // Levels were set programmatically (no input event), so refresh the sync
      // indicators explicitly now that the XP map and inputs both reflect the lookup.
      updateSyncIndicators();
      // Re-render every registered section so their tables/charts pick up new levels.
      for (const id of Object.keys(sections)) {
        try { sections[id].render && sections[id].render(); } catch (e) { console.error(e); }
      }

      if (applied.length && !unranked.length) {
        setStatus(status, `Loaded levels + XP for ${rsn}.`, 'success');
      } else if (applied.length) {
        setStatus(status, `Loaded levels + XP for ${rsn}. Unranked: ${unranked.join(', ')}.`, 'warn');
      } else {
        setStatus(status, `${rsn} is unranked in the relevant skills. Use manual input.`, 'warn');
      }
    } catch (err) {
      setStatus(status, `Lookup failed: ${(err && err.message) || 'unknown error'}.`, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  // ---- Legacy localStorage migration ------------------------------------
  //
  // Pre-multisection releases stored the WC-fletch state under
  // `training-optimizer:v1`. If that's present and the new section-prefixed
  // key isn't, copy it across so returning users don't lose their inputs.
  function migrateLegacyStorage() {
    try {
      const legacy = localStorage.getItem(KEY_LEGACY_V1);
      if (!legacy) return;
      if (localStorage.getItem('training-optimizer:wc-fletch-fm:v1')) return;
      localStorage.setItem('training-optimizer:wc-fletch-fm:v1', legacy);
    } catch (e) {}
  }

  // ---- Sticky stack offsets --------------------------------------------
  // The toolbar, view-title, inputs card and table thead are four stacked
  // sticky bars. Each one's `top` must equal the combined height of the bars
  // above it — but those heights change with viewport width (the input grid
  // wraps to extra rows on narrower windows) and with content (RSN status
  // text, web-font swap). Hard-coding the offsets in rem (the old approach)
  // only lined up at one specific width; anywhere the toolbar/inputs wrapped,
  // the thead floated out of place. Instead we measure the *visible* section's
  // stack live and publish the offsets as CSS custom properties; the
  // stylesheet consumes them with the old fixed rems kept as no-JS fallbacks.
  function updateStickyOffsets() {
    const h = (el) => el ? el.getBoundingClientRect().height : 0;
    const toolbarH = h(document.querySelector('.top-toolbar'));
    const section  = document.querySelector('.view:not(.hidden)');
    const titleH   = section ? h(section.querySelector('.view-title')) : 0;
    const inputsH  = section ? h(section.querySelector('.view-flex .inputs.card')) : 0;
    const root = document.documentElement.style;
    root.setProperty('--sticky-title-top',  Math.round(toolbarH) + 'px');
    root.setProperty('--sticky-inputs-top', Math.round(toolbarH + titleH) + 'px');
    root.setProperty('--sticky-thead-top',  Math.round(toolbarH + titleH + inputsH) + 'px');
  }

  // ---- Sticky thead release --------------------------------------------
  // CSS `position: sticky` on a table's `thead` should release once the
  // table's bottom edge passes the sticky top, but browsers don't agree
  // on the containing block for `display: table-header-group`, so the
  // header often hangs around above the card's hint text after the last
  // row has scrolled past. This watcher toggles a `thead-released` class
  // on each visible table when its tbody bottom rises above the would-be
  // sticky bottom edge; CSS then switches that thead back to `static`.
  function wireStickyTheadRelease() {
    // Cache each table's measured sticky-top so we don't clear inline styles
    // to re-measure on every scroll. Dropped wholesale by refresh() whenever
    // the offsets change. `null` cached value = thead isn't sticky right now
    // (mobile / narrow-width safeguard), so there's nothing to release.
    let stickyTopCache = new WeakMap();
    const measureStickyTop = (thead) => {
      const prevPos = thead.style.position;
      const prevTop = thead.style.top;
      thead.style.position = '';
      thead.style.top = '';
      const cs = getComputedStyle(thead);
      const px = cs.position === 'sticky' ? (parseFloat(cs.top) || 0) : null;
      thead.style.position = prevPos;
      thead.style.top = prevTop;
      return px;
    };
    const clearRelease = (table, thead) => {
      if (table.classList.contains('thead-released')) {
        thead.style.position = '';
        thead.style.top = '';
        table.classList.remove('thead-released');
      }
    };
    const sync = () => {
      document.querySelectorAll('table').forEach((table) => {
        const tbody = table.querySelector('tbody');
        const thead = table.querySelector('thead');
        const lastRow = tbody && tbody.lastElementChild;
        if (!tbody || !thead || !lastRow) return;
        let stickyTopPx = stickyTopCache.get(table);
        if (stickyTopPx === undefined) {
          stickyTopPx = measureStickyTop(thead);
          stickyTopCache.set(table, stickyTopPx);
        }
        // thead isn't sticky (mobile/safeguard breakpoint) — it scrolls with
        // the table, so undo any stale release state and leave it alone.
        if (stickyTopPx === null) { clearRelease(table, thead); return; }
        const lastRowTop = lastRow.getBoundingClientRect().top;
        // Release the moment the thead's bottom edge would otherwise start
        // covering the last row. After release we pin the thead at that
        // exact viewport position with `position: relative`, so further
        // scrolling lets it scroll out naturally with the table instead of
        // snapping away.
        const released = lastRowTop < stickyTopPx + thead.offsetHeight;
        const wasReleased = table.classList.contains('thead-released');
        if (released) {
          if (!wasReleased) {
            const tableTop = table.getBoundingClientRect().top;
            thead.style.position = 'relative';
            thead.style.top = `${stickyTopPx - tableTop}px`;
            table.classList.add('thead-released');
          }
        } else if (wasReleased) {
          clearRelease(table, thead);
        }
      });
    };
    // The wide multi-column tables can't fit on narrower viewports. Rather
    // than let them spill past the card (and force a page-wide horizontal
    // scrollbar), turn the wrap into its own horizontal scroll container when
    // its table overflows. A scroll container can't host a viewport-sticky
    // thead (the browser would anchor the sticky thead to the wrap), so CSS
    // drops that table's thead to `static` while `is-scrolling` is set — the
    // release logic then sees a non-sticky thead and leaves it alone.
    // A wrap's own scrollbar sits at the bottom of the (possibly tall) table,
    // so you'd have to scroll the whole table down to reach it. Instead give
    // each scrolling wrap a slim proxy scrollbar pinned to the viewport bottom
    // (CSS `.hscroll`) whose scroll position is mirrored to/from the wrap, so
    // sideways scrolling is reachable whenever the table is on screen. The
    // wrap's native bar is hidden in CSS to avoid a redundant second one.
    const ensureHScroll = (wrap) => {
      if (wrap._hscroll) return wrap._hscroll;
      const proxy = document.createElement('div');
      proxy.className = 'hscroll';
      proxy.setAttribute('aria-hidden', 'true');
      proxy.appendChild(document.createElement('div'));   // width spacer
      wrap.insertAdjacentElement('afterend', proxy);
      let lock = false;
      const link = (from, to) => from.addEventListener('scroll', () => {
        if (lock) return;
        lock = true;
        to.scrollLeft = from.scrollLeft;
        requestAnimationFrame(() => { lock = false; });
      }, { passive: true });
      link(proxy, wrap);
      link(wrap, proxy);
      wrap._hscroll = proxy;
      return proxy;
    };
    const syncTableScroll = () => {
      document.querySelectorAll('.table-wrap').forEach((wrap) => {
        const table = wrap.querySelector('table');
        if (!table) return;
        // A hidden overflow-x scrollbar never changes clientWidth, so the
        // comparison is stable and won't oscillate.
        const overflowing = table.scrollWidth > wrap.clientWidth + 1;
        wrap.classList.toggle('is-scrolling', overflowing);
        const proxy = ensureHScroll(wrap);
        proxy.hidden = !overflowing;
        if (overflowing) {
          proxy.firstChild.style.width = table.scrollWidth + 'px';
          proxy.scrollLeft = wrap.scrollLeft;   // keep aligned after a resize
        }
      });
    };
    // Recompute offsets, set each table's scroll mode (which fixes thead
    // sticky/static), drop the now-stale per-table cache, then re-evaluate the
    // release state.
    const refresh = () => {
      updateStickyOffsets();
      syncTableScroll();
      stickyTopCache = new WeakMap();
      sync();
    };
    window.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', refresh);
    // Any size change in the sticky stack or the tables — toolbar wrap, RSN
    // status text, input-grid reflow, font swap, a section switch, or a table
    // re-render changing its width — must recompute offsets and scroll mode.
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => refresh());
      document.querySelectorAll('.top-toolbar, .view-title, .view-flex .inputs.card, .table-wrap, table')
        .forEach((el) => ro.observe(el));
    }
    refresh();                       // initial offsets + state
    requestAnimationFrame(refresh);  // again once layout/fonts settle
    // Also expose so section renders can call it after tbody rebuilds.
    TO.syncStickyThead = sync;
  }

  // ---- Init -------------------------------------------------------------

  function init() {
    migrateLegacyStorage();
    wireVersion();
    wireInfoToggles();
    wireHiscores();
    wireStickyTheadRelease();

    // Each section module attaches its own listeners and renders once. Both
    // sections initialise even if their view is hidden so a later switch is
    // instant and a hiscores lookup can re-render either side.
    for (const id of Object.keys(sections)) {
      try { sections[id].init && sections[id].init(); } catch (e) { console.error(e); }
    }

    // Sync indicators after sections have set their stored level values.
    wireSyncIndicators();

    // React to back/forward and to hash typed into the address bar. navigate()
    // records the chosen view (including home) as the last explicit choice.
    window.addEventListener('hashchange', () => navigate(parseHash()));

    restoreInitialView();
  }

  // IMPORTANT: must run AFTER wc-fletch-fm.js and fish-cook.js have called
  // TO.registerSection. All four scripts are `defer`, which means
  // DOMContentLoaded fires after they've all executed. If the document is
  // already past that point, init() runs immediately.
  if (document.readyState === 'complete') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

  // ---- WikiSync import (DORMANT) ----------------------------------------
  //
  // Kept here as a reference implementation for future tools. Not wired to
  // any UI in this tool — WikiSync's GetPlayer payload omits the gathering
  // and processing skills we care about. To revive: add #wikisync-btn /
  // #wikisync-status to index.html and call TO._wireWikiSync().
  //
  // Protocol (from weirdgloop/WikiSync source as of 2026-05):
  //   - Server listens on ws://127.0.0.1:<port>/ where port is in [37767, 37776].
  //     Only one port is active at a time; the plugin tries them in order.
  //   - On connect the server immediately sends:
  //       {"_wsType":"UsernameChanged","username":"<name or null>"}
  //   - Client sends:
  //       {"_wsType":"GetPlayer","sequenceId":<int>}
  //   - Server replies:
  //       {"_wsType":"GetPlayer","sequenceId":<id>,"payload":{loadouts:[{...,
  //          skills:{atk,def,hp,magic,mining,prayer,ranged,str}, ...}]}}
  //   - Allowed origins: localhost, dps.osrs.wiki, tools.runescape.wiki.
  //     `file://` is rejected — must be served from http://localhost.

  const WIKISYNC_PORT_MIN = 37767;
  const WIKISYNC_PORT_MAX = 37776;
  const WIKISYNC_PORT_TIMEOUT_MS = 1500;

  async function connectAnyPort() {
    let lastErr = null;
    for (let port = WIKISYNC_PORT_MIN; port <= WIKISYNC_PORT_MAX; port++) {
      try { return await connectOnePort(port); }
      catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('no WikiSync port reachable');
  }

  function connectOnePort(port) {
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(`ws://localhost:${port}/`); }
      catch (e) { reject(e); return; }
      const sequenceId = Math.floor(Math.random() * 0x7fffffff);
      let username = null, settled = false;
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { ws.close(); } catch (e) {}
        fn(arg);
      };
      const timer = setTimeout(() => finish(reject, new Error(`port ${port}: timeout`)), WIKISYNC_PORT_TIMEOUT_MS);
      ws.onopen = () => {
        try { ws.send(JSON.stringify({ _wsType: 'GetPlayer', sequenceId })); }
        catch (e) { finish(reject, e); }
      };
      ws.onmessage = (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg && msg._wsType === 'UsernameChanged') username = msg.username || null;
        else if (msg && msg._wsType === 'GetPlayer' && msg.sequenceId === sequenceId) {
          finish(resolve, { username, payload: msg.payload });
        }
      };
      ws.onerror = () => finish(reject, new Error(`port ${port}: error`));
      ws.onclose = (ev) => { if (!settled) finish(reject, new Error(`port ${port}: closed (code ${ev.code})`)); };
    });
  }

  // ---- Public API -------------------------------------------------------

  return {
    fmt, fmtPct, fmtTime, fmtDuration,
    clampInt, clampFloat,
    setStatus, compareBy,
    chartCommon, axisOpts,
    registerSection, navigate,
    xpAt, levelForXp, getSkillXp,
    _wikiSync: { connectAnyPort, connectOnePort }
  };
})();
