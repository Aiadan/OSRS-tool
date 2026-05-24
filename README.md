# Training Optimizer

A standalone single-page calculator that answers "what should I be doing right now to maximise XP/hour in this cross-skill activity?" for OSRS. Currently covers two scenarios:

- **Woodcutting + Fletching + Firemaking** — best tree for WC, Fletching, or Firemaking XP/h. Covers 16 trees including all hardwoods (Achey, Teak, Mahogany, Arctic pine, Blisterwood, Jatoba, Camphor, Ironwood, Redwood, Rosewood). Three recommendations side-by-side: best for WC, best for Fletching, best for Firemaking.
- **Fishing + Cooking** — best fishing spot for combined fishing & cooking XP/h (recommends top spot for each side-by-side).

Open `index.html` in any modern browser. No build step, no install — Chart.js loads from a CDN.

## Navigating between sections

On first open, the **startpage** (`#/`) shows both scenarios as cards. Click one to enter. The URL hash updates, and your choice is remembered in `localStorage` (`training-optimizer:last-section`) — re-opening the page jumps you straight back into the section you last used. The "← All training tools" link in the top toolbar returns to the startpage without clearing the remembered section.

You can also deep-link by typing the hash directly: `#/wc-fletch-fm` or `#/fish-cook`.

## Shared RSN import

The **RSN** field in the top toolbar appears on every view. Type your in-game name and click **Lookup hiscores** — the tool fetches your levels for all four relevant skills (Woodcutting, Fletching, Fishing, Cooking) in one request and updates whichever section's inputs match. The RSN is saved in `localStorage`.

Behind the scenes the tool hits `https://oldschool.runescape.wiki/cors/m=hiscore_oldschool/index_lite.ws?player=<RSN>`, the same CORS-permissive proxy the wiki's own calculators use. Response is plain text, one line per skill (`rank,level,xp`). Hiscores only update when you log out, so the level can lag real-time play by a few minutes.

## Woodcutting + Fletching + Firemaking

Pick your WC, Fletching, Firemaking levels, axe, and an efficiency factor. The tool ranks 16 trees across three modes — pure chop (WC XP/h), chop+fletch into unstrung bows (Fletch XP/h, six bow trees only), and chop+burn (FM XP/h, every tree). Three recommendation cards highlight the best tree for each mode.

**Firemaking model.** Ignition success scales linearly from 65/256 at level 1 to 256/256 at level 43; above level 43 every attempt succeeds. A failed ignition doesn't consume the log (you just retry), so expected time per lit log is `2.4s / p_success`. Total chop+burn time per log = chop time + ignition time.

**Calibration note.** The axe-power and tree base-chance constants are community-derived approximations (no authoritative wiki values exist for woodcutting chance). Firemaking XP values per tree, FM unlock levels, and the 65→256 ignition curve are wiki-verified. **Relative ranking between trees is reliable; absolute XP/h is approximate, especially for the Varlamore woods (Jatoba, Camphor, Ironwood, Rosewood) whose chop rates are estimated.**

To tighten the numbers, do in-game measurement:
- Pick a (level, axe, tree) triple. Cut for a fixed wall-clock interval.
- Compare logs gathered against the tool's prediction.
- Edit one value at a time in `data.js` (the axe's `power`, or the tree's `baseChop` / `ratio`) until predicted ≈ observed.
- Update `data.js`'s `meta.calibrationStatus` and `lastVerified` when done.

