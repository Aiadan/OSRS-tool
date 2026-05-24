// Woodcutting + Fletching + Firemaking section.
//
// Three modes share the same trees:
//   - Pure chop:    pace = chopTime;                   gives WC XP only
//   - Chop+Fletch:  pace = chopTime + fletchActionSec; gives WC + Fletching XP
//   - Chop+Burn:    pace = chopTime + burnTime(fm);    gives WC + Firemaking XP
// Each tree produces three rate triples; the three recommendations pick the
// tree maximising the relevant skill's XP/h.

(function () {
  'use strict';

  const SECTION = window.TRAINING_DATA.sections['wc-fletch-fm'];
  const TREES   = SECTION.gather.targets;
  const AXES    = SECTION.gather.tools;
  const TICK_S  = SECTION.gather.tickSec;
  const ACT_S   = SECTION.process.actionSec;
  const BURN    = SECTION.burn;

  const STORAGE_KEY = 'training-optimizer:wc-fletch-fm:v1';

  let sortKey = 'firemakingXpPerHour';
  let sortDir = 'desc';
  let barChart  = null;
  let lineChart = null;
  let initialized = false;
  // Tree ids the user has excluded — toggled by clicking the table row OR
  // the chart legend. Excluded trees are dropped from best-for selection,
  // overtake projection, bar chart, and line chart. Persisted so the
  // filter survives section navigation and page reload. (Stored under the
  // old `hiddenTreeIds` key for backward compatibility with existing
  // state from when the chart-legend toggle only hid the curve.)
  let excludedTreeIds = new Set();


  // ---- Pure calc --------------------------------------------------------

  // Firemaking ignition chance per attempt. Linear ramp from baseSuccess/256
  // at level 1 to 1.0 at guaranteedLevel; clamped at 1.0 above.
  function fmSuccess(level) {
    if (level >= BURN.guaranteedLevel) return 1;
    const span = BURN.maxSuccess - BURN.baseSuccess;
    const t = (level - 1) / (BURN.guaranteedLevel - 1);
    return Math.max(0.0001, (BURN.baseSuccess + span * t) / 256);
  }

  function chopSuccess(wcLevel, axe, tree) {
    const low  = (tree.baseChop + axe.power) / 256;
    const high = low * tree.ratio;
    const pRaw = low + (high - low) * (wcLevel - 1) / 98;
    return Math.max(0.0001, Math.min(1, pRaw));
  }

  // Highest-XP bow the user can currently fletch from this tree (longbow if
  // qualified, else shortbow, else null).
  function bestProduct(tree, fletchingLevel) {
    if (!tree.products) return null;
    let best = null;
    for (const p of tree.products) {
      if (fletchingLevel >= p.processLevel && (!best || p.processXp > best.processXp)) best = p;
    }
    return best;
  }
  // Lowest fletching level at which this tree becomes fletchable at all
  // (= shortbow level for bow trees). Used for the table column.
  function unlockFletchLevel(tree) {
    if (!tree.products) return null;
    return Math.min(...tree.products.map(p => p.processLevel));
  }

  function ratesFor({ wcLevel, fletchingLevel, firemakingLevel, axe, tree, efficiency }) {
    const wcOK    = wcLevel >= tree.gatherLevel;
    const chosenProduct = bestProduct(tree, fletchingLevel);
    const fletchOK = !!chosenProduct;
    const fmOK    = firemakingLevel >= tree.firemaking.fmLevel;

    const pChop = chopSuccess(wcLevel, axe, tree);
    const chopTimePerLog = TICK_S / pChop;

    // -- Pure chop (WC only) --
    const pureLogsPerHour = (3600 / chopTimePerLog) * efficiency;
    const wcXpPerHour     = pureLogsPerHour * tree.gatherXp;

    // -- Chop + Fletch (only if tree has a bow product) --
    let bowsPerHour = 0, fletchingXpPerHour = 0, fletchWcXpPerHour = 0;
    if (chosenProduct) {
      const secPerBow = chopTimePerLog + ACT_S;
      bowsPerHour        = (3600 / secPerBow) * efficiency;
      fletchingXpPerHour = bowsPerHour * chosenProduct.processXp;
      fletchWcXpPerHour  = bowsPerHour * tree.gatherXp;
    }

    // -- Chop + Burn (all trees burnable) --
    const pFm        = fmSuccess(firemakingLevel);
    const burnTime   = BURN.burnTickSec / pFm;
    const secPerBurn = chopTimePerLog + burnTime;
    const burnLogsPerHour    = (3600 / secPerBurn) * efficiency;
    const firemakingXpPerHour = burnLogsPerHour * tree.firemaking.fmXp;
    const burnWcXpPerHour    = burnLogsPerHour * tree.gatherXp;

    // Eligibility reasons per mode (so the table can dim per-row sensibly).
    const wcReasons    = wcOK ? [] : [`Woodcutting ${tree.gatherLevel}`];
    const fletchReasons = !tree.products
      ? ['not fletchable']
      : (fletchOK ? [] : [`Fletching ${unlockFletchLevel(tree)}`]).concat(wcOK ? [] : [`Woodcutting ${tree.gatherLevel}`]);
    const fmReasons    = (fmOK ? [] : [`Firemaking ${tree.firemaking.fmLevel}`])
      .concat(wcOK ? [] : [`Woodcutting ${tree.gatherLevel}`]);

    return {
      wcOK, fletchOK, fmOK, hasProduct: !!tree.products,
      chosenProduct,              // null if tree isn't fletchable or user too low
      successChance: pChop,
      chopTimePerLog,
      bowsPerHour,
      burnLogsPerHour,
      pureLogsPerHour,
      wcXpPerHour,                // pure-chop rate
      fletchingXpPerHour,         // 0 if not fletchable
      firemakingXpPerHour,
      // Concrete eligibility per mode used by the three recommendations.
      eligibleForWc:    wcOK,
      eligibleForFletch: !!tree.products && wcOK && fletchOK,
      eligibleForFm:    wcOK && fmOK,
      wcReasons, fletchReasons, fmReasons
    };
  }

  // 99 points (level 1..99) of <key> XP/h for the line chart. Two call modes:
  //   parallel:false  -- "current state" curve: hold fletching/FM at the
  //                      user's actual levels while sweeping WC. Shows what
  //                      happens RIGHT NOW as WC ticks up with other skills frozen.
  //   parallel:true   -- "training together" ceiling: fletching/FM also
  //                      sweep with WC. This is the realistic max-potential
  //                      curve — yew fletching only unlocks at WC 65 (when
  //                      assumed fletching also hits 65), longbow kicks in
  //                      at WC 70, etc. Replaces the old "max = 99" twin
  //                      which made longbow XP appear at WC 60.
  function xpCurve({ tree, axe, efficiency, ratesKey, fletchingLevel, firemakingLevel, parallel }) {
    const out = [];
    for (let lvl = 1; lvl <= 99; lvl++) {
      const fLvl  = parallel ? lvl : fletchingLevel;
      const fmLvl = parallel ? lvl : firemakingLevel;
      const r = ratesFor({
        wcLevel: lvl, fletchingLevel: fLvl, firemakingLevel: fmLvl,
        axe, tree, efficiency
      });
      out.push(lvl < tree.gatherLevel ? 0 : (r[ratesKey] || 0));
    }
    return out;
  }

  // ---- State + DOM ------------------------------------------------------

  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function saveState(s) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...s, sortKey, sortDir,
        // Field is named `hiddenTreeIds` for backward compat (it used to be
        // a chart-legend visibility toggle); semantics is now full exclusion.
        hiddenTreeIds: Array.from(excludedTreeIds)
      }));
    } catch (e) {}
  }

  function readInputs() {
    return {
      wcLevel:         TO.clampInt('wc-level', 1, 99),
      fletchingLevel:  TO.clampInt('fletch-level', 1, 99),
      firemakingLevel: TO.clampInt('fm-level', 1, 99),
      axeId:           document.getElementById('axe-select').value,
      efficiency:      TO.clampFloat('efficiency', 0.5, 1)
    };
  }

  function buildAxeOptions(currentWcLevel) {
    const sel = document.getElementById('axe-select');
    const prevValue = sel.value;
    sel.innerHTML = '';
    for (const axe of AXES) {
      const opt = document.createElement('option');
      opt.value = axe.id;
      opt.textContent = (currentWcLevel < axe.reqLevel)
        ? `${axe.name} axe (req. WC ${axe.reqLevel})`
        : `${axe.name} axe`;
      sel.appendChild(opt);
    }
    if (prevValue && AXES.some(a => a.id === prevValue)) sel.value = prevValue;
  }

  function buildRows(inputs) {
    const axe = AXES.find(a => a.id === inputs.axeId);
    return TREES.map(tree => {
      const r = ratesFor({
        wcLevel: inputs.wcLevel,
        fletchingLevel: inputs.fletchingLevel,
        firemakingLevel: inputs.firemakingLevel,
        axe, tree, efficiency: inputs.efficiency
      });
      return {
        tree, axe, rates: r,
        sortFields: {
          name: tree.name.toLowerCase(),
          wcLevel: tree.gatherLevel,
          fletchLevel: tree.products ? unlockFletchLevel(tree) : Number.MAX_SAFE_INTEGER,
          fmLevel: tree.firemaking.fmLevel,
          chopTimePerLog: r.chopTimePerLog,
          wcXpPerHour: r.wcXpPerHour,
          fletchingXpPerHour: r.fletchingXpPerHour,
          firemakingXpPerHour: r.firemakingXpPerHour
        }
      };
    });
  }

  function bestBy(rows, ratesKey, eligibleKey) {
    const e = rows.filter(r => r.rates[eligibleKey] && !excludedTreeIds.has(r.tree.id));
    if (!e.length) return null;
    return e.reduce((b, c) => c.rates[ratesKey] > b.rates[ratesKey] ? c : b);
  }

  function writeRecCell(prefix, best, mode, inputs) {
    const treeEl   = document.getElementById(`rec-${prefix}-tree`);
    const xpEl     = document.getElementById(`rec-${prefix}-xp`);
    const detailEl = document.getElementById(`rec-${prefix}-detail`);
    if (!best) {
      treeEl.textContent   = `No eligible tree`;
      xpEl.textContent     = '—';
      detailEl.textContent =
        mode === 'fletch'
          ? `At Woodcutting ${inputs.wcLevel} and Fletching ${inputs.fletchingLevel}, no bow-fletchable tree is unlocked yet.`
          : mode === 'fm'
          ? `At Woodcutting ${inputs.wcLevel} and Firemaking ${inputs.firemakingLevel}, nothing burnable is unlocked yet.`
          : `Train Woodcutting to 1 (the regular tree is unlocked from level 1, so this shouldn't happen).`;
      return;
    }
    const t = best.tree, r = best.rates;
    if (mode === 'wc') {
      treeEl.textContent = t.name;
      xpEl.textContent   = `${TO.fmt(r.wcXpPerHour)} WC XP/h`;
      detailEl.textContent =
        `Pure chop with ${best.axe.name} axe · ${TO.fmt(r.pureLogsPerHour)} logs/h · ` +
        `${TO.fmtTime(r.chopTimePerLog)}/log`;
    } else if (mode === 'fletch') {
      const productName = r.chosenProduct ? r.chosenProduct.name : '(no bow yet)';
      treeEl.textContent = `${t.name} → ${productName}`;
      xpEl.textContent   = `${TO.fmt(r.fletchingXpPerHour)} Fletching XP/h`;
      detailEl.textContent =
        `Chop + fletch with ${best.axe.name} axe · ${TO.fmt(r.bowsPerHour)} bows/h · ` +
        `${TO.fmtTime(r.chopTimePerLog)}/log + ${TO.fmtTime(ACT_S)}/fletch`;
    } else {
      const pFm = fmSuccess(inputs.firemakingLevel);
      const burnTime = BURN.burnTickSec / pFm;
      treeEl.textContent = `${t.name} → burn`;
      xpEl.textContent   = `${TO.fmt(r.firemakingXpPerHour)} Firemaking XP/h`;
      detailEl.textContent =
        `Chop + burn with ${best.axe.name} axe · ${TO.fmt(r.burnLogsPerHour)} logs/h · ` +
        `${TO.fmtTime(r.chopTimePerLog)}/log + ${TO.fmtTime(burnTime)}/light` +
        (inputs.firemakingLevel < BURN.guaranteedLevel ? ` (ignition ${TO.fmtPct(pFm)})` : '');
    }
  }

  function renderRecommendation(rows, inputs) {
    const wcBest = bestBy(rows, 'wcXpPerHour', 'eligibleForWc');
    const flBest = bestBy(rows, 'fletchingXpPerHour', 'eligibleForFletch');
    const fmBest = bestBy(rows, 'firemakingXpPerHour', 'eligibleForFm');
    writeRecCell('wc',     wcBest, 'wc',     inputs);
    writeRecCell('fletch', flBest, 'fletch', inputs);
    writeRecCell('fm',     fmBest, 'fm',     inputs);
    writeOvertake('wc',     wcBest, 'wc',     inputs);
    writeOvertake('fletch', flBest, 'fletch', inputs);
    writeOvertake('fm',     fmBest, 'fm',     inputs);
  }

  // ---- Overtake projection ---------------------------------------------
  // For each rec-cell, sweep the relevant skill from current+1 to 99,
  // recomputing the best tree at each level (other inputs held constant).
  // The first level at which the winner changes (a different tree, or the
  // same tree gaining a longbow upgrade in Fletching mode) is the overtake.
  // We then quote how many of the *current* best's actions are needed to
  // reach that level, and the wall-clock time assuming the current rate.
  //
  // Per-mode parameters: skill input id, sweep key on `inputs`, rates key
  // and eligibility key used by `bestBy`, plus the action label / per-action
  // XP function for the current best (chop logs / fletched bows / burned
  // logs all give different XP per action even at the same tree).
  const OVERTAKE_MODES = {
    wc: {
      inputId: 'wc-level', sweepKey: 'wcLevel',
      ratesKey: 'wcXpPerHour', eligibleKey: 'eligibleForWc',
      xpPerAction: (best) => best.tree.gatherXp,
      actionLabel: (best) => `${best.tree.name} log${'s'}`
    },
    fletch: {
      inputId: 'fletch-level', sweepKey: 'fletchingLevel',
      ratesKey: 'fletchingXpPerHour', eligibleKey: 'eligibleForFletch',
      xpPerAction: (best) => best.rates.chosenProduct ? best.rates.chosenProduct.processXp : 0,
      actionLabel: (best) => {
        const p = best.rates.chosenProduct;
        return p ? `${best.tree.name} ${p.name.includes('long') ? 'longbow' : 'shortbow'}s` : `${best.tree.name} bows`;
      }
    },
    fm: {
      inputId: 'fm-level', sweepKey: 'firemakingLevel',
      ratesKey: 'firemakingXpPerHour', eligibleKey: 'eligibleForFm',
      xpPerAction: (best) => best.tree.firemaking.fmXp,
      actionLabel: (best) => `${best.tree.name} burns`
    }
  };

  function findOvertake(currentBest, modeCfg, inputs) {
    const startLevel = inputs[modeCfg.sweepKey];
    if (startLevel >= 99) return null;
    const axe = AXES.find(a => a.id === inputs.axeId);
    for (let L = startLevel + 1; L <= 99; L++) {
      const sweep = { ...inputs, [modeCfg.sweepKey]: L };
      const rowsAtL = TREES.map(tree => ({
        tree,
        rates: ratesFor({
          wcLevel: sweep.wcLevel,
          fletchingLevel: sweep.fletchingLevel,
          firemakingLevel: sweep.firemakingLevel,
          axe, tree, efficiency: sweep.efficiency
        })
      }));
      const best = bestBy(rowsAtL, modeCfg.ratesKey, modeCfg.eligibleKey);
      if (!best) continue;
      if (best.tree.id !== currentBest.tree.id) {
        return { level: L, newBest: best, sameTree: false };
      }
      // Fletching: same tree but a higher-tier bow now wins. The user has
      // crossed a product's processLevel threshold — treat as overtake.
      if (modeCfg.ratesKey === 'fletchingXpPerHour') {
        const oldBow = currentBest.rates.chosenProduct;
        const newBow = best.rates.chosenProduct;
        if (oldBow && newBow && newBow !== oldBow) {
          return { level: L, newBest: best, sameTree: true };
        }
      }
    }
    return null;
  }

  function writeOvertake(prefix, best, mode, inputs) {
    const el = document.getElementById(`rec-${prefix}-overtake`);
    if (!el) return;
    const cfg = OVERTAKE_MODES[mode];
    if (!best || !cfg) { el.innerHTML = ''; return; }
    const xpPerHour = best.rates[cfg.ratesKey];
    const xpPerAction = cfg.xpPerAction(best);
    if (!isFinite(xpPerHour) || xpPerHour <= 0 || !xpPerAction) {
      el.innerHTML = ''; return;
    }
    if (inputs[cfg.sweepKey] >= 99) {
      el.innerHTML = `<span class="ot-dim">Already at level 99 — nothing left to overtake.</span>`;
      return;
    }
    const currentXp = TO.getSkillXp(cfg.inputId);
    const ot = findOvertake(best, cfg, inputs);
    if (!ot) {
      const xpTo99 = Math.max(0, TO.xpAt(99) - currentXp);
      const actionsTo99 = Math.ceil(xpTo99 / xpPerAction);
      const hoursTo99   = xpTo99 / xpPerHour;
      el.innerHTML =
        `Best method through <strong>lvl 99</strong> — ` +
        `${TO.fmt(actionsTo99)} more ${cfg.actionLabel(best)} ` +
        `<span class="ot-dim">(≈${TO.fmtDuration(hoursTo99)})</span>`;
      return;
    }
    const xpNeeded = Math.max(0, TO.xpAt(ot.level) - currentXp);
    const actions  = Math.ceil(xpNeeded / xpPerAction);
    const hours    = xpNeeded / xpPerHour;
    const newBowSuffix = (ot.sameTree && ot.newBest.rates.chosenProduct)
      ? ` ${ot.newBest.rates.chosenProduct.name.includes('long') ? 'longbow' : 'shortbow'}`
      : '';
    const newLabel = `${ot.newBest.tree.name}${newBowSuffix}`;
    el.innerHTML =
      `Overtaken by <strong>${newLabel}</strong> at lvl ${ot.level} — ` +
      `${TO.fmt(actions)} more ${cfg.actionLabel(best)} ` +
      `<span class="ot-dim">(≈${TO.fmtDuration(hours)})</span>`;
  }

  // Modes drive both the highlighted-row and the chart axis. The sort key
  // selects the active mode; non-XP sort keys (name, level reqs, chop time)
  // fall back to the default FM mode so the charts still show something.
  // `hideMax: true` for modes whose rate doesn't depend on the other skill
  // levels — current and max curves would coincide, so we suppress the
  // dashed twin to avoid two-tooltips-on-one-line noise.
  const MODES = {
    wcXpPerHour:         { ratesKey: 'wcXpPerHour',         eligibleKey: 'eligibleForWc',     label: 'WC XP/h',         yTitle: 'WC XP / h',         hideMax: true  },
    fletchingXpPerHour:  { ratesKey: 'fletchingXpPerHour',  eligibleKey: 'eligibleForFletch', label: 'Fletching XP/h',  yTitle: 'Fletching XP / h',  hideMax: false },
    firemakingXpPerHour: { ratesKey: 'firemakingXpPerHour', eligibleKey: 'eligibleForFm',     label: 'Firemaking XP/h', yTitle: 'Firemaking XP / h', hideMax: false }
  };
  function activeMode() {
    return MODES[sortKey] || MODES.firemakingXpPerHour;
  }
  function bestForHighlight(rows) {
    const m = MODES[sortKey];  // only XP sort columns highlight a row
    if (!m) return null;
    return bestBy(rows, m.ratesKey, m.eligibleKey);
  }

  function renderTable(rows) {
    const sorted = rows.slice().sort((a, b) => {
      const aOk = a.rates.eligibleForWc, bOk = b.rates.eligibleForWc;
      if (aOk !== bOk) return aOk ? -1 : 1;
      const c = TO.compareBy(a, b, sortKey);
      return sortDir === 'asc' ? c : -c;
    });
    const best = bestForHighlight(rows);
    const tbody = document.getElementById('results-tbody');
    tbody.innerHTML = '';
    for (const row of sorted) {
      const tr = document.createElement('tr');
      const isExcluded = excludedTreeIds.has(row.tree.id);
      if (!row.rates.eligibleForWc) tr.classList.add('ineligible');
      if (isExcluded) tr.classList.add('excluded');
      if (best && row.tree.id === best.tree.id) tr.classList.add('recommended');
      const blockers = row.rates.wcReasons.concat(
        row.rates.hasProduct ? row.rates.fletchReasons.filter(x => !row.rates.wcReasons.includes(x)) : [],
        row.rates.fmReasons.filter(x => !row.rates.wcReasons.includes(x))
      );
      const titleParts = [];
      if (blockers.length) titleParts.push('Needs: ' + Array.from(new Set(blockers)).join(' · '));
      titleParts.push(isExcluded ? 'Click to include this tree again.' : 'Click to exclude this tree from best-for picks.');
      tr.title = titleParts.join(' — ');
      const fletchReqCell  = row.tree.products ? unlockFletchLevel(row.tree) : '—';
      const fletchXpCell   = row.tree.products ? TO.fmt(row.rates.fletchingXpPerHour) : '—';
      tr.innerHTML = `
        <td class="tree-name"><span class="tree-swatch" style="background:${row.tree.color}"></span>${row.tree.name}</td>
        <td class="numeric">${row.tree.gatherLevel}</td>
        <td class="numeric">${fletchReqCell}</td>
        <td class="numeric">${row.tree.firemaking.fmLevel}</td>
        <td class="numeric">${TO.fmtTime(row.rates.chopTimePerLog)}</td>
        <td class="numeric">${TO.fmt(row.rates.wcXpPerHour)}</td>
        <td class="numeric">${fletchXpCell}</td>
        <td class="numeric">${TO.fmt(row.rates.firemakingXpPerHour)}</td>
      `;
      tr.addEventListener('click', () => {
        if (excludedTreeIds.has(row.tree.id)) excludedTreeIds.delete(row.tree.id);
        else excludedTreeIds.add(row.tree.id);
        render();
      });
      tbody.appendChild(tr);
    }
    document.querySelectorAll('#results-table thead th').forEach(th => {
      th.classList.remove('sorted', 'asc', 'desc');
      if (th.dataset.key === sortKey) th.classList.add('sorted', sortDir);
    });
  }

  // ---- Per-bow curves (Fletching mode) ---------------------------------
  // In Fletching mode the line chart's paired datasets per tree no longer
  // mean (current, max-parallel) — they mean (shortbow rate, longbow rate).
  // Each curve is the XP/h you'd earn if you fletched that specific bow,
  // sampled across WC 1..99 and gated only by tree.gatherLevel (no fletching
  // gate, so the curves visualise potential rather than current eligibility).
  // The "active" bow — whichever the user currently qualifies for — is solid
  // and a touch thicker; the other is dashed and thinner. The vertical gap
  // between solid and dashed for the same tree is the longbow upgrade boost.

  function fletchingCurveForBow({ tree, product, axe, efficiency }) {
    // Returns 99 values: XP/h at WC level i+1 if the user fletches `product`.
    // Zero below tree.gatherLevel; assumes the user already has the fletching
    // level required for the bow (caller's solid/dashed mapping conveys that).
    const out = new Array(99);
    for (let i = 0; i < 99; i++) {
      const wc = i + 1;
      if (wc < tree.gatherLevel) { out[i] = 0; continue; }
      const pChop = chopSuccess(wc, axe, tree);
      const chopTime = TICK_S / pChop;
      const bowsPerHour = (3600 / (chopTime + ACT_S)) * efficiency;
      out[i] = Math.round(bowsPerHour * product.processXp);
    }
    return out;
  }

  function createCharts() {
    const barCtx = document.getElementById('bar-chart').getContext('2d');
    barChart = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: TREES.map(t => t.name),
        datasets: [{
          label: 'Firemaking XP/h',
          data: TREES.map(() => 0),
          backgroundColor: TREES.map(t => t.color),
          borderColor: TREES.map(t => t.color),
          borderWidth: 1
        }]
      },
      options: TO.chartCommon({
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${TO.fmt(ctx.parsed.y)} XP/h` } } },
        scales: { x: TO.axisOpts(), y: TO.axisOpts({ beginAtZero: true }) }
      })
    });

    // Each tree gets TWO datasets — solid line for the rates at the user's
    // current Fletching/FM levels, dashed line for the maxed (99/99) ceiling.
    // For modes where the other skills don't affect the rate (e.g. WC XP/h
    // depends only on WC level) both curves overlay and the chart looks
    // single-line, which is the right outcome.
    const lineDatasets = [];
    for (const t of TREES) {
      lineDatasets.push({
        label: t.name, data: [],
        borderColor: t.color, backgroundColor: t.color,
        borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.15
      });
      lineDatasets.push({
        label: t.name + ' (max)', data: [],
        borderColor: t.color, backgroundColor: t.color,
        borderWidth: 1.5, borderDash: [4, 4],
        pointRadius: 0, pointHoverRadius: 4, tension: 0.15
      });
    }
    const lineCtx = document.getElementById('line-chart').getContext('2d');
    lineChart = new Chart(lineCtx, {
      type: 'line',
      data: {
        labels: Array.from({ length: 99 }, (_, i) => i + 1),
        datasets: lineDatasets
      },
      options: TO.chartCommon({
        plugins: {
          // Legend filter trims clutter mode-dependently:
          //   - WC / FM: hide "(max)" entries (dashed twins) → 16 entries.
          //   - Fletching: hide non-fletchable trees → 12 entries (6 trees
          //     × 2 bow tiers). Both "(short)" and "(long)" stay visible so
          //     the user can see the per-bow rate at a glance.
          // Legend click toggles BOTH datasets of the pair via tree.id.
          legend: {
            labels: {
              color: '#e8e7e3',
              filter: (item) => {
                if (/ \(max\)$/.test(item.text)) return false;
                if (sortKey === 'fletchingXpPerHour') {
                  const tree = TREES[Math.floor(item.datasetIndex / 2)];
                  if (!tree || !tree.products) return false;
                }
                return true;
              }
            },
            onClick: (e, item) => {
              const idx = item.datasetIndex;
              const tree = TREES[Math.floor(idx / 2)];
              if (!tree) return;
              if (excludedTreeIds.has(tree.id)) excludedTreeIds.delete(tree.id);
              else                              excludedTreeIds.add(tree.id);
              // render() applies the new visibility AND persists to storage.
              render();
            }
          },
          tooltip: {
            callbacks: { label: ctx => `${ctx.dataset.label}: ${TO.fmt(ctx.parsed.y)} XP/h` }
          }
        },
        scales: {
          x: TO.axisOpts({ title: { display: true, text: 'Woodcutting level', color: '#9a9890' } }),
          y: TO.axisOpts({ beginAtZero: true, title: { display: true, text: 'Firemaking XP / h', color: '#9a9890' } })
        }
      })
    });
  }

  function updateCharts(rows, inputs) {
    const axe = AXES.find(a => a.id === inputs.axeId);
    const mode = activeMode();
    barChart.data.datasets[0].label = mode.label;
    barChart.data.datasets[0].data = rows.map(r =>
      r.rates[mode.eligibleKey] && !excludedTreeIds.has(r.tree.id)
        ? Math.round(r.rates[mode.ratesKey]) : 0);
    barChart.data.datasets[0].backgroundColor = rows.map(r => {
      if (excludedTreeIds.has(r.tree.id)) return 'rgba(80,80,80,0.35)';
      return r.rates[mode.eligibleKey] ? r.tree.color : 'rgba(150,150,150,0.25)';
    });
    barChart.update();

    // Datasets are paired: [tree0-A, tree0-B, tree1-A, tree1-B, ...]. The
    // pair's MEANING depends on mode:
    //   - WC / FM: A = solid curve at current levels, B = dashed parallel-
    //     sweep curve. mode.hideMax suppresses the dashed twin in WC mode.
    //   - Fletching: A = shortbow rate curve, B = longbow rate curve. Solid
    //     vs dashed comes from which bow the user currently qualifies for
    //     (active bow = solid + thicker). Non-fletchable trees and trees
    //     without a longbow product hide the unused dataset.
    const isFletchMode = mode.ratesKey === 'fletchingXpPerHour';
    lineChart.data.datasets.forEach((ds, i) => {
      const tree = TREES[Math.floor(i / 2)];
      const bowIdx = i % 2;
      const userHid = excludedTreeIds.has(tree.id);

      if (isFletchMode) {
        const product = tree.products && tree.products[bowIdx];
        if (!product) {
          ds.data = new Array(99).fill(0);
          ds.hidden = true;
          ds.label = tree.name;
          return;
        }
        ds.data = fletchingCurveForBow({ tree, product, axe, efficiency: inputs.efficiency });
        const userBow = bestProduct(tree, inputs.fletchingLevel);
        const isActive = userBow === product;
        ds.borderDash  = isActive ? [] : [6, 4];
        ds.borderWidth = isActive ? 2.5 : 1.5;
        ds.label = `${tree.name} (${bowIdx === 0 ? 'short' : 'long'})`;
        ds.hidden = userHid;
      } else {
        const isMax = bowIdx === 1;
        ds.data = xpCurve({
          tree, axe,
          efficiency: inputs.efficiency,
          ratesKey: mode.ratesKey,
          fletchingLevel:  inputs.fletchingLevel,
          firemakingLevel: inputs.firemakingLevel,
          parallel: isMax
        }).map(v => Math.round(v));
        ds.borderDash  = isMax ? [4, 4] : [];
        ds.borderWidth = isMax ? 1.5 : 2;
        ds.label = isMax ? `${tree.name} (max)` : tree.name;
        ds.hidden = isMax ? (userHid || mode.hideMax) : userHid;
      }
    });
    if (lineChart.options.scales && lineChart.options.scales.y && lineChart.options.scales.y.title) {
      lineChart.options.scales.y.title.text = mode.yTitle;
    }
    lineChart.update();

    // Sync chart card headings.
    const barH = document.getElementById('wc-bar-title');
    const lineH = document.getElementById('wc-line-title');
    if (barH)  barH.textContent  = `${mode.label} per tree — current setup`;
    if (lineH) lineH.textContent = isFletchMode
      ? 'Fletching XP/h vs Woodcutting level (shortbow vs longbow per tree)'
      : `${mode.label} vs Woodcutting level`;
  }

  // ---- Wiring -----------------------------------------------------------

  function syncModeRail() {
    document.querySelectorAll('section[data-view="wc-fletch-fm"] .mode-rail-btn')
      .forEach(btn => btn.classList.toggle('active', btn.dataset.mode === sortKey));
  }

  function render() {
    if (!initialized) return;
    const inputs = readInputs();
    buildAxeOptions(inputs.wcLevel);
    document.getElementById('axe-select').value = inputs.axeId;
    saveState(inputs);
    syncModeRail();
    const rows = buildRows(inputs);
    renderRecommendation(rows, inputs);
    renderTable(rows);
    updateCharts(rows, inputs);
  }

  function init() {
    if (initialized) return;
    const stored = loadState();
    if (stored) {
      if (stored.wcLevel != null)         document.getElementById('wc-level').value     = stored.wcLevel;
      if (stored.fletchingLevel != null)  document.getElementById('fletch-level').value = stored.fletchingLevel;
      if (stored.firemakingLevel != null) document.getElementById('fm-level').value     = stored.firemakingLevel;
      if (stored.efficiency != null)      document.getElementById('efficiency').value   = stored.efficiency;
      if (stored.sortKey && (stored.sortKey in MODES)) sortKey = stored.sortKey;
      if (stored.sortDir === 'asc' || stored.sortDir === 'desc') sortDir = stored.sortDir;
      if (Array.isArray(stored.hiddenTreeIds)) {
        const known = new Set(TREES.map(t => t.id));
        excludedTreeIds = new Set(stored.hiddenTreeIds.filter(id => known.has(id)));
      }
    }
    buildAxeOptions(parseInt(document.getElementById('wc-level').value, 10));
    if (stored && AXES.some(a => a.id === stored.axeId)) {
      document.getElementById('axe-select').value = stored.axeId;
    } else {
      document.getElementById('axe-select').value = 'rune';
    }
    ['wc-level', 'fletch-level', 'fm-level', 'efficiency', 'axe-select'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', render);
      el.addEventListener('change', render);
    });
    document.querySelectorAll('#results-table thead th').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.key;
        if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else { sortKey = key; sortDir = th.dataset.numeric != null ? 'desc' : 'asc'; }
        render();
      });
    });
    // Mode rail (sticky skill picker).
    document.querySelectorAll('section[data-view="wc-fletch-fm"] .mode-rail-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sortKey = btn.dataset.mode;
        sortDir = 'desc';
        render();
      });
    });
    createCharts();
    initialized = true;
    render();
  }

  TO.registerSection('wc-fletch-fm', { init, render });
})();
