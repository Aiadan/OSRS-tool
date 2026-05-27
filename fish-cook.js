// Fishing -> Cooking section. The comparison rows are FISHING SPOTS
// (not individual fish) because OSRS rolls each tick for every fish a spot
// offers — at the small-net spot you start catching anchovies alongside
// shrimp once you hit level 15 with no opt-out. Per-fish numbers come
// from the wiki's {{Skilling success chart}} templates via scrape-fish-data.py
// and are combined at the spot level using the cascade mechanic
// (higher-level fish in the spot roll first).

(function () {
  'use strict';

  const SECTION  = window.TRAINING_DATA.sections['fish-cook'];
  const SPOTS    = SECTION.gather.spots;
  const HARPOONS = SECTION.gather.harpoonTiers;
  const METHODS  = SECTION.process.methodOptions;
  const TICK_S   = SECTION.gather.tickSec;        // 0.6
  const COOK_S   = SECTION.process.actionSec;     // 2.4

  const FISH_CATALOG = SECTION.gather.fishCatalog;
  const FISH_BY_ID = {};
  for (const f of FISH_CATALOG) FISH_BY_ID[f.id] = f;

  const STORAGE_KEY = 'training-optimizer:fish-cook:v1';

  let sortKey = 'cookingXpPerHour';
  let sortDir = 'desc';
  let barChart  = null;
  let lineChart = null;
  let initialized = false;
  // Spot ids the user has excluded — toggled by clicking the table row OR
  // the chart legend. Excluded spots are dropped from best-for selection,
  // overtake projection, bar chart, and line chart. Stored under the old
  // `excludedSpotIds` key for backward compatibility.
  let excludedSpotIds = new Set();

  // ---- Wiki's interp formula (Module:Skilling_success_chart) -------------
  //   value = floor(low*(99-level)/98 + high*(level-1)/98 + 0.5) + 1
  //   chance = clamp(value / 256, 0, 1)
  // Caller is responsible for the upper cap: cook curves pass cookLevel
  // (already clamped 1..99), catch curves may pass fishLevel + invisible
  // boost which the wiki documents as uncapped (Fishing Guild +7 stacks
  // above 99). The formula extrapolates linearly; the value/256 clamp
  // pins the ceiling at 1.0 naturally.
  function interp(low, high, level) {
    const lvl = Math.max(1, level);
    const value = Math.floor(low * (99 - lvl) / 98 + high * (lvl - 1) / 98 + 0.5) + 1;
    return Math.max(0, Math.min(1, value / 256));
  }

  // For a given fish + tool variant, look up the appropriate catch curve.
  // Fallback order: requested key -> 'default' -> 'harpoon' -> first available.
  function catchTableFor(fish, catchKey) {
    if (fish.catch[catchKey]) return fish.catch[catchKey];
    if (fish.catch.default)   return fish.catch.default;
    if (fish.catch.harpoon)   return fish.catch.harpoon;
    const keys = Object.keys(fish.catch);
    return keys.length ? fish.catch[keys[0]] : null;
  }

  // For a given fish + method + gauntlets toggle, look up cook curve.
  // If the fish is gauntlets-affected and the user has gauntlets, prefer
  // cookGauntlets[method]; fall back to the non-gauntlets curve.
  function cookTableFor(fish, methodKey, hasGauntlets) {
    if (hasGauntlets && fish.gauntletsAffected && fish.cookGauntlets) {
      if (fish.cookGauntlets[methodKey]) return fish.cookGauntlets[methodKey];
    }
    if (fish.cook[methodKey]) return fish.cook[methodKey];
    // Try common fallbacks
    if (fish.cook.range)        return fish.cook.range;
    if (fish.cook.fire)         return fish.cook.fire;
    const keys = Object.keys(fish.cook);
    return keys.length ? fish.cook[keys[0]] : null;
  }

  // ---- Pure calc -------------------------------------------------------

  function spotRates({ fishLevel, cookLevel, spot, harpoonTool, cookingMethod, hasGauntlets, efficiency }) {
    const reasons = [];

    // Which tool actually applies at this spot?
    const tool = spot.toolFamily === 'harpoon' ? harpoonTool : spot.mandatedTool;
    const catchKey = tool.catchKey;

    // Cap the harpoon tier the user can actually wield.
    let effectiveCatchKey = catchKey;
    if (spot.toolFamily === 'harpoon' && fishLevel < harpoonTool.reqLevel) {
      // Fall back to the highest harpoon tier the user qualifies for.
      const usable = HARPOONS.filter(h => fishLevel >= h.reqLevel);
      effectiveCatchKey = (usable[usable.length - 1] || HARPOONS[0]).catchKey;
      reasons.push(`Selected ${harpoonTool.name} requires Fishing ${harpoonTool.reqLevel}`);
    }

    // List the fish the user can catch here, ordered as the spot's `fishIds`
    // (the spot definition places higher-level fish first — cascade priority).
    const inSpotFish = spot.fishIds.map(id => FISH_BY_ID[id]).filter(Boolean);
    const eligibleFish = inSpotFish.filter(f => fishLevel >= f.fishLevel);

    if (fishLevel < spot.minFishLevel) reasons.push(`Fishing ${spot.minFishLevel}`);

    const usingInfernalAuto = (spot.toolFamily === 'harpoon' && harpoonTool.autoCook
                               && fishLevel >= harpoonTool.reqLevel) ? harpoonTool.autoCook : null;

    if (eligibleFish.length === 0) {
      // Spot is unusable until next fish unlocks; surface a placeholder result.
      return {
        eligible: false,
        blockingReasons: reasons.length ? reasons : [`Fishing ${spot.minFishLevel}`],
        eligibleFish: [],
        eligibleFishLabel: '—',
        toolName: (spot.displayToolPrefix || '') + tool.name,
        catchKey: effectiveCatchKey,
        catchTimeSec: Infinity,
        avgCookSuccess: 0,
        fishPerHour: 0,
        fishingXpPerHour: 0,
        cookingXpPerHour: 0,
        totalXpPerHour: 0
      };
    }

    // Invisible level boost (e.g. Fishing Guild +7) affects the catch-rate
    // lookup but NOT eligibility — you still can't catch fish above your
    // real level.
    const boost = spot.levelBoost || 0;
    const effectiveFishLevel = fishLevel + boost;   // uncapped: guild +7 stacks above 99

    // Independent per-fish per-tick catch chance using the wiki formula.
    const perFish = eligibleFish.map(f => {
      const tbl = catchTableFor(f, effectiveCatchKey);
      const ratePerTick = tbl ? interp(tbl.low, tbl.high, effectiveFishLevel) : 0;
      const cookTbl = cookTableFor(f, cookingMethod.wikiKey, hasGauntlets);
      let cookSuccess;
      if (cookLevel < f.cookLevel)        cookSuccess = 0;
      else if (cookLevel >= 99)           cookSuccess = 1;       // Cooking cape
      else if (cookTbl)                   cookSuccess = interp(cookTbl.low, cookTbl.high, cookLevel);
      else                                cookSuccess = 1;       // shouldn't happen
      return { f, ratePerTick, cookSuccess };
    });

    let actualSum = 0;
    if (spot.toolFamily === 'big-net') {
      // Big net is NOT a cascade: each fish on the spot's table is rolled
      // independently every action, so several can be caught at once, and
      // `rollCounts` says how many times each is rolled (raw mackerel twice).
      // r.actualP is then the EXPECTED count of that fish per tick (no
      // mutually-exclusive ceiling), and anyCatchPerTick the expected total
      // fish per tick — exactly what the per-fish weighting and secPerCatch
      // (time per fish) downstream already assume.
      const rollCounts = spot.rollCounts || null;
      for (const r of perFish) {
        const rolls = (rollCounts && rollCounts[r.f.id]) || 1;
        r.actualP = rolls * r.ratePerTick;
        actualSum += r.actualP;
      }
    } else {
      // Cascade: spot.fishIds is priority-ordered (highest-level fish first).
      // P(catch fish_i in this tick) = (prod_{j < i} (1 - p_j)) * p_i
      let surviveProb = 1.0;
      for (const r of perFish) {
        r.actualP = surviveProb * r.ratePerTick;
        actualSum += r.actualP;
        surviveProb *= (1 - r.ratePerTick);
      }
    }
    const anyCatchPerTick = actualSum;

    if (anyCatchPerTick <= 0) {
      return {
        eligible: false,
        blockingReasons: reasons.length ? reasons : ['no qualifying fish here'],
        eligibleFish: eligibleFish.map(f => f.id),
        eligibleFishLabel: eligibleFish.map(f => f.name).join(', '),
        toolName: (spot.displayToolPrefix || '') + tool.name,
        catchKey: effectiveCatchKey,
        catchTimeSec: Infinity,
        avgCookSuccess: 0,
        fishPerHour: 0,
        fishingXpPerHour: 0,
        cookingXpPerHour: 0,
        totalXpPerHour: 0
      };
    }

    // When a catch happens, the relative share each fish contributes.
    let expectedFishingXp = 0;
    let expectedCookXp    = 0;
    let avgCookSuccess    = 0;
    for (const r of perFish) {
      const weight = r.actualP / anyCatchPerTick;
      expectedFishingXp += weight * r.f.fishXp;
      avgCookSuccess    += weight * r.cookSuccess;
      if (usingInfernalAuto) {
        const a = usingInfernalAuto;
        expectedCookXp +=
          weight * ((1 - a.chance) * r.cookSuccess * r.f.cookXp
                  + a.chance       * a.xpMul       * r.f.cookXp);
      } else {
        expectedCookXp += weight * r.cookSuccess * r.f.cookXp;
      }
    }

    // Combined-time: catch time + cook time per produced fish. Infernal
    // skips the cook step for `chance` fraction of catches.
    const secPerCatch = TICK_S / anyCatchPerTick;
    const cookSecPerFish = usingInfernalAuto
      ? (1 - usingInfernalAuto.chance) * COOK_S
      : COOK_S;
    const totalSec = secPerCatch + cookSecPerFish;
    const fishPerHour = (3600 / totalSec) * efficiency;

    // Big net also nets non-fish items (caskets, oysters, seaweed, leather
    // boots/gloves) in the SAME action as the fish: they grant Fishing XP but
    // are never cooked and don't change catch timing (rolled independently
    // alongside the fish). Their XP/h = actions/h * expected non-fish XP per
    // action, where actions/h = fishPerHour / anyCatchPerTick (fish caught per
    // hour ÷ fish caught per action).
    let extraFishingXpPerHour = 0;
    if (spot.extraCatches && anyCatchPerTick > 0) {
      const actionsPerHour = fishPerHour / anyCatchPerTick;
      let extraXpPerTick = 0;
      for (const item of spot.extraCatches) {
        if (fishLevel < item.req) continue;
        const p = interp(item.low, item.high, effectiveFishLevel);
        const rolls = (spot.rollCounts && spot.rollCounts[item.id]) || 1;
        extraXpPerTick += rolls * p * item.fishXp;
      }
      extraFishingXpPerHour = actionsPerHour * extraXpPerTick;
    }

    return {
      eligible: reasons.length === 0,
      blockingReasons: reasons,
      eligibleFish: eligibleFish.map(f => f.id),
      eligibleFishLabel: eligibleFish.map(f => f.name).join(', '),
      toolName: (spot.displayToolPrefix || '') + tool.name,
      catchKey: effectiveCatchKey,
      catchTimeSec: secPerCatch,
      avgCookSuccess,
      fishPerHour,
      fishingXpPerHour: fishPerHour * expectedFishingXp + extraFishingXpPerHour,
      cookingXpPerHour: fishPerHour * expectedCookXp,
      totalXpPerHour:   fishPerHour * (expectedFishingXp + expectedCookXp) + extraFishingXpPerHour
    };
  }

  // P(this tick yields some fish) at a Fishing level, using the same catch key
  // the live rate resolved. Cascade: 1 - prod(1 - p_i). Big-net: sum of p_i
  // (expected catches/tick; may exceed 1, mirroring catchTimeSec).
  function anyCatchChance(spot, fishLevel, catchKey) {
    const eff = fishLevel + (spot.levelBoost || 0);
    const ps = spot.fishIds.map(id => FISH_BY_ID[id]).filter(Boolean)
      .filter(f => fishLevel >= f.fishLevel)
      .map(f => { const t = catchTableFor(f, catchKey); return t ? interp(t.low, t.high, eff) : 0; });
    if (!ps.length) return 0;
    if (spot.toolFamily === 'big-net') return ps.reduce((s, p) => s + p, 0);
    return 1 - ps.reduce((surv, p) => surv * (1 - p), 1);
  }
  // [{name, p}] per eligible fish, for the hover tooltip on multi-fish spots.
  function perFishChances(spot, fishLevel, catchKey) {
    const eff = fishLevel + (spot.levelBoost || 0);
    return spot.fishIds.map(id => FISH_BY_ID[id]).filter(Boolean)
      .filter(f => fishLevel >= f.fishLevel)
      .map(f => { const t = catchTableFor(f, catchKey); return { name: f.name, p: t ? interp(t.low, t.high, eff) : 0 }; });
  }

  // Sweep fishing level 1..99 holding cookLevel constant. `ratesKey` selects
  // which XP axis to chart (cookingXpPerHour | fishingXpPerHour | totalXpPerHour).
  function spotCurve({ spot, harpoonTool, cookingMethod, hasGauntlets, cookLevel, efficiency, ratesKey }) {
    const out = [];
    for (let lvl = 1; lvl <= 99; lvl++) {
      const r = spotRates({
        fishLevel: lvl, cookLevel,
        spot, harpoonTool, cookingMethod, hasGauntlets, efficiency
      });
      out.push(lvl < spot.minFishLevel ? 0 : (r[ratesKey] || 0));
    }
    return out;
  }

  // For a spot the user hasn't unlocked yet, project its rates at the level it
  // first opens up: the Fishing level that actually unlocks the spot (its
  // `minFishLevel`, which for guild spots is the guild entry req, not the
  // lowest fish's level), and — for cooking — the higher of the user's current
  // Cooking level and the minimum needed to cook what's catchable there (so a
  // player whose Cooking already outpaces their Fishing keeps their real cook
  // success). Returns null if the spot has no fish or still yields nothing at
  // unlock. Used only to replace the flat 0 XP/h otherwise shown for locked
  // spots in the table.
  function unlockProjection(spot, harpoonTool, cookingMethod, hasGauntlets, efficiency, cookLevel) {
    const inSpotFish = spot.fishIds.map(id => FISH_BY_ID[id]).filter(Boolean);
    if (!inSpotFish.length) return null;
    const unlockFishLevel = Math.max(spot.minFishLevel || 1, Math.min(...inSpotFish.map(f => f.fishLevel)));
    const firstFish = inSpotFish.filter(f => f.fishLevel <= unlockFishLevel);
    const unlockCookLevel = Math.max(1, cookLevel, ...firstFish.map(f => f.cookLevel));
    const rates = spotRates({
      fishLevel: unlockFishLevel, cookLevel: unlockCookLevel,
      spot, harpoonTool, cookingMethod, hasGauntlets, efficiency
    });
    if (!(rates.fishPerHour > 0)) return null;
    return { rates, fishLevel: unlockFishLevel, cookLevel: unlockCookLevel };
  }

  // ---- State + DOM -----------------------------------------------------

  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function saveState(s) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...s, sortKey, sortDir,
        // Kept named `hiddenSpotIds` in storage for backward compat with
        // the prior chart-legend-only toggle; semantics is now full exclusion.
        hiddenSpotIds: Array.from(excludedSpotIds)
      }));
    } catch (e) {}
  }

  function readInputs() {
    return {
      fishLevel:      TO.clampInt('fc-fish-level', 1, 99),
      cookLevel:      TO.clampInt('fc-cook-level', 1, 99),
      harpoonId:      document.getElementById('fc-harpoon-select').value,
      methodId:       document.getElementById('fc-method-select').value,
      hasGauntlets:   document.getElementById('fc-gauntlets').checked,
      efficiency:     TO.clampFloat('fc-efficiency', 0.5, 1)
    };
  }

  function buildHarpoonOptions(currentFishLevel) {
    const sel = document.getElementById('fc-harpoon-select');
    const prev = sel.value;
    sel.innerHTML = '';
    for (const h of HARPOONS) {
      const opt = document.createElement('option');
      opt.value = h.id;
      opt.textContent = (currentFishLevel < h.reqLevel)
        ? `${h.name} (req. Fishing ${h.reqLevel})`
        : h.name;
      sel.appendChild(opt);
    }
    if (prev && HARPOONS.some(h => h.id === prev)) sel.value = prev;
  }

  function buildMethodOptions() {
    const sel = document.getElementById('fc-method-select');
    if (sel.children.length === METHODS.length) return;  // already built
    sel.innerHTML = '';
    for (const m of METHODS) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      sel.appendChild(opt);
    }
  }

  function buildRows(inputs) {
    const harpoonTool   = HARPOONS.find(h => h.id === inputs.harpoonId) || HARPOONS[0];
    const cookingMethod = METHODS.find(m => m.id === inputs.methodId) || METHODS[0];
    return SPOTS.map(spot => {
      const r = spotRates({
        fishLevel: inputs.fishLevel,
        cookLevel: inputs.cookLevel,
        spot, harpoonTool, cookingMethod,
        hasGauntlets: inputs.hasGauntlets,
        efficiency: inputs.efficiency
      });
      // Spots still locked at the current Fishing level read 0 XP/h. Instead
      // of a flat zero, project what the spot would yield at the level it
      // unlocks. best-for/recommendation stays keyed off `rates.eligible`, so
      // these projected rows are never picked as a recommendation; the
      // displayed (and sorted-on) values come from the projection.
      const projection = (!r.eligible && r.fishPerHour === 0)
        ? unlockProjection(spot, harpoonTool, cookingMethod, inputs.hasGauntlets, inputs.efficiency, inputs.cookLevel)
        : null;
      const disp = projection ? projection.rates : r;
      return {
        spot, harpoonTool, cookingMethod, rates: r, projection,
        sortFields: {
          name: spot.name.toLowerCase(),
          minFishLevel: spot.minFishLevel,
          toolName: disp.toolName.toLowerCase(),
          eligibleFishLabel: disp.eligibleFishLabel.toLowerCase(),
          catchTimeSec: isFinite(disp.catchTimeSec) ? disp.catchTimeSec : Number.MAX_SAFE_INTEGER,
          avgCookSuccess: disp.avgCookSuccess,
          fishPerHour: disp.fishPerHour,
          fishingXpPerHour: disp.fishingXpPerHour,
          cookingXpPerHour: disp.cookingXpPerHour,
          totalXpPerHour: disp.totalXpPerHour
        }
      };
    });
  }

  function bestEligibleByKey(rows, key) {
    const e = rows.filter(r => r.rates.eligible && !excludedSpotIds.has(r.spot.id));
    if (!e.length) return null;
    return e.reduce((b, c) => c.rates[key] > b.rates[key] ? c : b);
  }
  // Kept for the recommended-row highlight in the table: best by Cooking XP/h.
  function bestEligible(rows) { return bestEligibleByKey(rows, 'cookingXpPerHour'); }

  function writeRecCell(prefix, best, inputs, primaryXpKey, primaryXpLabel) {
    const spotEl   = document.getElementById(`fc-rec-${prefix}-spot`);
    const xpEl     = document.getElementById(`fc-rec-${prefix}-xp`);
    const detailEl = document.getElementById(`fc-rec-${prefix}-detail`);
    if (!best) {
      spotEl.textContent   = 'No eligible spot';
      xpEl.textContent     = '—';
      detailEl.textContent = `At Fishing ${inputs.fishLevel} and Cooking ${inputs.cookLevel}, no spot is fully unlocked yet. The Net spot (coastal) is available from Fishing 1.`;
      return;
    }
    const s = best.spot;
    const r = best.rates;
    spotEl.textContent = `${s.name} — ${r.eligibleFishLabel}`;
    xpEl.textContent   = `${TO.fmt(r[primaryXpKey])} ${primaryXpLabel}`;
    detailEl.textContent =
      `${r.toolName} at Fishing ${inputs.fishLevel}, Cooking ${inputs.cookLevel} · ` +
      `${TO.fmt(r.fishPerHour)} fish/h · ${TO.getDisplayMode() === 'seconds' ? `${TO.fmtTime(r.catchTimeSec)}/catch` : `${TO.fmtPct(TICK_S / r.catchTimeSec)}/tick`} · ` +
      `${TO.fmtPct(r.avgCookSuccess)} avg cook success · ${TO.fmt(r.totalXpPerHour)} total XP/h`;
  }

  function renderRecommendation(rows, inputs) {
    const cookBest  = bestEligibleByKey(rows, 'cookingXpPerHour');
    const fishBest  = bestEligibleByKey(rows, 'fishingXpPerHour');
    const totalBest = bestEligibleByKey(rows, 'totalXpPerHour');
    writeRecCell('cook',  cookBest,  inputs, 'cookingXpPerHour', 'Cooking XP/h');
    writeRecCell('fish',  fishBest,  inputs, 'fishingXpPerHour', 'Fishing XP/h');
    writeRecCell('total', totalBest, inputs, 'totalXpPerHour',   'Total XP/h');
    writeOvertake('cook', cookBest, 'cook', inputs);
    writeOvertake('fish', fishBest, 'fish', inputs);
    writeTotalOvertake(totalBest, inputs);
  }

  // ---- Overtake projection ---------------------------------------------
  // Sweeps the rec-cell's primary skill from current+1 to 99 to find the
  // first level at which a different spot becomes the new best, then quotes
  // how many of the current best's catches are needed to reach that level
  // and the wall-clock time at the current XP rate.
  //
  // `spotLevels` decides the (fishLevel, cookLevel) each candidate spot is
  // evaluated at while sweeping. For COOKING we assume you'll also have trained
  // Fishing enough to reach each spot (you level both skills), so spots gated
  // behind a higher Fishing level still compete — otherwise a low-Fishing
  // player is wrongly told no spot ever beats their current one even though
  // higher-tier fish become cookable as Cooking rises. For FISHING the cook
  // level is irrelevant to fishing XP, so it's held at the current value.
  //
  // Per-action XP is derived from the rate triple: per-catch XP = XP/h ÷
  // catches/h. For cooking that includes only the cook component (Cooking
  // XP earned per fish prepared); for fishing it's the fish XP per catch.
  const OVERTAKE_MODES = {
    cook: {
      inputId: 'fc-cook-level', sweepKey: 'cookLevel',
      ratesKey: 'cookingXpPerHour',
      spotLevels: (inputs, spot, L) => ({
        fishLevel: Math.max(inputs.fishLevel, spot.minFishLevel),
        cookLevel: L
      }),
      xpPerAction: (best) => best.rates.fishPerHour > 0
        ? best.rates.cookingXpPerHour / best.rates.fishPerHour : 0,
      actionLabel: (best) => `${best.spot.name} catches`
    },
    fish: {
      inputId: 'fc-fish-level', sweepKey: 'fishLevel',
      ratesKey: 'fishingXpPerHour',
      spotLevels: (inputs, spot, L) => ({
        fishLevel: L,
        cookLevel: inputs.cookLevel
      }),
      xpPerAction: (best) => best.rates.fishPerHour > 0
        ? best.rates.fishingXpPerHour / best.rates.fishPerHour : 0,
      actionLabel: (best) => `${best.spot.name} catches`
    }
  };

  function findOvertake(currentBest, modeCfg, inputs) {
    const startLevel = inputs[modeCfg.sweepKey];
    if (startLevel >= 99) return null;
    const harpoonTool   = HARPOONS.find(h => h.id === inputs.harpoonId) || HARPOONS[0];
    const cookingMethod = METHODS.find(m => m.id === inputs.methodId) || METHODS[0];
    for (let L = startLevel + 1; L <= 99; L++) {
      const rowsAtL = SPOTS.map(spot => {
        const lv = modeCfg.spotLevels(inputs, spot, L);
        return {
          spot,
          rates: spotRates({
            fishLevel: lv.fishLevel,
            cookLevel: lv.cookLevel,
            spot, harpoonTool, cookingMethod,
            hasGauntlets: inputs.hasGauntlets,
            efficiency: inputs.efficiency
          })
        };
      });
      const best = bestEligibleByKey(rowsAtL, modeCfg.ratesKey);
      if (!best) continue;
      if (best.spot.id !== currentBest.spot.id) {
        return { level: L, newBest: best };
      }
    }
    return null;
  }

  function writeOvertake(prefix, best, mode, inputs) {
    const el = document.getElementById(`fc-rec-${prefix}-overtake`);
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
        `Best spot through <strong>lvl 99</strong> — ` +
        `${TO.fmt(actionsTo99)} more ${cfg.actionLabel(best)} ` +
        `<span class="ot-dim">(≈${TO.fmtDuration(hoursTo99)})</span>`;
      return;
    }
    const xpNeeded = Math.max(0, TO.xpAt(ot.level) - currentXp);
    const actions  = Math.ceil(xpNeeded / xpPerAction);
    const hours    = xpNeeded / xpPerHour;
    // The cook projection assumes Fishing keeps pace, so flag when the new best
    // spot needs a higher Fishing level than the player currently has.
    const needFish = (mode === 'cook' && ot.newBest.spot.minFishLevel > inputs.fishLevel)
      ? ` <span class="ot-dim">(needs Fishing ${ot.newBest.spot.minFishLevel})</span>`
      : '';
    el.innerHTML =
      `Overtaken by <strong>${ot.newBest.spot.name}</strong> at lvl ${ot.level} — ` +
      `${TO.fmt(actions)} more ${cfg.actionLabel(best)} ` +
      `<span class="ot-dim">(≈${TO.fmtDuration(hours)})</span>${needFish}`;
  }

  // ---- Total overtake (single-axis) ------------------------------------
  // Total XP/h depends on BOTH Fishing and Cooking, so there's no single skill
  // to sweep. Per the agreed model we look only for a new best-total spot
  // reachable by raising JUST ONE skill (the other is then already sufficient
  // for that band): sweep Fishing with Cooking held, and Cooking with Fishing
  // held. If both axes find one, show whichever you'd reach first in playtime
  // at the current spot. If neither does (a better band needs both skills
  // raised), leave the line blank — that joint case is deferred.
  function findTotalOvertake(currentBest, inputs) {
    const harpoonTool   = HARPOONS.find(h => h.id === inputs.harpoonId) || HARPOONS[0];
    const cookingMethod = METHODS.find(m => m.id === inputs.methodId) || METHODS[0];
    const ratesAt = (fishLevel, cookLevel) => SPOTS.map(spot => ({
      spot,
      rates: spotRates({ fishLevel, cookLevel, spot, harpoonTool, cookingMethod,
                         hasGauntlets: inputs.hasGauntlets, efficiency: inputs.efficiency })
    }));
    const axes = [
      { skillLabel: 'Fishing', inputId: 'fc-fish-level', rateKey: 'fishingXpPerHour',
        start: inputs.fishLevel, rowsAt: L => ratesAt(L, inputs.cookLevel) },
      { skillLabel: 'Cooking', inputId: 'fc-cook-level', rateKey: 'cookingXpPerHour',
        start: inputs.cookLevel, rowsAt: L => ratesAt(inputs.fishLevel, L) }
    ];
    let best = null;
    for (const ax of axes) {
      if (ax.start >= 99) continue;
      // Grinding the current spot only advances this skill if the spot earns it;
      // if its rate is 0 (e.g. can't cook the catch), this axis never triggers.
      const rateH = currentBest.rates[ax.rateKey];
      if (!(rateH > 0)) continue;
      for (let L = ax.start + 1; L <= 99; L++) {
        const b = bestEligibleByKey(ax.rowsAt(L), 'totalXpPerHour');
        if (!b || b.spot.id === currentBest.spot.id) continue;
        const xpNeeded   = Math.max(0, TO.xpAt(L) - TO.getSkillXp(ax.inputId));
        const hours      = xpNeeded / rateH;
        const xpPerCatch = rateH / currentBest.rates.fishPerHour;
        const catches    = xpPerCatch > 0 ? Math.ceil(xpNeeded / xpPerCatch) : 0;
        if (!best || hours < best.hours) best = { skillLabel: ax.skillLabel, level: L, newBest: b, hours, catches };
        break;
      }
    }
    return best;
  }

  // Joint-increase overtake. When no single skill alone reaches a new band, the
  // realistic path is to TRAIN the current best-total spot — which raises BOTH
  // Fishing and Cooking at that spot's XP rates. Walk that trajectory one
  // level-up at a time (re-picking the best each step) until a different spot
  // becomes best-total; that crossing is the overtake. Returns the level pair
  // plus catches/time to reach it, or null if the spot stays best all the way
  // to the cap (i.e. best through 99 for the path you'd actually take).
  // `getSkillXp` seeds from hiscores when available, else the level's minimum
  // XP — same convention as the single-skill projections.
  function findTrajectoryOvertake(currentBest, inputs) {
    const harpoonTool   = HARPOONS.find(h => h.id === inputs.harpoonId) || HARPOONS[0];
    const cookingMethod = METHODS.find(m => m.id === inputs.methodId) || METHODS[0];
    const startId = currentBest.spot.id;
    const bestAt = (f, c) => bestEligibleByKey(
      SPOTS.map(spot => ({ spot, rates: spotRates({ fishLevel: f, cookLevel: c, spot,
        harpoonTool, cookingMethod, hasGauntlets: inputs.hasGauntlets, efficiency: inputs.efficiency }) })),
      'totalXpPerHour');
    let f = inputs.fishLevel, c = inputs.cookLevel;
    let fishXp = TO.getSkillXp('fc-fish-level');
    let cookXp = TO.getSkillXp('fc-cook-level');
    let hours = 0, catches = 0, guard = 0;
    while ((f < 99 || c < 99) && guard++ < 400) {
      const best = bestAt(f, c);
      if (!best) return null;
      if (best.spot.id !== startId) {
        return { fishLevel: f, cookLevel: c, newBest: best, hours, catches: Math.ceil(catches) };
      }
      const rF = best.rates.fishingXpPerHour, rC = best.rates.cookingXpPerHour;
      // Time to each skill's next level-up at the spot's current rates.
      const tF = (f < 99 && rF > 0) ? Math.max(0, TO.xpAt(f + 1) - fishXp) / rF : Infinity;
      const tC = (c < 99 && rC > 0) ? Math.max(0, TO.xpAt(c + 1) - cookXp) / rC : Infinity;
      const dt = Math.min(tF, tC);
      if (!isFinite(dt)) break;   // neither skill can advance (e.g. a no-cook spot already at Fishing 99)
      hours += dt; catches += best.rates.fishPerHour * dt;
      fishXp += rF * dt; cookXp += rC * dt;
      if (tF <= tC && f < 99) f++;
      if (tC <= tF && c < 99) c++;
    }
    return null;   // never switched on the way to the cap — best-total spot for the whole climb
  }

  function writeTotalOvertake(best, inputs) {
    const el = document.getElementById('fc-rec-total-overtake');
    if (!el) return;
    if (!best) { el.innerHTML = ''; return; }
    if (inputs.fishLevel >= 99 && inputs.cookLevel >= 99) {
      el.innerHTML = `<span class="ot-dim">Already at Fishing &amp; Cooking 99 — nothing left to overtake.</span>`;
      return;
    }
    // 1) A single skill alone reaches a new band (the other is already enough).
    const ot = findTotalOvertake(best, inputs);
    if (ot) {
      el.innerHTML =
        `Overtaken by <strong>${ot.newBest.spot.name}</strong> at ${ot.skillLabel} ${ot.level} — ` +
        `${TO.fmt(ot.catches)} more ${best.spot.name} catches ` +
        `<span class="ot-dim">(≈${TO.fmtDuration(ot.hours)})</span>`;
      return;
    }
    // 2) Joint case: training this spot raises both skills until a new band.
    const traj = findTrajectoryOvertake(best, inputs);
    if (traj) {
      el.innerHTML =
        `Overtaken by <strong>${traj.newBest.spot.name}</strong> at Fishing ${traj.fishLevel}/Cooking ${traj.cookLevel} — ` +
        `${TO.fmt(traj.catches)} more ${best.spot.name} catches ` +
        `<span class="ot-dim">(≈${TO.fmtDuration(traj.hours)}, training both)</span>`;
      return;
    }
    // 3) Never overtaken on the way to the cap.
    el.innerHTML = `Best total spot through <strong>lvl 99</strong>.`;
  }

  // Modes drive the highlighted row AND the charts. The sort key selects
  // the active mode; non-XP sort keys (name, level reqs, catch time, cook
  // success %, fish/h) leave the row un-highlighted and fall back to Cooking
  // XP/h for the charts so they still show something.
  // `hideMax: true` for modes whose rate doesn't depend on Cooking level —
  // Fishing XP/h is purely catch-rate-driven, so its solid and dashed
  // curves coincide and the dashed twin is just noise.
  const MODES = {
    cookingXpPerHour: { label: 'Cooking XP/h', yTitle: 'Cooking XP / h', hideMax: false },
    fishingXpPerHour: { label: 'Fishing XP/h', yTitle: 'Fishing XP / h', hideMax: true  },
    totalXpPerHour:   { label: 'Total XP/h',   yTitle: 'Total XP / h',   hideMax: false }
  };
  function activeMode() {
    return { key: sortKey in MODES ? sortKey : 'cookingXpPerHour', ...((MODES[sortKey]) || MODES.cookingXpPerHour) };
  }
  function bestForHighlight(rows) {
    return sortKey in MODES ? bestEligibleByKey(rows, sortKey) : null;
  }

  function renderTable(rows) {
    const sorted = rows.slice().sort((a, b) => {
      if (a.rates.eligible !== b.rates.eligible) return a.rates.eligible ? -1 : 1;
      const c = TO.compareBy(a, b, sortKey);
      return sortDir === 'asc' ? c : -c;
    });
    const best = bestForHighlight(rows);
    const tbody = document.getElementById('fc-results-tbody');
    tbody.innerHTML = '';
    const fishLevelNow = readInputs().fishLevel;
    for (const row of sorted) {
      const tr = document.createElement('tr');
      const isExcluded = excludedSpotIds.has(row.spot.id);
      if (!row.rates.eligible) tr.classList.add('ineligible');
      if (isExcluded) tr.classList.add('excluded');
      if (best && row.spot.id === best.spot.id) tr.classList.add('recommended');
      // Locked spots display projected unlock-level rates (see buildRows)
      // instead of zeros; everything else shows live rates.
      const cells = row.projection ? row.projection.rates : row.rates;
      const titleParts = [];
      if (row.rates.blockingReasons.length) titleParts.push('Needs: ' + row.rates.blockingReasons.join(' & '));
      if (row.projection) titleParts.push(`XP/h projected at Fishing ${row.projection.fishLevel}, Cooking ${row.projection.cookLevel} (unlock)`);
      titleParts.push(isExcluded ? 'Click to include this spot again.' : 'Click to exclude this spot from best-for picks.');
      tr.title = titleParts.join(' — ');
      const catchKey = cells.catchKey;
      const pAny = isFinite(cells.catchTimeSec) ? TICK_S / cells.catchTimeSec : 0;
      const fishFull = TO.fullSuccessLevel(L => anyCatchChance(row.spot, L, catchKey), row.spot.minFishLevel);
      const cap99 = anyCatchChance(row.spot, 99, catchKey);
      const catchNote = TO.actionNote({
        levelAtFull:  fishFull,
        floorSeconds: TICK_S,
        capChance:    cap99,
        capSeconds:   TICK_S / cap99,
        currentLevel: fishLevelNow
      });
      const pf = perFishChances(row.spot, fishLevelNow, catchKey);
      const catchTitle = pf.length > 1
        ? ` title="${pf.map(x => `${x.name}: ${TO.fmtPct(x.p)}/tick`).join('&#10;')}"`
        : '';
      const catchVal = (TO.getDisplayMode() === 'seconds')
        ? (isFinite(cells.catchTimeSec) ? TO.fmtTime(cells.catchTimeSec) : '—')
        : TO.fmtActionRate(pAny, cells.catchTimeSec);
      const fishLabel = cells.eligibleFishLabel || '—';
      const fishCell = row.projection
        ? `${fishLabel} <span class="ot-dim">(@ Fishing ${row.projection.fishLevel})</span>`
        : fishLabel;
      tr.innerHTML = `
        <td class="tree-name">${row.spot.name}</td>
        <td class="numeric">${row.spot.minFishLevel}</td>
        <td>${cells.toolName}</td>
        <td>${fishCell}</td>
        <td class="numeric"${catchTitle}>${catchVal}${catchNote ? `<span class="success-note">${catchNote}</span>` : ''}</td>
        <td class="numeric">${TO.fmtPct(cells.avgCookSuccess)}</td>
        <td class="numeric">${TO.fmt(cells.fishPerHour)}</td>
        <td class="numeric">${TO.fmt(cells.fishingXpPerHour)}</td>
        <td class="numeric">${TO.fmt(cells.cookingXpPerHour)}</td>
        <td class="numeric">${TO.fmt(cells.totalXpPerHour)}</td>
      `;
      tr.addEventListener('click', () => {
        if (excludedSpotIds.has(row.spot.id)) excludedSpotIds.delete(row.spot.id);
        else excludedSpotIds.add(row.spot.id);
        render();
      });
      tbody.appendChild(tr);
    }
    document.querySelectorAll('#fc-results-table thead th').forEach(th => {
      th.classList.remove('sorted', 'asc', 'desc');
      if (th.dataset.key === sortKey) th.classList.add('sorted', sortDir);
    });
    const ccTh = document.querySelector('#fc-results-table thead th[data-key="catchTimeSec"]');
    if (ccTh) ccTh.textContent = (TO.getDisplayMode() === 'seconds') ? 'Catch / fish' : 'Catch chance';
  }

  // Build a deterministic colour per spot using its first fish's catalog color,
  // falling back to a fixed palette.
  const SPOT_FALLBACK_COLORS = ['#c8a06b', '#8f9d4f', '#7eb47e', '#d68754', '#527a4e', '#7b6cd9', '#c8553d', '#5a8fa8', '#9b6b8a', '#444'];
  function spotColor(spot, idx) {
    const firstFish = FISH_BY_ID[spot.fishIds[0]];
    return (firstFish && firstFish.color) || SPOT_FALLBACK_COLORS[idx % SPOT_FALLBACK_COLORS.length];
  }

  function createCharts() {
    const barCtx = document.getElementById('fc-bar-chart').getContext('2d');
    barChart = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: SPOTS.map(s => s.name),
        datasets: [{
          label: 'Cooking XP/h',
          data: SPOTS.map(() => 0),
          backgroundColor: SPOTS.map((s, i) => spotColor(s, i)),
          borderColor: SPOTS.map((s, i) => spotColor(s, i)),
          borderWidth: 1
        }]
      },
      options: TO.chartCommon({
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${TO.fmt(ctx.parsed.y)} XP/h` } } },
        scales: { x: TO.axisOpts(), y: TO.axisOpts({ beginAtZero: true }) }
      })
    });

    // Pair every spot with a "max" twin: solid for current Cooking level,
    // dashed for Cooking 99. Modes whose rates don't depend on cook level
    // (e.g. Fishing XP/h) will draw the two as overlapping single lines.
    const lineDatasets = [];
    SPOTS.forEach((s, i) => {
      const color = spotColor(s, i);
      lineDatasets.push({
        label: s.name, data: [],
        borderColor: color, backgroundColor: color,
        borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.15
      });
      lineDatasets.push({
        label: s.name + ' (max)', data: [],
        borderColor: color, backgroundColor: color,
        borderWidth: 1.5, borderDash: [4, 4],
        pointRadius: 0, pointHoverRadius: 4, tension: 0.15
      });
    });
    const lineCtx = document.getElementById('fc-line-chart').getContext('2d');
    lineChart = new Chart(lineCtx, {
      type: 'line',
      data: {
        labels: Array.from({ length: 99 }, (_, i) => i + 1),
        datasets: lineDatasets
      },
      options: TO.chartCommon({
        plugins: {
          legend: {
            labels: {
              color: '#e8e7e3',
              filter: (item) => !/ \(max\)$/.test(item.text)
            },
            onClick: (e, item) => {
              const idx = item.datasetIndex;
              const spot = SPOTS[Math.floor(idx / 2)];
              if (!spot) return;
              if (excludedSpotIds.has(spot.id)) excludedSpotIds.delete(spot.id);
              else                            excludedSpotIds.add(spot.id);
              // render() applies the new visibility AND persists to storage.
              render();
            }
          },
          tooltip: {
            callbacks: { label: ctx => `${ctx.dataset.label}: ${TO.fmt(ctx.parsed.y)} XP/h` }
          }
        },
        scales: {
          x: TO.axisOpts({ title: { display: true, text: 'Fishing level', color: '#9a9890' } }),
          y: TO.axisOpts({ beginAtZero: true, title: { display: true, text: 'Cooking XP / h', color: '#9a9890' } })
        }
      })
    });
  }

  function updateCharts(rows, inputs) {
    const harpoonTool   = HARPOONS.find(h => h.id === inputs.harpoonId) || HARPOONS[0];
    const cookingMethod = METHODS.find(m => m.id === inputs.methodId) || METHODS[0];
    const mode = activeMode();

    barChart.data.datasets[0].label = mode.label;
    barChart.data.datasets[0].data = rows.map(r =>
      r.rates.eligible && !excludedSpotIds.has(r.spot.id) ? Math.round(r.rates[mode.key]) : 0);
    barChart.data.datasets[0].backgroundColor = rows.map((r, i) => {
      if (excludedSpotIds.has(r.spot.id)) return 'rgba(80,80,80,0.35)';
      return r.rates.eligible ? spotColor(r.spot, i) : 'rgba(150,150,150,0.25)';
    });
    barChart.update();

    // Paired datasets: [spot0-current, spot0-max, spot1-current, ...].
    // Solid uses inputs.cookLevel; dashed uses 99 (the ceiling). Visibility
    // = persisted legend-toggle state, OR'd with the mode's hideMax flag
    // for the dashed twin so Fishing-XP mode hides its redundant duplicate.
    lineChart.data.datasets.forEach((ds, i) => {
      const spot  = SPOTS[Math.floor(i / 2)];
      const isMax = (i % 2) === 1;
      ds.data = spotCurve({
        spot, harpoonTool, cookingMethod,
        hasGauntlets: inputs.hasGauntlets,
        cookLevel: isMax ? 99 : inputs.cookLevel,
        efficiency: inputs.efficiency,
        ratesKey: mode.key
      }).map(v => Math.round(v));
      const userHid = excludedSpotIds.has(spot.id);
      ds.hidden = isMax ? (userHid || mode.hideMax) : userHid;
    });
    if (lineChart.options.scales && lineChart.options.scales.y && lineChart.options.scales.y.title) {
      lineChart.options.scales.y.title.text = mode.yTitle;
    }
    lineChart.update();

    const barH  = document.getElementById('fc-bar-title');
    const lineH = document.getElementById('fc-line-title');
    if (barH)  barH.textContent  = `${mode.label} per spot — current setup`;
    if (lineH) lineH.textContent = `${mode.label} vs Fishing level`;
  }

  // ---- Wiring ----------------------------------------------------------

  function syncModeRail() {
    document.querySelectorAll('section[data-view="fish-cook"] .mode-rail-btn')
      .forEach(btn => btn.classList.toggle('active', btn.dataset.mode === sortKey));
  }

  function render() {
    if (!initialized) return;
    const inputs = readInputs();
    buildHarpoonOptions(inputs.fishLevel);
    document.getElementById('fc-harpoon-select').value = inputs.harpoonId;
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
      document.getElementById('fc-fish-level').value = stored.fishLevel;
      document.getElementById('fc-cook-level').value = stored.cookLevel;
      document.getElementById('fc-efficiency').value = stored.efficiency;
      document.getElementById('fc-gauntlets').checked = !!stored.hasGauntlets;
      if (stored.sortKey && (stored.sortKey in MODES)) sortKey = stored.sortKey;
      if (stored.sortDir === 'asc' || stored.sortDir === 'desc') sortDir = stored.sortDir;
      if (Array.isArray(stored.hiddenSpotIds)) {
        const known = new Set(SPOTS.map(s => s.id));
        excludedSpotIds = new Set(stored.hiddenSpotIds.filter(id => known.has(id)));
      }
    }
    buildHarpoonOptions(parseInt(document.getElementById('fc-fish-level').value, 10));
    buildMethodOptions();
    if (stored && HARPOONS.some(h => h.id === stored.harpoonId)) {
      document.getElementById('fc-harpoon-select').value = stored.harpoonId;
    } else {
      document.getElementById('fc-harpoon-select').value = 'harpoon';
    }
    if (stored && METHODS.some(m => m.id === stored.methodId)) {
      document.getElementById('fc-method-select').value = stored.methodId;
    } else {
      document.getElementById('fc-method-select').value = 'range';
    }

    ['fc-fish-level', 'fc-cook-level', 'fc-efficiency', 'fc-harpoon-select', 'fc-method-select', 'fc-gauntlets'].forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', render);
      el.addEventListener('change', render);
    });
    document.querySelectorAll('#fc-results-table thead th').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.key;
        if (sortKey === key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        else { sortKey = key; sortDir = th.dataset.numeric != null ? 'desc' : 'asc'; }
        render();
      });
    });
    // Mode rail (sticky skill picker).
    document.querySelectorAll('section[data-view="fish-cook"] .mode-rail-btn').forEach(btn => {
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

  TO.registerSection('fish-cook', { init, render });
})();
