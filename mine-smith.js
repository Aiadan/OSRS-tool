// Mining -> Smithing section. Mining rows are ROCKS; their per-roll success
// curves are scraped from each rock page's {{Skilling success chart}} (same as
// fish). Smithing rows are BARS: a self-gathered smelt+smith chain whose rate is
// throttled by mining the constituent ores (coal usually binds). See README.
(function () {
  'use strict';

  const SECTION = window.TRAINING_DATA.sections['mine-smith'];
  const ROCKS   = SECTION.gather.miningCatalog;
  const PICKS   = SECTION.gather.tools;
  const BARS    = SECTION.process.bars;
  const TICK_S  = SECTION.gather.tickSec;             // 0.6
  const FURNACE_S = SECTION.process.furnaceActionSec; // 2.4
  const ANVIL_S   = SECTION.process.anvilActionSec;   // 1.8
  const RING    = SECTION.process.ringOfForging;

  const ROCK_BY_ID = {};
  for (const r of ROCKS) ROCK_BY_ID[r.id] = r;

  const STORAGE_KEY = 'training-optimizer:mine-smith:v1';

  let sortKey = 'miningXpPerHour';
  let sortDir = 'desc';
  let activity = 'mining';          // 'mining' | 'smithing' — toggle
  let barChart = null, lineChart = null, initialized = false;
  let excludedRockIds = new Set();
  let excludedBarIds  = new Set();
  let rockCounts = {};              // id -> integer the user typed (absent => default)

  function interp(low, high, level) {
    const lvl = Math.max(1, level);
    const value = Math.floor(low * (99 - lvl) / 98 + high * (lvl - 1) / 98 + 0.5) + 1;
    return Math.max(0, Math.min(1, value / 256));
  }

  // Highest pickaxe the player can actually wield at miningLevel, capped by the
  // selected tier (mirror fish-cook's harpoon fallback).
  function effectivePick(pickId, miningLevel) {
    const sel = PICKS.find(p => p.id === pickId) || PICKS[0];
    if (miningLevel >= sel.reqLevel) return sel;
    const usable = PICKS.filter(p => miningLevel >= p.reqLevel);
    return usable[usable.length - 1] || PICKS[0];
  }

  // Expected seconds to extract ONE ore from an available rock (no respawn wait).
  function mineTimeSec(rock, miningLevel, pick) {
    const p = interp(rock.low, rock.high, miningLevel);
    if (p <= 0) return Infinity;
    return (pick.rollTicks * TICK_S) / p;
  }

  // Ores/sec at efficiency 1 with `count` rocks: min(roll-limited, respawn supply).
  function oresPerSecRaw(rock, miningLevel, pick, count) {
    if (miningLevel < rock.gatherLevel) return 0;
    const mt = mineTimeSec(rock, miningLevel, pick);
    if (!isFinite(mt)) return 0;
    const supply = count / (mt + rock.respawnSec);
    return Math.min(1 / mt, supply);
  }

  // Smallest integer count that makes the rock roll-limited at this level/pickaxe.
  function rollLimitedCount(rock, miningLevel, pick) {
    const lvl = Math.max(miningLevel, rock.gatherLevel);
    const mt = mineTimeSec(rock, lvl, pick);
    if (!isFinite(mt)) return 1;
    return Math.max(1, Math.ceil(1 + rock.respawnSec / mt));
  }

  // Resolve the count for a rock: user value if present & >0, else roll-limited default.
  function countFor(rock, miningLevel, pick) {
    const v = rockCounts[rock.id];
    return (v != null && v > 0) ? v : rollLimitedCount(rock, miningLevel, pick);
  }

  // ---- Mining card: per-rock rate ----
  function rockRate({ miningLevel, pickId, rock, efficiency }) {
    const pick = effectivePick(pickId, miningLevel);
    const eligible = miningLevel >= rock.gatherLevel;
    const count = countFor(rock, miningLevel, pick);
    const opsRaw = oresPerSecRaw(rock, miningLevel, pick, count);
    const oresPerHour = opsRaw * 3600 * efficiency;
    return {
      eligible,
      blockingReasons: eligible ? [] : [`Mining ${rock.gatherLevel}`],
      pickName: pick.name, count,
      successChance: interp(rock.low, rock.high, Math.max(miningLevel, rock.gatherLevel)),
      oresPerHour,
      miningXpPerHour: oresPerHour * rock.gatherXp
    };
  }

  // ---- Smithing card: per-bar self-gathered smelt+smith chain ----
  function barRate({ miningLevel, smithingLevel, pickId, bar, ringOfForging, efficiency }) {
    const pick = effectivePick(pickId, miningLevel);
    const oreIds = Object.keys(bar.recipe);
    const reasons = [];
    for (const oreId of oreIds) {
      const rock = ROCK_BY_ID[oreId];
      if (!rock) { reasons.push(`missing rock ${oreId}`); continue; }
      if (miningLevel < rock.gatherLevel) reasons.push(`Mining ${rock.gatherLevel} (${rock.name})`);
    }
    if (smithingLevel < bar.smeltLevel) reasons.push(`Smithing ${bar.smeltLevel} (smelt)`);
    if (smithingLevel < bar.smithLevel) reasons.push(`Smithing ${bar.smithLevel} (smith)`);
    const eligible = reasons.length === 0;

    // Smelt success: only bars in RING.affects (iron) fail without a ring. A
    // failed smelt consumes the ore(s) and yields no bar — so per SUCCESSFUL bar
    // you mine (and smelt) 1/smeltSucc times the recipe.
    const ringApplies = RING.affects.includes(bar.id);
    const smeltSucc = (ringApplies && !ringOfForging) ? RING.smeltSuccessWithout : 1;

    let gatherSec = 0, gatherMiningXp = 0, bindingOreId = null, bindingSec = -1;
    for (const oreId of oreIds) {
      const rock = ROCK_BY_ID[oreId];
      if (!rock) continue;
      const qty = bar.recipe[oreId] / smeltSucc;     // ores per successful bar (waste-adjusted)
      const count = countFor(rock, miningLevel, pick);
      const ops = oresPerSecRaw(rock, miningLevel, pick, count);
      const sec = ops > 0 ? qty / ops : Infinity;
      gatherSec += sec;
      gatherMiningXp += qty * rock.gatherXp;
      if (sec > bindingSec) { bindingSec = sec; bindingOreId = oreId; }
    }
    const smeltSec = FURNACE_S / smeltSucc;           // wasted attempts cost furnace time
    const smithSec = ANVIL_S;
    const cycleSec = gatherSec + smeltSec + smithSec;
    const smithingXp = bar.smeltXp + bar.smithXp;     // Smithing-skill XP per bar

    const ok = eligible && isFinite(cycleSec) && cycleSec > 0;
    return {
      eligible,
      blockingReasons: reasons,
      bindingOre: bindingOreId ? ROCK_BY_ID[bindingOreId].name : '—',
      recipeLabel: oreIds.map(o => `${bar.recipe[o]}× ${ROCK_BY_ID[o] ? ROCK_BY_ID[o].name : o}`).join(' + '),
      smithingXpPerBar: smithingXp,
      cycleSec,
      smithingXpPerHour: ok ? smithingXp / cycleSec * 3600 * efficiency : 0,
      totalXpPerHour:    ok ? (gatherMiningXp + smithingXp) / cycleSec * 3600 * efficiency : 0
    };
  }

  // ---- State + inputs ----
  function loadState() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { return null; } }
  function saveState(s) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...s, sortKey, sortDir, activity,
        excludedRockIds: Array.from(excludedRockIds),
        excludedBarIds: Array.from(excludedBarIds),
        rockCounts
      }));
    } catch (e) {}
  }
  function readInputs() {
    return {
      miningLevel:   TO.clampInt('ms-mining-level', 1, 99),
      smithingLevel: TO.clampInt('ms-smithing-level', 1, 99),
      pickId:        document.getElementById('ms-pick-select').value,
      ringOfForging: document.getElementById('ms-ring').checked,
      efficiency:    TO.clampFloat('ms-efficiency', 0.5, 1)
    };
  }
  function buildPickOptions(miningLevel) {
    const sel = document.getElementById('ms-pick-select'); const prev = sel.value; sel.innerHTML = '';
    for (const p of PICKS) {
      const opt = document.createElement('option'); opt.value = p.id;
      opt.textContent = (miningLevel < p.reqLevel) ? `${p.name} (req. Mining ${p.reqLevel})` : p.name;
      sel.appendChild(opt);
    }
    if (prev && PICKS.some(p => p.id === prev)) sel.value = prev;
  }

  // ---- Row builders ----
  function buildRockRows(inputs) {
    return ROCKS.map(rock => {
      const rates = rockRate({ miningLevel: inputs.miningLevel, pickId: inputs.pickId, rock, efficiency: inputs.efficiency });
      let projection = null;
      if (!rates.eligible) {
        const r2 = rockRate({ miningLevel: rock.gatherLevel, pickId: inputs.pickId, rock, efficiency: inputs.efficiency });
        if (r2.miningXpPerHour > 0) projection = { rates: r2, miningLevel: rock.gatherLevel };
      }
      const disp = projection ? projection.rates : rates;
      return { rock, rates, projection, sortFields: {
        name: rock.name.toLowerCase(), gatherLevel: rock.gatherLevel,
        successChance: disp.successChance, count: disp.count,
        oresPerHour: disp.oresPerHour, miningXpPerHour: disp.miningXpPerHour } };
    });
  }
  function buildBarRows(inputs) {
    return BARS.map(bar => {
      const rates = barRate({ miningLevel: inputs.miningLevel, smithingLevel: inputs.smithingLevel,
        pickId: inputs.pickId, bar, ringOfForging: inputs.ringOfForging, efficiency: inputs.efficiency });
      let projection = null;
      if (!rates.eligible) {
        const oreRocks = Object.keys(bar.recipe).map(o => ROCK_BY_ID[o]);
        if (oreRocks.every(Boolean)) {
          const mlvl = Math.max(...oreRocks.map(r => r.gatherLevel));
          const slvl = Math.max(bar.smeltLevel, bar.smithLevel);
          const r2 = barRate({ miningLevel: mlvl, smithingLevel: slvl, pickId: inputs.pickId, bar,
            ringOfForging: inputs.ringOfForging, efficiency: inputs.efficiency });
          if (r2.totalXpPerHour > 0) projection = { rates: r2, miningLevel: mlvl, smithingLevel: slvl };
        }
      }
      const disp = projection ? projection.rates : rates;
      return { bar, rates, projection, sortFields: {
        name: bar.name.toLowerCase(), smithLevel: bar.smithLevel,
        smithingXpPerBar: disp.smithingXpPerBar,
        smithingXpPerHour: disp.smithingXpPerHour, totalXpPerHour: disp.totalXpPerHour } };
    });
  }
  function bestRockByKey(rows, key) {
    const e = rows.filter(r => r.rates.eligible && !excludedRockIds.has(r.rock.id));
    return e.length ? e.reduce((b, c) => c.rates[key] > b.rates[key] ? c : b) : null;
  }
  function bestBarByKey(rows, key) {
    const e = rows.filter(r => r.rates.eligible && !excludedBarIds.has(r.bar.id));
    return e.length ? e.reduce((b, c) => c.rates[key] > b.rates[key] ? c : b) : null;
  }

  // ---- Recommendation cards ----
  function writeMiningRec(best, inputs) {
    const t = document.getElementById('ms-rec-mining-title');
    const xp = document.getElementById('ms-rec-mining-xp');
    const d = document.getElementById('ms-rec-mining-detail');
    if (!best) { t.textContent = 'No eligible rock'; xp.textContent = '—'; d.textContent = `At Mining ${inputs.miningLevel}, nothing is unlocked. Clay/copper/tin are available from level 1.`; return; }
    const r = best.rates;
    t.textContent = best.rock.name;
    xp.textContent = `${TO.fmt(r.miningXpPerHour)} Mining XP/h`;
    d.textContent = `${r.pickName} at Mining ${inputs.miningLevel} · ${TO.fmtPct(r.successChance)} success · ${TO.fmt(r.oresPerHour)} ore/h · assumes ${r.count} rock${r.count === 1 ? '' : 's'}`;
  }
  function writeBarRec(prefix, best, inputs, key, label) {
    const t = document.getElementById(`ms-rec-${prefix}-title`);
    const xp = document.getElementById(`ms-rec-${prefix}-xp`);
    const d = document.getElementById(`ms-rec-${prefix}-detail`);
    if (!best) { t.textContent = 'No eligible bar'; xp.textContent = '—'; d.textContent = `At Mining ${inputs.miningLevel} / Smithing ${inputs.smithingLevel}, no bar chain is unlocked yet.`; return; }
    const r = best.rates;
    t.textContent = `${best.bar.name} — ${r.recipeLabel}`;
    xp.textContent = `${TO.fmt(r[key])} ${label}`;
    d.textContent = `${r.smithingXpPerBar} Smithing XP/bar · gather bound by ${r.bindingOre} · ${TO.fmtTime(r.cycleSec)}/bar · ${TO.fmt(r.totalXpPerHour)} total XP/h`;
  }
  function renderRecommendation(rockRows, barRows, inputs) {
    const miningBest   = bestRockByKey(rockRows, 'miningXpPerHour');
    const smithingBest = bestBarByKey(barRows, 'smithingXpPerHour');
    const totalBest    = bestBarByKey(barRows, 'totalXpPerHour');
    writeMiningRec(miningBest, inputs);
    writeBarRec('smithing', smithingBest, inputs, 'smithingXpPerHour', 'Smithing XP/h');
    writeBarRec('total',    totalBest,    inputs, 'totalXpPerHour',    'Total XP/h');
    writeMiningOvertake(miningBest, inputs);
    writeBarOvertake('smithing', smithingBest, inputs, 'smithingXpPerHour');
    writeBarOvertake('total',    totalBest,    inputs, 'totalXpPerHour');
  }

  // ---- Overtake projections ----
  // Mining card: sweep Mining level, holding rock counts; first level a different
  // rock becomes best by Mining XP/h. Bar cards: sweep Mining (raising Smithing in
  // lockstep) holding counts; first level a different bar becomes best by `key`.
  function writeMiningOvertake(best, inputs) {
    const el = document.getElementById('ms-rec-mining-overtake'); if (!el) return;
    if (!best) { el.innerHTML = ''; return; }
    if (inputs.miningLevel >= 99) { el.innerHTML = `<span class="ot-dim">Already at Mining 99 — nothing left to overtake.</span>`; return; }
    const curXp = TO.getSkillXp('ms-mining-level');
    const xpPerHour = best.rates.miningXpPerHour, xpPerOre = best.rock.gatherXp;
    if (!(xpPerHour > 0) || !(xpPerOre > 0)) { el.innerHTML = ''; return; }
    let found = null;
    for (let L = inputs.miningLevel + 1; L <= 99 && !found; L++) {
      const rows = ROCKS.map(rock => ({ rock, rates: rockRate({ miningLevel: L, pickId: inputs.pickId, rock, efficiency: inputs.efficiency }) }));
      const b = bestRockByKey(rows, 'miningXpPerHour');
      if (b && b.rock.id !== best.rock.id) found = { level: L, b };
    }
    if (!found) {
      const xpTo99 = Math.max(0, TO.xpAt(99) - curXp);
      el.innerHTML = `Best rock through <strong>lvl 99</strong> — ${TO.fmt(Math.ceil(xpTo99 / xpPerOre))} more ${best.rock.name} <span class="ot-dim">(≈${TO.fmtDuration(xpTo99 / xpPerHour)})</span>`;
      return;
    }
    const need = Math.max(0, TO.xpAt(found.level) - curXp);
    el.innerHTML = `Overtaken by <strong>${found.b.rock.name}</strong> at lvl ${found.level} — ${TO.fmt(Math.ceil(need / xpPerOre))} more ${best.rock.name} <span class="ot-dim">(≈${TO.fmtDuration(need / xpPerHour)})</span>`;
  }
  function writeBarOvertake(prefix, best, inputs, key) {
    const el = document.getElementById(`ms-rec-${prefix}-overtake`); if (!el) return;
    if (!best) { el.innerHTML = ''; return; }
    if (inputs.miningLevel >= 99 && inputs.smithingLevel >= 99) { el.innerHTML = `<span class="ot-dim">Already at Mining &amp; Smithing 99.</span>`; return; }
    const curXp = TO.getSkillXp('ms-mining-level');
    const xpPerHour = best.rates[key];
    const barsPerHour = best.rates.cycleSec > 0 ? 3600 * inputs.efficiency / best.rates.cycleSec : 0;
    const xpPerBar = barsPerHour > 0 ? xpPerHour / barsPerHour : 0;
    if (!(xpPerHour > 0) || !xpPerBar) { el.innerHTML = ''; return; }
    let found = null;
    for (let L = inputs.miningLevel + 1; L <= 99 && !found; L++) {
      // Assume Smithing keeps pace with Mining (player is training this bar).
      const sL = Math.min(99, inputs.smithingLevel + (L - inputs.miningLevel));
      const rows = BARS.map(bar => ({ bar, rates: barRate({ miningLevel: L, smithingLevel: sL, pickId: inputs.pickId, bar, ringOfForging: inputs.ringOfForging, efficiency: inputs.efficiency }) }));
      const b = bestBarByKey(rows, key);
      if (b && b.bar.id !== best.bar.id) found = { level: L, b };
    }
    if (!found) {
      const xpTo99 = Math.max(0, TO.xpAt(99) - curXp);
      el.innerHTML = `Best bar through <strong>Mining 99</strong> — ${TO.fmt(Math.ceil(xpTo99 / xpPerBar))} more ${best.bar.name} <span class="ot-dim">(≈${TO.fmtDuration(xpTo99 / xpPerHour)}, counts held)</span>`;
      return;
    }
    const need = Math.max(0, TO.xpAt(found.level) - curXp);
    el.innerHTML = `Overtaken by <strong>${found.b.bar.name}</strong> at Mining ${found.level} — ${TO.fmt(Math.ceil(need / xpPerBar))} more ${best.bar.name} <span class="ot-dim">(≈${TO.fmtDuration(need / xpPerHour)}, counts held)</span>`;
  }

  // ---- Tables + activity modes ----
  // Which table/chart the Mining<->Smithing toggle shows, and the metric each
  // offers. The sort key selects the active metric within a table.
  const ROCK_MODES = {
    miningXpPerHour: { label: 'Mining XP/h', yTitle: 'Mining XP / h' }
  };
  const BAR_MODES = {
    smithingXpPerHour: { label: 'Smithing XP/h', yTitle: 'Smithing XP / h' },
    totalXpPerHour:    { label: 'Total XP/h',    yTitle: 'Total XP / h' }
  };

  function renderRockTable(rows, inputs) {
    const best = bestRockByKey(rows, (sortKey in ROCK_MODES) ? sortKey : 'miningXpPerHour');
    const sorted = rows.slice().sort((a, b) => {
      if (a.rates.eligible !== b.rates.eligible) return a.rates.eligible ? -1 : 1;
      const c = TO.compareBy(a, b, sortKey);
      return sortDir === 'asc' ? c : -c;
    });
    const tb = document.getElementById('ms-rock-tbody'); tb.innerHTML = '';
    const pick = effectivePick(inputs.pickId, inputs.miningLevel);
    for (const row of sorted) {
      const tr = document.createElement('tr');
      const ex = excludedRockIds.has(row.rock.id);
      if (!row.rates.eligible) tr.classList.add('ineligible');
      if (ex) tr.classList.add('excluded');
      if (best && row.rock.id === best.rock.id) tr.classList.add('recommended');
      const cells = row.projection ? row.projection.rates : row.rates;
      const def = rollLimitedCount(row.rock, Math.max(inputs.miningLevel, row.rock.gatherLevel), pick);
      const cv = (rockCounts[row.rock.id] != null && rockCounts[row.rock.id] > 0) ? rockCounts[row.rock.id] : '';
      const xpCell = `${TO.fmt(cells.miningXpPerHour)}${row.projection ? ` <span class="ot-dim">(@${row.projection.miningLevel})</span>` : ''}`;
      tr.innerHTML = `
        <td class="tree-name">${row.rock.name}</td>
        <td class="numeric">${row.rock.gatherLevel}</td>
        <td class="numeric">${TO.fmtPct(cells.successChance)}</td>
        <td class="numeric"><input type="number" min="0" class="rock-count" data-rock="${row.rock.id}" value="${cv}" placeholder="${def}"></td>
        <td class="numeric">${TO.fmt(cells.oresPerHour)}</td>
        <td class="numeric">${xpCell}</td>`;
      tr.addEventListener('click', (e) => {
        if (e.target.closest('.rock-count')) return;
        if (excludedRockIds.has(row.rock.id)) excludedRockIds.delete(row.rock.id); else excludedRockIds.add(row.rock.id);
        render();
      });
      tb.appendChild(tr);
    }
    tb.querySelectorAll('.rock-count').forEach(inp => {
      inp.addEventListener('input', () => {
        const id = inp.dataset.rock; const v = parseInt(inp.value, 10);
        if (!v || v <= 0) delete rockCounts[id]; else rockCounts[id] = v;
        render();
      });
    });
    document.querySelectorAll('#ms-rock-table thead th').forEach(th => {
      th.classList.remove('sorted', 'asc', 'desc');
      if (th.dataset.key === sortKey) th.classList.add('sorted', sortDir);
    });
  }

  function renderBarTable(rows) {
    const best = bestBarByKey(rows, (sortKey in BAR_MODES) ? sortKey : 'totalXpPerHour');
    const sorted = rows.slice().sort((a, b) => {
      if (a.rates.eligible !== b.rates.eligible) return a.rates.eligible ? -1 : 1;
      const c = TO.compareBy(a, b, sortKey);
      return sortDir === 'asc' ? c : -c;
    });
    const tb = document.getElementById('ms-bar-tbody'); tb.innerHTML = '';
    for (const row of sorted) {
      const tr = document.createElement('tr');
      const ex = excludedBarIds.has(row.bar.id);
      if (!row.rates.eligible) tr.classList.add('ineligible');
      if (ex) tr.classList.add('excluded');
      if (best && row.bar.id === best.bar.id) tr.classList.add('recommended');
      const cells = row.projection ? row.projection.rates : row.rates;
      const proj = row.projection ? ` <span class="ot-dim">(@M${row.projection.miningLevel}/S${row.projection.smithingLevel})</span>` : '';
      tr.innerHTML = `
        <td class="tree-name">${row.bar.name}</td>
        <td>${cells.recipeLabel}</td>
        <td class="numeric">${row.bar.smithLevel}</td>
        <td class="numeric">${cells.smithingXpPerBar}</td>
        <td class="numeric">${TO.fmt(cells.smithingXpPerHour)}</td>
        <td class="numeric">${TO.fmt(cells.totalXpPerHour)}${proj}</td>`;
      tr.addEventListener('click', () => {
        if (excludedBarIds.has(row.bar.id)) excludedBarIds.delete(row.bar.id); else excludedBarIds.add(row.bar.id);
        render();
      });
      tb.appendChild(tr);
    }
    document.querySelectorAll('#ms-bar-table thead th').forEach(th => {
      th.classList.remove('sorted', 'asc', 'desc');
      if (th.dataset.key === sortKey) th.classList.add('sorted', sortDir);
    });
  }

  // Show only the active table/chart wrapper; highlight the active toggle button.
  function syncActivity() {
    const rockWrap = document.getElementById('ms-rock-wrap');
    const barWrap = document.getElementById('ms-bar-wrap');
    if (rockWrap) rockWrap.classList.toggle('hidden', activity !== 'mining');
    if (barWrap) barWrap.classList.toggle('hidden', activity !== 'smithing');
    document.querySelectorAll('section[data-view="mine-smith"] .activity-btn')
      .forEach(btn => btn.classList.toggle('active', btn.dataset.activity === activity));
  }
  // Switch table, reset the sort key to that table's primary metric, re-render.
  function setActivity(next) {
    activity = (next === 'smithing') ? 'smithing' : 'mining';
    sortKey = (activity === 'mining') ? 'miningXpPerHour' : 'totalXpPerHour';
    sortDir = 'desc';
    render();
  }

  // ---- Charts ----
  const ROCK_FALLBACK = ['#b08d57','#b87333','#cfcfcf','#8a5a44','#c0c0c8','#3a3a3a','#d4af37','#4f6bb0','#3f7d5a','#3fa7a0'];
  const BAR_FALLBACK  = ['#b87333','#8a5a44','#9aa0a6','#4f6bb0','#3f7d5a','#3fa7a0'];
  function rockColor(rock, i) { return rock.color || ROCK_FALLBACK[i % ROCK_FALLBACK.length]; }
  function barColor(bar, i) { return BAR_FALLBACK[i % BAR_FALLBACK.length]; }

  // XP/h vs Mining level 1..99 for the line chart.
  function rockCurve(rock, inputs) {
    const out = [];
    for (let L = 1; L <= 99; L++) out.push(L < rock.gatherLevel ? 0 : Math.round(rockRate({ miningLevel: L, pickId: inputs.pickId, rock, efficiency: inputs.efficiency }).miningXpPerHour));
    return out;
  }
  function barCurve(bar, inputs, key) {
    const out = [];
    for (let L = 1; L <= 99; L++) out.push(Math.round(barRate({ miningLevel: L, smithingLevel: inputs.smithingLevel, pickId: inputs.pickId, bar, ringOfForging: inputs.ringOfForging, efficiency: inputs.efficiency })[key] || 0));
    return out;
  }

  function createCharts() {
    const barCtx = document.getElementById('ms-bar-chart').getContext('2d');
    barChart = new Chart(barCtx, {
      type: 'bar',
      data: { labels: [], datasets: [{ label: '', data: [], backgroundColor: [], borderWidth: 1 }] },
      options: TO.chartCommon({
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${TO.fmt(ctx.parsed.y)} XP/h` } } },
        scales: { x: TO.axisOpts(), y: TO.axisOpts({ beginAtZero: true }) }
      })
    });
    const lineCtx = document.getElementById('ms-line-chart').getContext('2d');
    lineChart = new Chart(lineCtx, {
      type: 'line',
      data: { labels: Array.from({ length: 99 }, (_, i) => i + 1), datasets: [] },
      options: TO.chartCommon({
        plugins: {
          legend: {
            labels: { color: '#e8e7e3' },
            onClick: (e, item) => {
              const ds = lineChart.data.datasets[item.datasetIndex]; if (!ds || !ds._entityId) return;
              const set = activity === 'mining' ? excludedRockIds : excludedBarIds;
              if (set.has(ds._entityId)) set.delete(ds._entityId); else set.add(ds._entityId);
              render();
            }
          },
          tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${TO.fmt(ctx.parsed.y)} XP/h` } }
        },
        scales: {
          x: TO.axisOpts({ title: { display: true, text: 'Mining level', color: '#9a9890' } }),
          y: TO.axisOpts({ beginAtZero: true, title: { display: true, text: 'XP / h', color: '#9a9890' } })
        }
      })
    });
  }

  function updateCharts(rockRows, barRows, inputs) {
    const isMining = activity === 'mining';
    const mode = isMining ? ROCK_MODES.miningXpPerHour : (BAR_MODES[sortKey] || BAR_MODES.totalXpPerHour);
    const key  = isMining ? 'miningXpPerHour' : ((sortKey in BAR_MODES) ? sortKey : 'totalXpPerHour');
    const rows = isMining ? rockRows : barRows;
    const excluded = isMining ? excludedRockIds : excludedBarIds;
    const idOf    = r => isMining ? r.rock.id : r.bar.id;
    const nameOf  = r => isMining ? r.rock.name : r.bar.name;
    const colorOf = (r, i) => isMining ? rockColor(r.rock, i) : barColor(r.bar, i);

    barChart.data.labels = rows.map(nameOf);
    barChart.data.datasets[0].label = mode.label;
    barChart.data.datasets[0].data = rows.map(r => (r.rates.eligible && !excluded.has(idOf(r))) ? Math.round(r.rates[key]) : 0);
    barChart.data.datasets[0].backgroundColor = rows.map((r, i) => excluded.has(idOf(r)) ? 'rgba(80,80,80,0.35)' : (r.rates.eligible ? colorOf(r, i) : 'rgba(150,150,150,0.25)'));
    barChart.update();

    lineChart.data.datasets = rows.map((r, i) => {
      const color = colorOf(r, i);
      const ds = {
        label: nameOf(r),
        data: isMining ? rockCurve(r.rock, inputs) : barCurve(r.bar, inputs, key),
        borderColor: color, backgroundColor: color, borderWidth: 2,
        pointRadius: 0, pointHoverRadius: 4, tension: 0.15, hidden: excluded.has(idOf(r))
      };
      ds._entityId = idOf(r);
      return ds;
    });
    if (lineChart.options.scales && lineChart.options.scales.y && lineChart.options.scales.y.title) lineChart.options.scales.y.title.text = mode.yTitle;
    lineChart.update();

    const barH  = document.getElementById('ms-bar-title');
    const lineH = document.getElementById('ms-line-title');
    if (barH)  barH.textContent  = `${mode.label} per ${isMining ? 'rock' : 'bar'} — current setup`;
    if (lineH) lineH.textContent = `${mode.label} vs Mining level`;
  }

  // ---- Wiring ----
  function render() {
    if (!initialized) return;
    const inputs = readInputs();
    buildPickOptions(inputs.miningLevel);
    document.getElementById('ms-pick-select').value = inputs.pickId;
    saveState(inputs);
    syncActivity();
    const rockRows = buildRockRows(inputs);
    const barRows  = buildBarRows(inputs);
    renderRecommendation(rockRows, barRows, inputs);
    renderRockTable(rockRows, inputs);
    renderBarTable(barRows);
    updateCharts(rockRows, barRows, inputs);
  }

  function init() {
    if (initialized) return;
    const stored = loadState();
    if (stored) {
      if (stored.miningLevel)   document.getElementById('ms-mining-level').value = stored.miningLevel;
      if (stored.smithingLevel) document.getElementById('ms-smithing-level').value = stored.smithingLevel;
      if (stored.efficiency)    document.getElementById('ms-efficiency').value = stored.efficiency;
      document.getElementById('ms-ring').checked = !!stored.ringOfForging;
      if (stored.activity === 'mining' || stored.activity === 'smithing') activity = stored.activity;
      if (stored.sortKey) sortKey = stored.sortKey;
      if (stored.sortDir === 'asc' || stored.sortDir === 'desc') sortDir = stored.sortDir;
      if (Array.isArray(stored.excludedRockIds)) {
        const known = new Set(ROCKS.map(r => r.id));
        excludedRockIds = new Set(stored.excludedRockIds.filter(id => known.has(id)));
      }
      if (Array.isArray(stored.excludedBarIds)) {
        const known = new Set(BARS.map(b => b.id));
        excludedBarIds = new Set(stored.excludedBarIds.filter(id => known.has(id)));
      }
      if (stored.rockCounts && typeof stored.rockCounts === 'object') rockCounts = { ...stored.rockCounts };
    }
    const defLvl = parseInt(document.getElementById('ms-mining-level').value, 10) || 1;
    buildPickOptions(defLvl);
    if (stored && PICKS.some(p => p.id === stored.pickId)) {
      document.getElementById('ms-pick-select').value = stored.pickId;
    } else {
      // Default to the best pickaxe the current Mining level can wield.
      document.getElementById('ms-pick-select').value = (PICKS.filter(p => defLvl >= p.reqLevel).pop() || PICKS[0]).id;
    }

    ['ms-mining-level', 'ms-smithing-level', 'ms-efficiency', 'ms-pick-select', 'ms-ring'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', render);
      el.addEventListener('change', render);
    });
    document.querySelectorAll('#ms-rock-table thead th, #ms-bar-table thead th').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.key; if (!key) return;
        if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else { sortKey = key; sortDir = th.dataset.numeric != null ? 'desc' : 'asc'; }
        render();
      });
    });
    document.querySelectorAll('section[data-view="mine-smith"] .activity-btn').forEach(btn => {
      btn.addEventListener('click', () => setActivity(btn.dataset.activity));
    });
    createCharts();
    initialized = true;
    render();
  }

  TO.registerSection('mine-smith', { init, render });
})();