Sources: [Woodcutting](https://oldschool.runescape.wiki/w/Woodcutting), [Fletching](https://oldschool.runescape.wiki/w/Fletching), [Pay-to-play Woodcutting training](https://oldschool.runescape.wiki/w/Pay-to-play_Woodcutting_training).

## Fishing + Cooking

Pick your Fishing + Cooking levels, harpoon tier, cooking method, gauntlets toggle, and efficiency. The tool ranks **fishing spots** (not individual fish) and shows two recommendations side-by-side: best for Cooking XP/h and best for Fishing XP/h. This matches OSRS gameplay, where a spot rolls each tick for every fish it offers and you can't opt out of specific catches.

**Spots in scope:** Net (coastal), Big net (coastal), Bait (river), Fly (river), Cage/Harpoon (coastal), Fishing Guild harpoon, Lobster (coastal), Piscatoris monkfish, Piscarilius anglerfish, Wilderness Resource Area dark crab.

Excluded for MVP: karambwan (dual-cook option), sacred eel (not cooked), minnow (conversion mechanic), bass (overlaps with shark), barbarian rod (separate spot family).

### How the calc works

Per-fish per-level catch and burn rates are scraped from the wiki's `{{Skilling success chart}}` template parameters using `scrape-fish-data.py` and embedded in `fish-catalog.snippet.js`. The runtime applies the wiki's own formula:

```
value = floor(low*(99-level)/98 + high*(level-1)/98 + 0.5) + 1
chance = clamp(value / 256, 0, 1)
```

At spot level, fish are combined using OSRS's **cascade mechanic**: higher-level fish are rolled first; if a roll succeeds, lower-tier fish in the spot don't get a chance that tick. Combined with the cook step (success/burn) and Infernal harpoon's auto-cook side effect, the calc yields per-spot fish/h, Fishing XP/h, and Cooking XP/h.

### Harpoon tier

Only the harpoon-family spots (Cage/Harpoon coastal, Fishing Guild) use the **Harpoon tier** dropdown. Higher tiers give better catch rates; the wiki publishes separate per-level tables for Harpoon / Dragon harpoon / Crystal harpoon. Infernal harpoon reuses the Dragon harpoon catch curve but auto-cooks ~1/3 of catches (giving 50% Cooking XP, no burn) — the calc folds this into the cook step automatically.

### Cooking gauntlets

The **Cooking gauntlets** checkbox only affects fish the wiki marks as gauntlets-affected: **Lobster, Swordfish, Monkfish, Shark, Anglerfish**. For these, the gauntlets curve from the wiki replaces the normal burn-rate curve. Dark crab and karambwan are NOT affected by gauntlets.

### Calibration note

Per-fish constants come directly from the wiki's templates, so the absolute numbers are as accurate as the wiki itself. The two known approximations:
- **Cascade order** — the calc rolls fish in the order listed in `data.js`'s `spots[].fishIds` (highest-level first). The exact in-engine tie-break order isn't documented; this is the most common community interpretation.
- **Infernal harpoon auto-cook chance** — the wiki language is "approximately 1 in 3"; we use exactly 1/3.

## Refreshing the scraped fish data

If the wiki updates its `{{Skilling success chart}}` parameters, re-run the scraper:

```
python scrape-fish-data.py > fish-catalog.snippet.js
```

Python 3.10+ required. Output goes straight to the file the runtime loads. Commit the updated snippet.

The script fetches each fish's raw and cooked pages directly from the wiki, walks the `<tabber>`-style harpoon-tier sections, parses out the per-series `low`/`high`/`req` parameters, and emits a JS object literal. It prints a per-fish summary to stderr; any unknown series labels are logged so you know whether to extend the label maps in the script.

## Testing

**No automated tests.** Verification is manual:

- **Routing.** Open the page cold (clear `localStorage`) → startpage. Click a section → URL hash updates, section loads. Refresh → lands back on the same section. Click the home link → startpage. Refresh again → still lands on the section (we don't persist 'home' navigation).
- **Hiscores import.** Enter a known RSN → all four level inputs populate. Switch sections → tables/charts reflect new levels in each.
- **WC-fletch numeric:** the calibration scenarios in the section above.
- **Fish-cook numeric:** at Fishing 14 / small-net-coastal spot, only Shrimp listed (anchovy not yet unlocked) and per-tick catch rate matches the wiki's shrimp value at level 14. At Fishing 30 same spot, both Shrimp and Anchovy listed and the cascade combination matches `1 − (1 − p_shrimp)(1 − p_anchovy)`.
- **Edge cases.** Crystal harpoon selected at Fishing 30 → option shows `(req. Fishing 71)`, calc falls back to the highest harpoon tier you qualify for. Lobster spot at Cook 64 with fire → noticeable burn; toggle gauntlets on → success climbs sharply.
- **UI:** open in Chrome and Firefox. Resize to 600px width. Refresh — inputs and last-section restore.

## Note on WikiSync code

`core.js` includes a complete (but **dormant**) WebSocket client for the [WikiSync](https://github.com/weirdgloop/WikiSync) plugin's local server — the same protocol the wiki's DPS calculator uses. It's not wired to any UI in this tool because WikiSync's `GetPlayer` payload currently omits gathering and processing skills (Woodcutting, Fletching, Fishing, Cooking).

The code is kept as a reference implementation for future tools. See the `WikiSync import (DORMANT)` block in `core.js` for the protocol notes and the revival recipe.

## File overview

| File | Purpose |
|------|---------|
| `index.html`              | Page shell: top toolbar + three views (startpage, wc-fletch-fm, fish-cook). |
| `data.js`                 | Sections, spots, harpoon tiers, cook methods. Wraps `fish-catalog.snippet.js`. |
| `fish-catalog.snippet.js` | Auto-generated per-fish data scraped from the wiki. Do not hand-edit. |
| `core.js`                 | Shared utilities, hash router, hiscores lookup, dormant WikiSync client. |
| `wc-fletch-fm.js`         | Woodcutting + Fletching + Firemaking section: calc, table, charts. |
| `fish-cook.js`            | Fishing → Cooking section: per-spot calc with cascade, table, charts. |
| `styles.css`              | Dark theme, startpage cards, top toolbar, table + chart styling. |
| `scrape-fish-data.py`     | One-shot scraper. Run when the wiki updates `{{Skilling success chart}}` data. |
| `README.md`               | This file. |
