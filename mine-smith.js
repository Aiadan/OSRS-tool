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

  TO.registerSection('mine-smith', { init: () => {}, render: () => {} });
})();
