// Thieving section. Two activities switched by the toggle at the top:
//   - Pickpocketing: per-target success curve (same {{Skilling success chart}}
//     interpolation as the fishing data), attempt every 2 ticks, an 8-tick
//     stun on failure. Gear (gloves/cape/Ardougne) multiplies the curve.
//   - Stalls: 100% success above the level req; XP/h gated by respawn time.
// Both rec cells (best pickpocket + best stall) are always shown so you can
// compare the two activities at a glance; the table/charts follow the toggle.

(function () {
  'use strict';

  const SECTION = window.TRAINING_DATA.sections['thieving'];
  const PICK    = SECTION.pickpocket;
  const STALLS  = SECTION.stalls.entries;
  const GEAR    = SECTION.gear;

  const STORAGE_KEY = 'training-optimizer:thieving:v1';

  let mode = 'pickpocket';          // 'pickpocket' | 'stalls'
  let sortKey = 'xpPerHour';
  let sortDir = 'desc';
  let excludedIds = new Set();
  let barChart = null;
  let lineChart = null;
  let initialized = false;

  // Same interpolation the fishing/cooking success curves use.
  function interp(low, high, level) {
    const lvl = Math.max(1, level);
    const value = Math.floor(low * (99 - lvl) / 98 + high * (lvl - 1) / 98 + 0.5) + 1;
    return Math.max(0, Math.min(1, value / 256));
  }

  function gearMult(gear) {
    let m = 1;
    for (const g of GEAR) if (gear[g.id]) m *= g.mult;
    return m;
  }

  // ---- Pure calc -------------------------------------------------------

  function pickRates(t, level, mult, efficiency) {
    const eligible = level >= t.level;
    const p = interp(t.success.low * mult, t.success.high * mult, level);   // already clamped 0..1
    const cycleSec = PICK.attemptSec + (1 - p) * PICK.stunSec;
    return {
      eligible,
      successPct:   eligible ? p : 0,
      secPerAction: eligible && p > 0 ? cycleSec / p : Infinity,
      xpPerAction:  eligible ? p * t.xp : 0,
      xpPerHour:    eligible ? (p * t.xp / cycleSec) * 3600 * efficiency : 0
    };
  }

  function stallRates(s, level, efficiency) {
    const eligible = level >= s.level;
    return {
      eligible,
      successPct: 1,
      xpPerHour:  eligible ? (s.xp / s.respawn) * 3600 * efficiency : 0
    };
  }

  // For a method the player can't do yet, project its rates at the level it
  // unlocks (its `level` req) — where the same rate function reports real
  // values — so the table shows what it would yield then instead of a flat 0.
  // `rates.eligible` stays false, so projected rows are never picked as a rec.
  function unlockProjection(item, forMode, mult, efficiency) {
    const r = forMode === 'pickpocket'
      ? pickRates(item, item.level, mult, efficiency)
      : stallRates(item, item.level, efficiency);
    return { level: item.level, rates: r };
  }

  function buildRows(forMode, inputs) {
    const mult  = gearMult(inputs.gear);
    const items = forMode === 'pickpocket' ? PICK.targets : STALLS;
    return items.map(item => {
      const r = forMode === 'pickpocket'
        ? pickRates(item, inputs.level, mult, inputs.efficiency)
        : stallRates(item, inputs.level, inputs.efficiency);
      const projection = !r.eligible
        ? unlockProjection(item, forMode, mult, inputs.efficiency)
        : null;
      const disp = projection ? projection.rates : r;
      return {
        item, rates: r, projection,
        sortFields: {
          name: item.name.toLowerCase(),
          level: item.level,
          successPct: disp.successPct,
          xpPerAction: disp.xpPerAction || 0,
          xpEach: item.xp,
          respawn: item.respawn || 0,
          xpPerHour: disp.xpPerHour
        }
      };
    });
  }

  function bestRow(rows) {
    const e = rows.filter(r => r.rates.eligible && !excludedIds.has(r.item.id));
    if (!e.length) return null;
    return e.reduce((b, c) => c.rates.xpPerHour > b.rates.xpPerHour ? c : b);
  }

  // ---- Columns per activity --------------------------------------------

  // XP/h cell: dimmed "(@ lvl N)" suffix when the value is projected at the
  // method's unlock level rather than the player's current level.
  function xpHourCell(r, d) {
    const v = TO.fmt(d.xpPerHour);
    return r.projection
      ? `${v} <span class="ot-dim">(@ lvl ${r.projection.level})</span>`
      : v;
  }

  function columnsFor(activity, dm, mult, level) {
    if (activity === 'pickpocket') {
      return [
        { key: 'name',        label: 'Target' },
        { key: 'level',       label: 'Lvl',         numeric: true, cell: (r, d) => r.item.level },
        { key: 'successPct',  label: dm === 'seconds' ? 'Time / steal' : 'Success', numeric: true,
          cell: (r, d) => {
            const full = TO.fullSuccessLevel(L => interp(r.item.success.low * mult, r.item.success.high * mult, L), r.item.level);
            const cap99 = interp(r.item.success.low * mult, r.item.success.high * mult, 99);
            const note = TO.actionNote({
              levelAtFull: full,
              floorSeconds: PICK.attemptSec,
              capChance: cap99,
              capSeconds: PICK.attemptSec / cap99,
              currentLevel: level
            });
            return `${TO.fmtActionRate(d.successPct, d.secPerAction)}${note ? `<span class="success-note">${note}</span>` : ''}`;
          } },
        { key: 'xpPerAction', label: 'XP / action', numeric: true, cell: (r, d) => TO.fmt(d.xpPerAction, { decimals: 1 }) },
        { key: 'xpPerHour',   label: 'XP / h',      numeric: true, cell: (r, d) => xpHourCell(r, d) }
      ];
    }
    return [
      { key: 'name',      label: 'Stall' },
      { key: 'level',     label: 'Lvl',        numeric: true, cell: (r, d) => r.item.level },
      { key: 'xpEach',    label: 'XP / steal', numeric: true, cell: (r, d) => TO.fmt(r.item.xp, { decimals: 1 }) },
      { key: 'respawn',   label: dm === 'seconds' ? 'Time / steal' : 'Success', numeric: true,
        cell: (r, d) => dm === 'seconds' ? r.item.respawn + 's' : '100%' },
      { key: 'xpPerHour', label: 'XP / h',     numeric: true, cell: (r, d) => xpHourCell(r, d) }
    ];
  }

  // ---- State + DOM -----------------------------------------------------

  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function saveState(inputs) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        level: inputs.level, efficiency: inputs.efficiency, gear: inputs.gear,
        mode, sortKey, sortDir, excludedIds: Array.from(excludedIds)
      }));
    } catch (e) {}
  }

  function readInputs() {
    return {
      level:      TO.clampInt('th-level', 1, 99),
      efficiency: TO.clampFloat('th-efficiency', 0.5, 1),
      gear: {
        gloves: document.getElementById('th-gloves').checked,
        cape:   document.getElementById('th-cape').checked,
        ardue:  document.getElementById('th-ardue').checked
      }
    };
  }

  function syncActivityButtons() {
    document.querySelectorAll('section[data-view="thieving"] .mode-rail-btn').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.thMode === mode));
  }

  // ---- Recommendation cells (both activities, always shown) ------------

  function writeRec(prefix, best, inputs, forMode) {
    const nameEl   = document.getElementById(`th-rec-${prefix}-name`);
    const xpEl     = document.getElementById(`th-rec-${prefix}-xp`);
    const detailEl = document.getElementById(`th-rec-${prefix}-detail`);
    if (!best) {
      nameEl.textContent   = 'No method available';
      xpEl.textContent     = '—';
      detailEl.textContent = `Nothing unlocked at Thieving ${inputs.level} yet.`;
      return;
    }
    const it = best.item, r = best.rates;
    nameEl.textContent = it.name;
    xpEl.textContent   = `${TO.fmt(r.xpPerHour)} XP/h`;
    detailEl.textContent = forMode === 'pickpocket'
      ? `${TO.getDisplayMode() === 'seconds' ? `${TO.fmtTime(r.secPerAction)}/steal` : `${TO.fmtPct(r.successPct)} success`} at Thieving ${inputs.level} · ${TO.fmt(it.xp, { decimals: 1 })} XP each`
      : `${TO.fmt(it.xp, { decimals: 1 })} XP/steal · ${it.respawn}s respawn`;
  }

  // Single-skill overtake: sweep Thieving level from current+1 to 99 and find
  // the first level where a different method becomes best for this activity.
  // Exclusion-aware via bestRow; locked methods only count once they unlock.
  function findOvertake(forMode, currentBest, inputs) {
    for (let L = inputs.level + 1; L <= 99; L++) {
      const best = bestRow(buildRows(forMode, { ...inputs, level: L }));
      if (best && best.item.id !== currentBest.item.id) return { level: L, newBest: best };
    }
    return null;
  }

  function writeOvertake(prefix, forMode, best, inputs) {
    const el = document.getElementById(`th-rec-${prefix}-overtake`);
    if (!el) return;
    if (!best) { el.innerHTML = ''; return; }
    const xpPerHour   = best.rates.xpPerHour;
    const xpPerAction = best.item.xp;        // XP per successful pickpocket / steal
    const noun = forMode === 'pickpocket' ? 'pickpockets' : 'steals';
    if (!(xpPerHour > 0) || !(xpPerAction > 0)) { el.innerHTML = ''; return; }
    if (inputs.level >= 99) {
      el.innerHTML = `<span class="ot-dim">Already at Thieving 99 — nothing left to overtake.</span>`;
      return;
    }
    const currentXp = TO.getSkillXp('th-level');
    const ot = findOvertake(forMode, best, inputs);
    if (!ot) {
      const xpTo99 = Math.max(0, TO.xpAt(99) - currentXp);
      el.innerHTML =
        `Best method through <strong>lvl 99</strong> — ` +
        `${TO.fmt(Math.ceil(xpTo99 / xpPerAction))} more ${best.item.name} ${noun} ` +
        `<span class="ot-dim">(≈${TO.fmtDuration(xpTo99 / xpPerHour)})</span>`;
      return;
    }
    const xpNeeded = Math.max(0, TO.xpAt(ot.level) - currentXp);
    el.innerHTML =
      `Overtaken by <strong>${ot.newBest.item.name}</strong> at lvl ${ot.level} — ` +
      `${TO.fmt(Math.ceil(xpNeeded / xpPerAction))} more ${best.item.name} ${noun} ` +
      `<span class="ot-dim">(≈${TO.fmtDuration(xpNeeded / xpPerHour)})</span>`;
  }

  function renderRec(inputs) {
    const pickBest  = bestRow(buildRows('pickpocket', inputs));
    const stallBest = bestRow(buildRows('stalls', inputs));
    writeRec('pick',  pickBest,  inputs, 'pickpocket');
    writeRec('stall', stallBest, inputs, 'stalls');
    writeOvertake('pick',  'pickpocket', pickBest,  inputs);
    writeOvertake('stall', 'stalls',     stallBest, inputs);
  }

  // ---- Table -----------------------------------------------------------

  function renderTable(rows, inputs) {
    const cols = columnsFor(mode, TO.getDisplayMode(), gearMult(inputs.gear), inputs.level);
    document.getElementById('th-results-tbody').innerHTML = '';
    if (!rows.length) return;
    if (!(sortKey in rows[0].sortFields)) sortKey = 'xpPerHour';

    const headRow = document.getElementById('th-thead-row');
    headRow.innerHTML = '';
    cols.forEach(c => {
      const th = document.createElement('th');
      th.textContent = c.label;
      th.dataset.key = c.key;
      if (c.numeric) th.dataset.numeric = '';
      if (c.key === sortKey) th.classList.add('sorted', sortDir);
      th.addEventListener('click', () => {
        if (sortKey === c.key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else { sortKey = c.key; sortDir = c.numeric ? 'desc' : 'asc'; }
        render();
      });
      headRow.appendChild(th);
    });

    const best = bestRow(rows);
    const sorted = rows.slice().sort((a, b) => {
      if (a.rates.eligible !== b.rates.eligible) return a.rates.eligible ? -1 : 1;
      // Among still-locked methods, the XP/h sort isn't the useful order — the
      // highest-XP one is usually the highest level away. Order locked rows by
      // ascending level req instead, so the next methods you'll unlock sit at
      // the top of the locked block (ties broken by projected XP/h, high first).
      if (!a.rates.eligible && !b.rates.eligible && sortKey === 'xpPerHour') {
        return a.item.level - b.item.level || b.sortFields.xpPerHour - a.sortFields.xpPerHour;
      }
      const c = TO.compareBy(a, b, sortKey);
      return sortDir === 'asc' ? c : -c;
    });

    const tbody = document.getElementById('th-results-tbody');
    tbody.innerHTML = '';
    for (const row of sorted) {
      const tr = document.createElement('tr');
      const excluded = excludedIds.has(row.item.id);
      if (!row.rates.eligible) tr.classList.add('ineligible');
      if (excluded) tr.classList.add('excluded');
      if (best && row.item.id === best.item.id) tr.classList.add('recommended');
      const disp = row.projection ? row.projection.rates : row.rates;
      const titleParts = [];
      if (row.projection) titleParts.push(`XP/h projected at Thieving ${row.projection.level} (unlock)`);
      titleParts.push(excluded ? 'Click to include this method again.'
                               : 'Click to exclude this method from the best-for pick and charts.');
      tr.title = titleParts.join(' — ');
      tr.innerHTML = cols.map((c, i) => {
        const cls = i === 0 ? 'tree-name' : (c.numeric ? 'numeric' : '');
        return `<td class="${cls}">${c.cell ? c.cell(row, disp) : row.item.name}</td>`;
      }).join('');
      tr.addEventListener('click', () => {
        if (excludedIds.has(row.item.id)) excludedIds.delete(row.item.id);
        else excludedIds.add(row.item.id);
        render();
      });
      tbody.appendChild(tr);
    }
  }

  // ---- Charts ----------------------------------------------------------

  function currentItems() { return mode === 'pickpocket' ? PICK.targets : STALLS; }

  function createCharts() {
    const items = currentItems();
    if (barChart)  { barChart.destroy();  barChart = null; }
    if (lineChart) { lineChart.destroy(); lineChart = null; }

    const barCtx = document.getElementById('th-bar-chart').getContext('2d');
    barChart = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: items.map(i => i.name),
        datasets: [{
          label: 'XP/h', data: items.map(() => 0),
          backgroundColor: items.map(i => i.color),
          borderColor: items.map(i => i.color), borderWidth: 1
        }]
      },
      options: TO.chartCommon({
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${TO.fmt(ctx.parsed.y)} XP/h` } } },
        scales: { x: TO.axisOpts(), y: TO.axisOpts({ beginAtZero: true }) }
      })
    });

    const lineDatasets = items.map(i => ({
      label: i.name, data: [],
      borderColor: i.color, backgroundColor: i.color,
      borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.15
    }));
    const lineCtx = document.getElementById('th-line-chart').getContext('2d');
    lineChart = new Chart(lineCtx, {
      type: 'line',
      data: { labels: Array.from({ length: 99 }, (_, i) => i + 1), datasets: lineDatasets },
      options: TO.chartCommon({
        plugins: {
          legend: {
            labels: { color: '#e8e7e3' },
            onClick: (e, item) => {
              const it = currentItems()[item.datasetIndex];
              if (!it) return;
              if (excludedIds.has(it.id)) excludedIds.delete(it.id);
              else                        excludedIds.add(it.id);
              render();
            }
          },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${TO.fmt(ctx.parsed.y)} XP/h` } }
        },
        scales: {
          x: TO.axisOpts({ title: { display: true, text: 'Thieving level', color: '#9a9890' } }),
          y: TO.axisOpts({ beginAtZero: true, title: { display: true, text: 'XP / h', color: '#9a9890' } })
        }
      })
    });
  }

  function updateCharts(inputs) {
    const items = currentItems();
    const mult  = gearMult(inputs.gear);
    const rateAt = (it, lvl) => mode === 'pickpocket'
      ? pickRates(it, lvl, mult, inputs.efficiency).xpPerHour
      : stallRates(it, lvl, inputs.efficiency).xpPerHour;

    barChart.data.datasets[0].data = items.map(i =>
      excludedIds.has(i.id) ? 0 : Math.round(rateAt(i, inputs.level)));
    barChart.data.datasets[0].backgroundColor = items.map(i =>
      excludedIds.has(i.id) ? 'rgba(120,120,120,0.35)' : i.color);
    barChart.update();

    lineChart.data.datasets.forEach((ds, idx) => {
      const it = items[idx];
      ds.data = Array.from({ length: 99 }, (_, k) => Math.round(rateAt(it, k + 1)));
      ds.hidden = excludedIds.has(it.id);
    });
    lineChart.update();
  }

  function setTitles() {
    const noun = mode === 'pickpocket' ? 'Pickpocket targets' : 'Stalls';
    const lbl  = mode === 'pickpocket' ? 'Pickpocketing' : 'Stall';
    document.getElementById('th-table-title').textContent = noun;
    document.getElementById('th-bar-title').textContent  = `${lbl} XP/h per method — current setup`;
    document.getElementById('th-line-title').textContent = `${lbl} XP/h vs Thieving level`;
  }

  // ---- Render + wiring -------------------------------------------------

  function render() {
    if (!initialized) return;
    const inputs = readInputs();
    saveState(inputs);
    syncActivityButtons();
    renderRec(inputs);
    renderTable(buildRows(mode, inputs), inputs);
    updateCharts(inputs);
    setTitles();
    if (TO.syncStickyThead) TO.syncStickyThead();
  }

  function switchMode(next) {
    if (next === mode) return;
    mode = next;
    sortKey = 'xpPerHour';
    sortDir = 'desc';
    createCharts();        // method set differs between activities
    render();
  }

  function init() {
    if (initialized) return;
    const stored = loadState();
    if (stored) {
      if (stored.level)      document.getElementById('th-level').value = stored.level;
      if (stored.efficiency) document.getElementById('th-efficiency').value = stored.efficiency;
      if (stored.gear) {
        document.getElementById('th-gloves').checked = !!stored.gear.gloves;
        document.getElementById('th-cape').checked   = !!stored.gear.cape;
        document.getElementById('th-ardue').checked  = !!stored.gear.ardue;
      }
      if (stored.mode === 'pickpocket' || stored.mode === 'stalls') mode = stored.mode;
      if (stored.sortKey) sortKey = stored.sortKey;
      if (stored.sortDir === 'asc' || stored.sortDir === 'desc') sortDir = stored.sortDir;
      if (Array.isArray(stored.excludedIds)) excludedIds = new Set(stored.excludedIds);
    }

    ['th-level', 'th-efficiency', 'th-gloves', 'th-cape', 'th-ardue'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', render);
      el.addEventListener('change', render);
    });
    document.querySelectorAll('section[data-view="thieving"] .mode-rail-btn').forEach(btn => {
      btn.addEventListener('click', () => switchMode(btn.dataset.thMode));
    });

    createCharts();
    initialized = true;
    render();
  }

  TO.registerSection('thieving', { init, render });
})();
