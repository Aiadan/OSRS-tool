# Data license & attribution

This repository's **source code** is licensed under the MIT License (see
[`LICENSE`](LICENSE)).

The **Old School RuneScape game data** redistributed here is **not** MIT-licensed.
It is derived from the Old School RuneScape Wiki and is licensed under
**Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported
(CC BY-NC-SA 3.0)** — <https://creativecommons.org/licenses/by-nc-sa/3.0/> — the
same license the wiki applies to its post-2018 content (see
[Weird Gloop Meta:Copyrights](https://meta.weirdgloop.org/w/Meta:Copyrights)).

## What the data license covers

- **`fish-catalog.snippet.js`** — per-fish catch and cook success curves (entirely wiki-scraped).
- **`thieving-catalog.snippet.js`** — pickpocket-target success curves (entirely wiki-scraped).
- The **wiki-sourced numeric game constants embedded in `data.js`** — per-tree/fish XP
  values, level requirements, the Firemaking ignition curve, stall XP and respawn times,
  gear multipliers, etc.

The repository's own structure, calculations, layout, and code (in `data.js` and
the other `.js`/`.css`/`.html`/`.py` files) remain MIT-licensed.

**Not** covered by the data license: the **Woodcutting chop-chance and axe-power
constants** in `data.js` are community-derived approximations, *not* wiki content, so
they fall under the MIT code license rather than CC BY-NC-SA.

## Attribution

> This project uses material from the [Old School RuneScape Wiki](https://oldschool.runescape.wiki)
> and is licensed under the Creative Commons BY-NC-SA 3.0 license.

The numbers are drawn primarily from the **individual entity pages** — one per
log/tree, per fish (raw and cooked), and per pickpocket target — with success
rates coming from the `{{Skilling success chart}}` template embedded on those
pages. The skill pages below serve as indices to those entity pages:

- **Woodcutting + Fletching + Firemaking** — [Woodcutting](https://oldschool.runescape.wiki/w/Woodcutting),
  [Fletching](https://oldschool.runescape.wiki/w/Fletching),
  [Firemaking](https://oldschool.runescape.wiki/w/Firemaking), and each log/tree page
  (e.g. [Yew logs](https://oldschool.runescape.wiki/w/Yew_logs),
  [Magic logs](https://oldschool.runescape.wiki/w/Magic_logs)).
- **Fishing + Cooking** — [Fishing](https://oldschool.runescape.wiki/w/Fishing),
  [Cooking](https://oldschool.runescape.wiki/w/Cooking), and each fish's raw + cooked
  pages (e.g. [Raw shark](https://oldschool.runescape.wiki/w/Raw_shark) /
  [Shark](https://oldschool.runescape.wiki/w/Shark)).
- **Thieving** — [Thieving](https://oldschool.runescape.wiki/w/Thieving) and each
  pickpocket-target page (e.g. [Master Farmer](https://oldschool.runescape.wiki/w/Master_Farmer)).

The exact set of pages fetched is enumerated in the source lists at the top of
`scrape-fish-data.py` and `scrape-thieving-data.py`.

## Practical consequences

Because the embedded wiki data is NonCommercial and ShareAlike:

- **The tool as distributed (code + wiki data together) may not be used commercially.**
- Any modifications to the wiki-derived data must be released under CC BY-NC-SA 3.0
  (or a compatible license), with this attribution preserved.
- The MIT-licensed code *on its own* (without the wiki data) carries no such
  restriction — you may reuse it freely, including commercially, if you supply your
  own data.

---

_RuneScape_ and _Old School RuneScape_ are trademarks of Jagex Limited. This is an
unofficial, non-commercial fan project, not affiliated with or endorsed by Jagex.
