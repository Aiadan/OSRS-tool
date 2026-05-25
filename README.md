# OSRS Tool

A standalone single-page tool that answers "what should I be doing right now to maximise XP/hour in this activity?" for OSRS. Open `index.html` in any modern browser — no build step, no install; Chart.js loads from a CDN. A version stamp (read from `data.js`'s `meta.version`) shows next to the title. Three scenarios:

- **Woodcutting + Fletching + Firemaking** — best tree for WC, Fletching, or Firemaking XP/h across 16 trees, all hardwoods included (Achey, Teak, Mahogany, Arctic pine, Blisterwood, Jatoba, Camphor, Ironwood, Redwood, Rosewood). Three recommendations side-by-side.
- **Fishing + Cooking** — best fishing spot for **Fishing**, **Cooking**, or combined **Total** XP/h (three recommendations side-by-side).
- **Thieving** — best pickpocket target or stall for Thieving XP/h, switched by an activity toggle.

It is built for restricted / limited-resource play (chunk-locked runs, etc.): it ranks purely by XP/h with no Grand Exchange / profit angle, and lets you deselect training sources you can't access. See the next section for how that compares to existing tools.

## Why this exists — prior art & positioning

A survey of comparable OSRS XP tools (web, the wiki, GitHub, RuneLite; conducted May 2026) found the *ingredients* of this tool everywhere but the *combination* nowhere. The plain XP-calculator space is saturated, so this tool deliberately occupies a different corner.

**What already exists:**

- **Per-skill "actions/materials to a target level" + GE profit calculators** — the dominant category: the [OSRS Wiki calculators](https://oldschool.runescape.wiki/w/Calculators), [CalcOSRS](https://calcosrs.com/), [oldschool.tools](https://oldschool.tools/calculators/skill), [osrstools.net](https://www.osrstools.net/tools/skill-calculator), [osrstoolkit.com](https://osrstoolkit.com/calculators/). You enter current + target level, pick one method, and get XP / actions / time-to-goal plus live Grand Exchange profit. Profit- and material-centric; XP/h is a static reference number, not a per-level recommendation.
- **Manual pairwise efficiency comparison** — the wiki's *Efficiency method comparison calculator* makes you type in two methods' XP/h and cost yourself, for a single skill. No auto-pick, no per-level curve.
- **Real-time XP trackers** — [RuneLite XP Tracker](https://github.com/runelite/runelite/wiki/XP-Tracker), [Crystal Math Labs](https://crystalmathlabs.com/), [Wise Old Man EHP](https://wiseoldman.net/ehp/main), [TempleOSRS](https://templeosrs.com/). They *measure* your XP/h while you play; they don't recommend a method.
- **Static written guides** — theoatrix, rpgstash, osrsmoneymaking.guide: prose "best method by level," not interactive.
- **GitHub** — mostly profit/xp-rate calculators ([Matthew-nop/OSRSCalculator](https://github.com/Matthew-nop/OSRSCalculator), [lukecamelo/osrs-calculator](https://github.com/lukecamelo/osrs-calculator)), single-skill optimal-path tools, and quest/progress planners. None model combined gathering+processing or pick the best XP/h spot per level.
- **Chunk-locked tooling** ([Chunk Picker](https://source-chunk.github.io/chunk-picker-v2/), Region Locker plugin) tracks *which chunks/unlocks you have* — never which available source gives the best XP/h.

**What this tool does that those don't:**

| Feature | Prior art |
|---|---|
| Auto-picks the best XP/h method at your *exact current level* | Only as static guides, or the wiki's manual pairwise tool |
| Models **combined gathering→processing throughput** (chop+fletch/burn on shared logs; catch+cook on the same fish, with cascade / independent-roll mechanics) | Not found — closest is the wiki's one-off Underwater Thieving (Thieving+Agility) calc |
| **Overtake-by-level projections** ("X overtakes at level N, ≈ time"), including the joint-trajectory case | Not found anywhere |
| **Pure XP/h, no GE/profit** — a throughput framing suited to limited-resource play | Opposite of nearly every tool, which is profit-first |
| **Deselect unavailable sources** for restricted accounts (chunk-locked, limited resources) | Not found in any XP tool |

**Honest caveats.** The raw constants aren't novel — per-fish/tree/NPC rates come from the same wiki `{{Skilling success chart}}` data everyone uses, and XP-table math is ubiquitous; the novelty is the combined-activity aggregation and per-level recommendation, not the numbers. [EHP](https://wiseoldman.net/ehp/main) rate tables already encode an implicit "best method per level," but as tracking/ranking infrastructure, not an interactive picker, and not for combined activities. The survey was US-region web search and can't see the community's Discord-shared efficiency spreadsheets, so a private equivalent may exist.

**Positioning.** The niche is the *intersection*: an interactive current-level best-XP/h picker × combined gathering+processing modelling × overtake-by-level projections × pure-XP (no profit) × exclude-unavailable-sources. That intersection appears unoccupied, and the limited-resource / chunk-locked angle is essentially unserved on the XP-rate side. The pitch should lead with **combined throughput + per-level overtakes + restricted-account focus** — not "an OSRS XP calculator," since that space is full.

## Navigating between sections

On first open, the **startpage** (`#/`) shows the three scenarios as cards. Click one to enter; the URL hash updates. Your last *explicit* view — a section **or** the startpage — is remembered in `localStorage` (`training-optimizer:last-section`). Opening the bare/root URL (or a bookmark of it) restores that last explicit view, so a returning player drops straight back into the section they were using; but if the last thing you did was deliberately go to the index, the index is what you get. Refreshing while you're on the index (`#/`) keeps you on the index. The "← All training tools" link in the top toolbar returns to the startpage and records that as your latest choice.

You can also deep-link by typing the hash directly: `#/wc-fletch-fm`, `#/fish-cook`, or `#/thieving`.

## Shared RSN import

The **RSN** field in the top toolbar appears on every view. Type your in-game name and click **Lookup hiscores** — the tool fetches your levels for all six relevant skills (Woodcutting, Fletching, Firemaking, Fishing, Cooking, Thieving) in one request and updates whichever section's inputs match. The RSN is saved in `localStorage`.

Behind the scenes the tool hits `https://oldschool.runescape.wiki/cors/m=hiscore_oldschool/index_lite.ws?player=<RSN>`, the same CORS-permissive proxy the wiki's own calculators use. Response is plain text, one line per skill (`rank,level,xp`). Hiscores only update when you log out, so the level can lag real-time play by a few minutes.

**In-sync indicator.** A lookup also stores each skill's raw XP (`training-optimizer:skill-xp`). Each level input shows a green ✓ (and a green border) while its value still maps back to that stored XP — i.e. exactly when the overtake projections are running on your *real* XP rather than the estimated level-minimum. Edit a level by hand and the ✓ drops, signalling the projection has fallen back to an estimate.

## Interface notes

- **Info toggle.** Each section's data/calibration notes are collapsed by default behind the **ⓘ** button next to the section title; click it to reveal them.
- **Deselecting sources.** Click any table row (or a chart-legend entry) to exclude that tree/spot/method. Excluded sources are dropped from the recommendations, the overtake projections, and the charts — useful for restricted accounts that can't reach certain spots. The exclusion set is persisted.
- **Tracking rail.** The WC and Fishing sections have a sticky "Tracking" rail (and Thieving an activity toggle) that switches which metric drives the highlighted row and the charts.

## Woodcutting + Fletching + Firemaking

Pick your WC, Fletching, Firemaking levels, axe, and an efficiency factor. The tool ranks 16 trees across three modes — pure chop (WC XP/h), chop+fletch into unstrung bows (Fletch XP/h, six bow trees only), and chop+burn (FM XP/h, every tree). Three recommendation cards highlight the best tree for each mode, each with an overtake projection (the level at which a different tree takes over, and roughly how many actions / how long to get there).

**Firemaking model.** Ignition success scales linearly from 65/256 at level 1 to 256/256 at level 43; above level 43 every attempt succeeds. A failed ignition doesn't consume the log (you just retry), so expected time per lit log is `2.4s / p_success`. Total chop+burn time per log = chop time + ignition time.

**Calibration note.** The axe-power and tree base-chance constants are community-derived approximations (no authoritative wiki values exist for woodcutting chance). Firemaking XP values per tree, FM unlock levels, and the 65→256 ignition curve are wiki-verified. **Relative ranking between trees is reliable; absolute XP/h is approximate, especially for the Varlamore woods (Jatoba, Camphor, Ironwood, Rosewood) whose chop rates are estimated.**

To tighten the numbers, do in-game measurement:
- Pick a (level, axe, tree) triple. Cut for a fixed wall-clock interval.
- Compare logs gathered against the tool's prediction.
- Edit one value at a time in `data.js` (the axe's `power`, or the tree's `baseChop` / `ratio`) until predicted ≈ observed.
- Update `data.js`'s `meta.calibrationStatus` and `lastVerified` when done.

**Sources & attribution.** Per-tree Woodcutting/Firemaking XP, Fletching bow XP, level requirements, and the Firemaking ignition curve come from the **individual log/tree pages** (e.g. [Yew logs](https://oldschool.runescape.wiki/w/Yew_logs), [Magic logs](https://oldschool.runescape.wiki/w/Magic_logs), [Redwood logs](https://oldschool.runescape.wiki/w/Redwood_logs)) and the [Woodcutting](https://oldschool.runescape.wiki/w/Woodcutting), [Fletching](https://oldschool.runescape.wiki/w/Fletching), and [Firemaking](https://oldschool.runescape.wiki/w/Firemaking) skill pages on the OSRS Wiki, reused under [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/) (see [LICENSE-DATA.md](LICENSE-DATA.md)). Woodcutting has no official chop-success value, so the chop-rate and axe-power constants are the community-derived approximations documented on the wiki, calibrated further here (see the calibration note above) — they're still wiki-sourced, not from some separate source.

## Fishing + Cooking

Pick your Fishing + Cooking levels, harpoon tier, cooking method, gauntlets toggle, and efficiency. The tool ranks **fishing spots** (not individual fish) and shows three recommendations side-by-side: best for **Fishing XP/h**, best for **Cooking XP/h**, and best for **Total XP/h** (Fishing + Cooking combined). Ranking spots rather than fish matches OSRS gameplay, where a spot rolls each tick for every fish it offers and you can't opt out of specific catches.

**Why the Total card exists.** Because eligibility is gated on *Fishing* only, the total-XP-best spot is frequently a third spot that is neither the Fishing-best nor the Cooking-best — e.g. at Fishing 60 / Cooking 20 the best Fishing spot, best Cooking spot, and best Total spot are three different spots. Without the Total card that combined optimum would be invisible. (A sweep of all 99×99 level pairs found ~8.5% where the total-best is a hidden third spot.)

**Total overtake.** The Total card's overtake resolves in three tiers: (1) if raising just one skill reaches a new best-total band (the other skill already suffices), it shows that single-skill overtake; (2) otherwise it simulates *training the best-total spot* — both Fishing and Cooking rise at that spot's XP rates — and reports the level pair where a different spot takes over ("…at Fishing 57/Cooking 59 … training both"); (3) if the spot stays best the whole climb, it reads "Best total spot through lvl 99."

**Spots in scope:** Net (coastal), Bait (river), Fly (river), Cage/Harpoon (coastal, both swordfish/tuna and lobster), Cage/Harpoon (Fishing Guild, +7 boost), Big net/Harpoon (coastal — bass/cod/mackerel via net, shark via harpoon), Big net/Harpoon (Fishing Guild), Piscatoris monkfish, Piscarilius anglerfish, Dark crab (Wilderness Resource Area).

Excluded for MVP: karambwan (dual-cook option), sacred eel (not cooked), minnow (conversion mechanic), barbarian rod (separate spot family).

### How the calc works

Per-fish per-level catch and burn rates are scraped from the wiki's `{{Skilling success chart}}` template parameters using `scrape-fish-data.py` and embedded in `fish-catalog.snippet.js`. The runtime applies the wiki's own formula:

```
value = floor(low*(99-level)/98 + high*(level-1)/98 + 0.5) + 1
chance = clamp(value / 256, 0, 1)
```

At spot level, fish are combined per the spot's mechanic:

- **Cascade spots** (most): `fishIds` is priority-ordered (highest-level fish first); a successful roll for a higher-tier fish stops lower-tier fish from rolling that tick.
- **Big-net spots** (`toolFamily: 'big-net'`): each listed fish is rolled *independently* every action (several can be caught at once), `rollCounts` overrides how many times a fish is rolled (raw mackerel twice), and `extraCatches` are the non-fish rolls (caskets, oysters, seaweed, etc.) that add **Fishing XP only** — see `BIG_NET_EXTRA_CATCHES` in `data.js`.

Combined with the cook step (success/burn) and the Infernal harpoon's auto-cook side effect, the calc yields per-spot fish/h, Fishing XP/h, Cooking XP/h, and Total XP/h.

**Locked-spot projection.** Spots you haven't unlocked show a *projected* XP/h at the level they unlock (the spot's Fishing requirement, and a Cooking level high enough to cook the first catch) instead of a flat 0, dimmed and annotated. Projected rows are never picked as a recommendation (the rec stays keyed off true eligibility); they just replace the zeros so the table is informative.

### Harpoon tier

Only the harpoon-family spots use the **Harpoon tier** dropdown. Higher tiers give better catch rates; the wiki publishes separate per-level tables for Harpoon / Dragon harpoon / Crystal harpoon. Infernal harpoon reuses the Dragon harpoon catch curve but auto-cooks ~1/3 of catches (giving 50% Cooking XP, no burn) — the calc folds this into the cook step automatically.

### Cooking gauntlets

The **Cooking gauntlets** checkbox only affects fish the wiki marks as gauntlets-affected: **Lobster, Swordfish, Monkfish, Shark, Anglerfish**. For these, the gauntlets curve from the wiki replaces the normal burn-rate curve. Dark crab and karambwan are NOT affected by gauntlets.

### Calibration note

Per-fish constants come directly from the wiki's templates, so the absolute numbers are as accurate as the wiki itself. The two known approximations:
- **Cascade order** — the calc rolls fish in the order listed in `data.js`'s `spots[].fishIds` (highest-level first). The exact in-engine tie-break order isn't documented; this is the most common community interpretation.
- **Infernal harpoon auto-cook chance** — the wiki language is "approximately 1 in 3"; we use exactly 1/3.

**Sources & attribution.** Per-fish catch and cook success rates come from the `{{Skilling success chart}}` template on each fish's **individual raw and cooked pages** (e.g. [Raw shark](https://oldschool.runescape.wiki/w/Raw_shark) / [Shark](https://oldschool.runescape.wiki/w/Shark), [Raw monkfish](https://oldschool.runescape.wiki/w/Raw_monkfish), [Raw anglerfish](https://oldschool.runescape.wiki/w/Raw_anglerfish)); fish XP, cook XP, and level requirements from those same pages and the [Fishing](https://oldschool.runescape.wiki/w/Fishing) and [Cooking](https://oldschool.runescape.wiki/w/Cooking) skill pages. Reused under [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/) — see [LICENSE-DATA.md](LICENSE-DATA.md).

## Thieving

An activity toggle switches between **Pickpocketing** and **Stalls**; both recommendation cards (best pickpocket + best stall) are always shown so you can compare the two at a glance, while the table and charts follow the toggle. Inputs: Thieving level, three gear toggles, and an efficiency factor.

**Pickpocketing.** Per-target success comes from each NPC's `{{Skilling success chart}}` (same interpolation as the fishing data). An attempt is made every 2 ticks (1.2 s); a *failure* stuns you out of pickpocketing for 8 ticks (4.8 s), so success rate matters a lot:

```
XP/h = p · xp / (1.2 + (1 − p) · 4.8) · 3600 · efficiency
```

The three gear toggles — **Gloves of silence (+5%)**, **Thieving cape (+10%)**, **Ardougne Hard diary (+10%)** — stack multiplicatively onto the success curve's `low`/`high` (verified against the wiki's pre-computed geared series). The rogue outfit is intentionally omitted (it boosts loot/XP-per-pickpocket, not success/rate in a way this model tracks).

**Stalls.** Success is 100% once the level requirement is met; XP/h is gated by each stall's respawn time (`xp / respawn · 3600 · efficiency`).

**Locked methods** show a *projected* XP/h at the level they unlock (instead of 0) and are never picked as a recommendation. When the table is sorted by XP/h, locked rows are ordered by **ascending level requirement** (next-to-unlock first) rather than by projected XP/h, since that's the more useful "what's coming up" order.

**Data coverage.** 17 of the 21 listed pickpocket targets have a scrapeable success chart; four (cave goblin, Fremennik citizen, pirate, TzHaar-Hur) have no `{{Skilling success chart}}` on the wiki and are omitted pending hand-authored curves. Stalls (18) are authored with their respawn times.

**Sources & attribution.** Per-target pickpocket success rates come from the `{{Skilling success chart}}` template on each NPC's **individual page** (e.g. [Master Farmer](https://oldschool.runescape.wiki/w/Master_Farmer), [Knight of Ardougne](https://oldschool.runescape.wiki/w/Knight_of_Ardougne), [Elf (Thieving)](https://oldschool.runescape.wiki/w/Elf_(Thieving))); pickpocket XP, level requirements, and stall XP/respawn data from those pages and the [Thieving](https://oldschool.runescape.wiki/w/Thieving) skill page. Reused under [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/) — see [LICENSE-DATA.md](LICENSE-DATA.md).

## Refreshing the scraped data

If the wiki updates its `{{Skilling success chart}}` parameters, re-run the relevant scraper (Python 3.10+):

```
python scrape-fish-data.py     > fish-catalog.snippet.js
python scrape-thieving-data.py > thieving-catalog.snippet.js
```

Output goes straight to the file the runtime loads; commit the updated snippet. The scripts fetch each entity's wiki page, parse out the per-series `low`/`high`/`req` parameters, and emit a JS object literal, printing a per-entity summary to stderr (any unknown series labels are logged so you know whether to extend the label maps).

> **Windows note:** PowerShell's `>` writes UTF-16; if you redirect that way the runtime will fail to parse the snippet. Either run under a shell that emits UTF-8, or have the script write the file itself.

## Testing

**No automated tests.** Verification is manual:

- **Routing.** Open the page cold (clear `localStorage`) → startpage. Click a section → URL hash updates, section loads. Refresh → lands back on the same section. Click the home link → startpage; refresh → *stays* on the startpage (the index is now a remembered choice). Open the bare URL after using a section → drops back into that section.
- **Hiscores import.** Enter a known RSN → all six level inputs populate, each showing the green in-sync ✓. Edit one by hand → its ✓ drops. Switch sections → tables/charts reflect new levels.
- **WC-fletch numeric:** the calibration scenarios in the section above.
- **Fish-cook numeric:** at Fishing 14 / Net (coastal), only Shrimp listed (anchovy not yet unlocked) and the per-tick rate matches the wiki's shrimp value at level 14. At Fishing 30 same spot, Shrimp + Anchovy combine per the cascade `1 − (1 − p_shrimp)(1 − p_anchovy)`. At Fishing 60 / Cooking 20 the Fishing-, Cooking-, and Total-best cards show three different spots.
- **Thieving numeric:** Master Farmer success ≈ 64.8% at level 50; enabling all three gear toggles raises every target's success/XP. Locked targets show a dimmed projected XP/h and sort by ascending level under the XP/h sort.
- **Edge cases.** Crystal harpoon selected at Fishing 30 → option shows `(req. Fishing 71)`, calc falls back to the highest tier you qualify for. Lobster spot at Cook 64 with fire → noticeable burn; toggle gauntlets on → success climbs sharply.
- **UI:** open in Chrome and Firefox. Resize to 600px width. Refresh — inputs and last view restore. Check the recommendation cards reflow without the bounce at the ~1150px Tracking-rail breakpoint.

## Hosting & analytics

Served as static files via **GitHub Pages** (from `main`, repo root; `.nojekyll` present). Asset `<script>`/`<link>` tags carry a `?v=<version>` cache-bust query that's bumped on each release, so returning visitors fetch fresh code without clearing their cache. Cookieless visitor counts come from [GoatCounter](https://www.goatcounter.com/) (`osrs-tool`); no personal data is collected. Releases are tagged `vX.Y.Z` and the displayed version comes from `data.js`'s `meta.version`.

## License & attribution

Dual-licensed:

- **Source code & original content** — [MIT](LICENSE).
- **Old School RuneScape game data** (`fish-catalog.snippet.js`, `thieving-catalog.snippet.js`, and the wiki-sourced numeric constants in `data.js`) — **CC BY-NC-SA 3.0**, matching the [OSRS Wiki's own license](https://meta.weirdgloop.org/w/Meta:Copyrights). See [`LICENSE-DATA.md`](LICENSE-DATA.md) for the full attribution, source-page links, and consequences.

> This project uses material from the [Old School RuneScape Wiki](https://oldschool.runescape.wiki) and is licensed under the Creative Commons BY-NC-SA 3.0 license.

Practical upshot: because the embedded wiki data is NonCommercial + ShareAlike, **the tool as distributed (code + data) is non-commercial**, and changes to the wiki-derived data must stay under CC BY-NC-SA 3.0 with attribution. The MIT code on its own (with your own data) is unrestricted. _RuneScape_ / _Old School RuneScape_ are trademarks of Jagex Limited; this is an unofficial fan project.

## Note on WikiSync code

`core.js` includes a complete (but **dormant**) WebSocket client for the [WikiSync](https://github.com/weirdgloop/WikiSync) plugin's local server — the same protocol the wiki's DPS calculator uses. It's not wired to any UI because WikiSync's `GetPlayer` payload currently omits the gathering and processing skills this tool needs (Woodcutting, Fletching, Fishing, Cooking, …).

The code is kept as a reference implementation for future tools. See the `WikiSync import (DORMANT)` block in `core.js` for the protocol notes and the revival recipe.

## File overview

| File | Purpose |
|------|---------|
| `index.html`                  | Page shell: top toolbar + four views (startpage, wc-fletch-fm, fish-cook, thieving). |
| `data.js`                     | Sections, spots/trees/targets, harpoon tiers, cook methods, gear. Wraps the two generated catalog snippets and holds `meta.version`. |
| `fish-catalog.snippet.js`     | Auto-generated per-fish data scraped from the wiki. Do not hand-edit. |
| `thieving-catalog.snippet.js` | Auto-generated pickpocket-target + stall data. Do not hand-edit. |
| `core.js`                     | Shared utilities, hash router, hiscores lookup + sync indicators, info toggles, sticky stack, dormant WikiSync client. |
| `wc-fletch-fm.js`             | Woodcutting + Fletching + Firemaking section: calc, table, charts. |
| `fish-cook.js`                | Fishing → Cooking section: per-spot calc with cascade/big-net, projections, Total overtake, table, charts. |
| `thieving.js`                 | Thieving section: pickpocket + stall calc, projections, table, charts. |
| `styles.css`                  | Dark OSRS-inspired theme, startpage cards, toolbar, rec cards, table + chart styling. |
| `scrape-fish-data.py`         | One-shot fish scraper. Run when the wiki updates `{{Skilling success chart}}` data. |
| `scrape-thieving-data.py`     | One-shot thieving scraper (pickpocket success charts). |
| `favicon.svg`                 | Page icon. |
| `LICENSE`                     | MIT license for the source code. |
| `LICENSE-DATA.md`             | CC BY-NC-SA 3.0 license + attribution for the wiki-derived game data. |
| `README.md`                   | This file. |
