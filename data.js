// Single source of truth for both training sections.
//
// Loads AFTER fish-catalog.snippet.js (which sets
// window.TRAINING_DATA_FISH_CATALOG with the wiki-scraped per-fish data).
// The catalog is plumbed into sections['fish-cook'].gather.fishCatalog below.
//
// IMPORTANT: starting values for the WC->Fletching section are unverified
// community approximations. Fish-cook section uses wiki-scraped values from
// the {{Skilling success chart}} templates — those are authoritative within
// the wiki's own (community-maintained) ecosystem. See README "Calibration"
// for details on the in-game measurement workflow used to refine them.

// Non-fish rolls on the big net spot's drop table. Each is rolled once per
// fishing action (independently of the fish) and grants Fishing XP only — they
// are never cooked. Catch curves (low/high/req) and XP are from the
// Fishing_spot_(big_net,_harpoon) wiki page. The skills-necklace casket variant
// is omitted (assumes no skills necklace).
const BIG_NET_EXTRA_CATCHES = [
  { id: 'casket',         name: 'Casket',         req: 16, fishXp: 10, low: 1,  high: 2  },
  { id: 'oyster',         name: 'Oyster',         req: 16, fishXp: 10, low: 3,  high: 7  },
  { id: 'leather-gloves', name: 'Leather gloves', req: 16, fishXp: 1,  low: 5,  high: 5  },
  { id: 'seaweed',        name: 'Seaweed',        req: 16, fishXp: 1,  low: 10, high: 10 },
  { id: 'leather-boots',  name: 'Leather boots',  req: 16, fishXp: 1,  low: 10, high: 10 }
];

window.TRAINING_DATA = {
  meta: {
    version: "1.1.4",
    constantsSource: "WC->Fletching: community-derived. Fish->Cooking: scraped from OSRS wiki {{Skilling success chart}} templates.",
    lastVerified: "2026-05-24",
    calibrationStatus: "uncalibrated",
    accuracyNote: "Relative ranking is reliable; absolute XP/h is approximate. Fish-cook numbers come straight from the wiki and should be tight; WC-fletch is more approximate."
  },

  constants: {
    defaultEfficiency: 0.95   // human-latency factor (banking, clicking, etc.)
  },

  sections: {

    // ----------------------------------------------------------------------
    'wc-fletch-fm': {
      label: 'Woodcutting + Fletching + Firemaking',
      blurb: 'Best tree to chop for WC, Fletching, or Firemaking XP/h.',
      gather: {
        skillLabel: 'Woodcutting',
        hiscoresIndex: 9,
        tickSec: 2.4,             // one chop roll every 4 game ticks
        toolLabel: 'Axe',
        tools: [
          { id: 'bronze',  name: 'Bronze',  reqLevel: 1,  power: 1  },
          { id: 'iron',    name: 'Iron',    reqLevel: 1,  power: 5  },
          { id: 'steel',   name: 'Steel',   reqLevel: 6,  power: 8  },
          { id: 'black',   name: 'Black',   reqLevel: 11, power: 10 },
          { id: 'mithril', name: 'Mithril', reqLevel: 21, power: 12 },
          { id: 'adamant', name: 'Adamant', reqLevel: 31, power: 15 },
          { id: 'rune',    name: 'Rune',    reqLevel: 41, power: 18 },
          { id: 'dragon',  name: 'Dragon',  reqLevel: 61, power: 22 },
          { id: 'crystal', name: 'Crystal', reqLevel: 71, power: 25 }
        ],
        // Each tree carries WC params (gatherLevel/gatherXp/baseChop/ratio),
        // an optional `product` block for the bow-fletchable trees, and a
        // `firemaking` block — all trees are burnable.
        // baseChop/ratio for hardwoods are community-derived approximations
        // (the wiki doesn't publish low/high for woodcutting); FM XP and
        // FM level are wiki-verified.
        targets: [
          { id: 'regular',    name: 'Regular tree',  gatherLevel: 1,  gatherXp: 25,   baseChop: 120, ratio: 2,   color: '#c8a06b',
            products: [
              { name: 'Shortbow (u)',     processLevel: 5,  processXp: 5  },
              { name: 'Longbow (u)',      processLevel: 10, processXp: 10 }
            ],
            firemaking: { fmLevel: 1,  fmXp: 40    } },
          { id: 'achey',      name: 'Achey tree',    gatherLevel: 1,  gatherXp: 25,   baseChop: 110, ratio: 2,   color: '#a3804f',
            firemaking: { fmLevel: 1,  fmXp: 40    } },
          { id: 'oak',        name: 'Oak',           gatherLevel: 15, gatherXp: 37.5, baseChop: 70,  ratio: 2,   color: '#8f9d4f',
            products: [
              { name: 'Oak shortbow (u)', processLevel: 20, processXp: 16.5 },
              { name: 'Oak longbow (u)',  processLevel: 25, processXp: 25   }
            ],
            firemaking: { fmLevel: 15, fmXp: 60    } },
          { id: 'willow',     name: 'Willow',        gatherLevel: 30, gatherXp: 67.5, baseChop: 40,  ratio: 2,   color: '#7eb47e',
            products: [
              { name: 'Willow shortbow (u)', processLevel: 35, processXp: 33.3 },
              { name: 'Willow longbow (u)',  processLevel: 40, processXp: 41.5 }
            ],
            firemaking: { fmLevel: 30, fmXp: 90    } },
          { id: 'teak',       name: 'Teak',          gatherLevel: 35, gatherXp: 85,   baseChop: 30,  ratio: 2,   color: '#b06f3c',
            firemaking: { fmLevel: 35, fmXp: 105   } },
          { id: 'jatoba',     name: 'Jatoba',        gatherLevel: 40, gatherXp: 92,   baseChop: 25,  ratio: 2,   color: '#a55a2d',
            firemaking: { fmLevel: 40, fmXp: 120   } },
          { id: 'maple',      name: 'Maple',         gatherLevel: 45, gatherXp: 100,  baseChop: 25,  ratio: 2,   color: '#d68754',
            products: [
              { name: 'Maple shortbow (u)', processLevel: 50, processXp: 50   },
              { name: 'Maple longbow (u)',  processLevel: 55, processXp: 58.3 }
            ],
            firemaking: { fmLevel: 45, fmXp: 135   } },
          { id: 'mahogany',   name: 'Mahogany',      gatherLevel: 50, gatherXp: 125,  baseChop: 18,  ratio: 2,   color: '#5a3220',
            firemaking: { fmLevel: 50, fmXp: 157.5 } },
          { id: 'arcticPine', name: 'Arctic pine',   gatherLevel: 54, gatherXp: 40,   baseChop: 16,  ratio: 2,   color: '#3a5840',
            firemaking: { fmLevel: 42, fmXp: 125   } },
          { id: 'yew',        name: 'Yew',           gatherLevel: 60, gatherXp: 175,  baseChop: 12,  ratio: 2.5, color: '#527a4e',
            products: [
              { name: 'Yew shortbow (u)', processLevel: 65, processXp: 67.5 },
              { name: 'Yew longbow (u)',  processLevel: 70, processXp: 75   }
            ],
            firemaking: { fmLevel: 60, fmXp: 202.5 } },
          { id: 'blisterwood',name: 'Blisterwood',   gatherLevel: 62, gatherXp: 76,   baseChop: 10,  ratio: 2,   color: '#76273a',
            firemaking: { fmLevel: 62, fmXp: 96    } },
          { id: 'camphor',    name: 'Camphor',       gatherLevel: 66, gatherXp: 143.5,baseChop: 7,   ratio: 2,   color: '#7a8056',
            firemaking: { fmLevel: 66, fmXp: 180   } },
          { id: 'magic',      name: 'Magic',         gatherLevel: 75, gatherXp: 250,  baseChop: 4,   ratio: 2,   color: '#7b6cd9',
            products: [
              { name: 'Magic shortbow (u)', processLevel: 80, processXp: 83.3 },
              { name: 'Magic longbow (u)',  processLevel: 85, processXp: 91.5 }
            ],
            firemaking: { fmLevel: 75, fmXp: 303.8 } },
          { id: 'ironwood',   name: 'Ironwood',      gatherLevel: 80, gatherXp: 175,  baseChop: 5,   ratio: 2,   color: '#6e6e6e',
            firemaking: { fmLevel: 80, fmXp: 220.5 } },
          { id: 'redwood',    name: 'Redwood',       gatherLevel: 90, gatherXp: 380,  baseChop: 3,   ratio: 2,   color: '#a02020',
            firemaking: { fmLevel: 90, fmXp: 350   } },
          { id: 'rosewood',   name: 'Rosewood',      gatherLevel: 92, gatherXp: 212.5,baseChop: 3,   ratio: 2,   color: '#8f5a76',
            firemaking: { fmLevel: 92, fmXp: 268   } }
        ]
      },
      process: {
        skillLabel: 'Fletching',
        hiscoresIndex: 10,
        actionSec: 1.8            // one unstrung bow per 3 game ticks
      },
      // Firemaking model: success scales linearly from 65/256 at level 1 to
      // 256/256 at level 43; above 43 every attempt succeeds. Failed ignition
      // does NOT consume the log — you just retry — so the expected time per
      // lit log = burnTickSec / p_success.
      burn: {
        skillLabel: 'Firemaking',
        hiscoresIndex: 12,
        burnTickSec: 2.4,         // one ignition attempt every 4 ticks
        baseSuccess: 65,          // out of 256 at level 1
        maxSuccess: 256,          // hit at guaranteedLevel and above
        guaranteedLevel: 43
      }
    },

    // ----------------------------------------------------------------------
    'fish-cook': {
      label: 'Fishing + Cooking',
      blurb: 'Best fishing spot for combined fishing & cooking XP/h.',
      gather: {
        skillLabel: 'Fishing',
        hiscoresIndex: 11,
        tickSec: 0.6,             // wiki rates are per game tick

        // Harpoon-tier dropdown — the only meaningful tool choice. Spots in
        // the harpoon family use this; other spots use their mandated tool.
        harpoonTiers: [
          { id: 'harpoon',          name: 'Harpoon',          reqLevel: 1,  catchKey: 'harpoon' },
          { id: 'dragon-harpoon',   name: 'Dragon harpoon',   reqLevel: 61, catchKey: 'dragon-harpoon' },
          { id: 'crystal-harpoon',  name: 'Crystal harpoon',  reqLevel: 71, catchKey: 'crystal-harpoon' },
          { id: 'infernal-harpoon', name: 'Infernal harpoon', reqLevel: 75, catchKey: 'dragon-harpoon',
            autoCook: { chance: 1/3, xpMul: 0.5 } }
        ],

        // The comparison rows. Each spot lists the fish that roll there,
        // priority-ordered (highest-level fish first — matches the OSRS
        // cascade where higher-tier fish are checked first). EXCEPTION:
        // `toolFamily: 'big-net'` spots don't cascade — each listed fish is
        // rolled independently every action (so several can be caught at
        // once), `rollCounts` overrides how many times a fish is rolled (raw
        // mackerel is rolled twice), and `extraCatches` are the non-fish rolls
        // (caskets etc.) that add Fishing XP only. See spotRates() in
        // fish-cook.js and BIG_NET_EXTRA_CATCHES above.
        spots: [
          { id: 'small-net-coastal',     name: 'Net spot (coastal)',            toolFamily: 'small-net',     mandatedTool: { catchKey: 'default', name: 'Small fishing net' },        minFishLevel: 1,  fishIds: ['anchovy', 'shrimp'] },
          { id: 'bait-river',            name: 'Bait spot (river)',             toolFamily: 'rod-bait',      mandatedTool: { catchKey: 'default', name: 'Fishing rod + bait' },       minFishLevel: 5,  fishIds: ['pike', 'herring', 'sardine'] },
          { id: 'fly-river',             name: 'Fly spot (river)',              toolFamily: 'fly-rod',       mandatedTool: { catchKey: 'default', name: 'Fly fishing rod' },          minFishLevel: 20, fishIds: ['salmon', 'trout'] },
          { id: 'cage-harpoon-coastal-harpoon',  name: 'Cage/Harpoon spot (coastal)',          toolFamily: 'harpoon',                                                                                    minFishLevel: 35,                fishIds: ['swordfish', 'tuna'] },
          { id: 'cage-harpoon-coastal-cage',     name: 'Cage/Harpoon spot (coastal)',          toolFamily: 'lobster-pot', mandatedTool: { catchKey: 'default', name: 'Lobster pot' },                    minFishLevel: 40,                fishIds: ['lobster'] },
          { id: 'cage-harpoon-guild-harpoon',    name: 'Cage/Harpoon spot (Fishing Guild)',    toolFamily: 'harpoon',                                                                                    minFishLevel: 68, levelBoost: 7, fishIds: ['swordfish', 'tuna'] },
          { id: 'cage-harpoon-guild-cage',       name: 'Cage/Harpoon spot (Fishing Guild)',    toolFamily: 'lobster-pot', mandatedTool: { catchKey: 'default', name: 'Lobster pot' },                    minFishLevel: 68, levelBoost: 7, fishIds: ['lobster'] },
          { id: 'big-net-harpoon-coastal-net',   name: 'Big net/Harpoon spot (coastal)',       toolFamily: 'big-net',     mandatedTool: { catchKey: 'default', name: 'Big fishing net' },                minFishLevel: 16,                fishIds: ['bass', 'cod', 'mackerel'], rollCounts: { mackerel: 2 }, extraCatches: BIG_NET_EXTRA_CATCHES },
          { id: 'big-net-harpoon-coastal-harpoon', name: 'Big net/Harpoon spot (coastal)',     toolFamily: 'harpoon',                                                                                    minFishLevel: 76,                fishIds: ['shark'] },
          { id: 'big-net-harpoon-guild-net',     name: 'Big net/Harpoon spot (Fishing Guild)', toolFamily: 'big-net',     mandatedTool: { catchKey: 'default', name: 'Big fishing net' },                minFishLevel: 68, levelBoost: 7, fishIds: ['bass', 'cod', 'mackerel'], rollCounts: { mackerel: 2 }, extraCatches: BIG_NET_EXTRA_CATCHES },
          { id: 'big-net-harpoon-guild-harpoon', name: 'Big net/Harpoon spot (Fishing Guild)', toolFamily: 'harpoon',                                                                                    minFishLevel: 76, levelBoost: 7, fishIds: ['shark'] },
          { id: 'monkfish-piscatoris',   name: 'Piscatoris monkfish colony',    toolFamily: 'small-net',     mandatedTool: { catchKey: 'default', name: 'Small fishing net' },        minFishLevel: 62, fishIds: ['monkfish'] },
          { id: 'anglerfish-piscarilius',name: 'Piscarilius anglerfish',        toolFamily: 'rod-sandworms', mandatedTool: { catchKey: 'default', name: 'Fishing rod + sandworms' },  minFishLevel: 82, fishIds: ['anglerfish'] },
          { id: 'dark-crab-wra',         name: 'Dark crab (WRA)',               toolFamily: 'lobster-pot',   mandatedTool: { catchKey: 'default', name: 'Lobster pot + dark bait' },  minFishLevel: 85, fishIds: ['darkCrab'] }
        ],

        // Internal per-fish lookup, populated from fish-catalog.snippet.js.
        // Each entry: { id, name, color, fishLevel, fishXp, cookLevel,
        // cookXp, gauntletsAffected, catch: {<catchKey>: {low, high, req}},
        // cook: {<methodId>: {low, high, req}}, [cookGauntlets: ...] }
        fishCatalog: window.TRAINING_DATA_FISH_CATALOG || []
      },
      process: {
        skillLabel: 'Cooking',
        hiscoresIndex: 8,
        actionSec: 2.4,           // one cook attempt every 4 game ticks

        methodOptions: [
          { id: 'range',       name: 'Range',                            wikiKey: 'range' },
          { id: 'fire',        name: 'Fire',                             wikiKey: 'fire' },
          { id: 'lumbridge',   name: 'Lumbridge range (Cook’s Assistant)', wikiKey: 'lumbridge' },
          { id: 'hosidius-5',  name: 'Hosidius range (Easy Kourend diary)',     wikiKey: 'hosidius-5' },
          { id: 'hosidius-10', name: 'Hosidius range (Elite Kourend diary)',    wikiKey: 'hosidius-10' }
        ],

        gauntlets: { affectedField: 'gauntletsAffected' }
      }
    },

    // ----------------------------------------------------------------------
    'thieving': {
      label: 'Thieving',
      blurb: 'Best pickpocket target or stall for Thieving XP/h.',
      skillLabel: 'Thieving',
      hiscoresIndex: 18,

      // Pickpocket success boosts. They stack multiplicatively onto the base
      // success curve's low/high (verified against the wiki's pre-computed
      // gear series). Pickpocketing only — stalls are unaffected.
      gear: [
        { id: 'gloves', label: 'Gloves of silence',   mult: 1.05 },
        { id: 'cape',   label: 'Thieving cape',        mult: 1.10 },
        { id: 'ardue',  label: 'Ardougne Hard diary',  mult: 1.10 }
      ],

      pickpocket: {
        // An attempt every 2 ticks (1.2s); a failure stuns you out of
        // pickpocketing for 8 ticks (4.8s). Success curve per target uses the
        // same {{Skilling success chart}} interpolation as the fishing data.
        attemptSec: 1.2,
        stunSec: 4.8,
        targets: (window.TRAINING_DATA_THIEVING && window.TRAINING_DATA_THIEVING.pickpocket) || []
      },

      stalls: {
        // Success is 100% once the level requirement is met; XP/h is gated by
        // each stall's respawn time (xp / respawn).
        entries: (window.TRAINING_DATA_THIEVING && window.TRAINING_DATA_THIEVING.stalls) || []
      }
    }
  }
};
