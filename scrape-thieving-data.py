"""Dev-only scraper for Thieving data, mirroring scrape-fish-data.py.

Pickpocketing success scales with Thieving level using the SAME
{{Skilling success chart}} interpolation the fishing/cooking data uses:
    value  = floor(low*(99-level)/98 + high*(level-1)/98 + 0.5) + 1
    chance = clamp(value / 256, 0, 1)
Each pickpocketable NPC's page carries that chart (label "<NPC> pickpocket
chance"). We scrape only the BASE (no-gear) series — the lowest curve — and the
runtime applies the gear multipliers (gloves x1.05, Thieving cape x1.10,
Ardougne hard diary x1.10) to low/high itself.

Stalls have no success curve (100% above the level requirement); their XP/h is
gated by respawn time, so they're authored here directly (level/xp/respawn from
the wiki) and emitted as-is.

Run (from this dir):
    python scrape-thieving-data.py > thieving-catalog.snippet.js
"""

import json
import re
import sys
import urllib.request
import urllib.parse

# Pickpocketing NPCs: id, display name, wiki page, level req, XP per success.
# `page` is the exact wiki title (spaces become %20/underscores on fetch).
PICKPOCKET = [
    dict(id='man',           name='Man / Woman',            page='Man',                          level=1,  xp=8,     color='#9aa6b8'),
    dict(id='farmer',        name='Farmer',                 page='Farmer',                       level=10, xp=14.5,  color='#8f9d4f'),
    dict(id='hamMember',     name='H.A.M. member',          page='H.A.M. Member',                level=15, xp=22.2,  color='#7a6a4f'),
    dict(id='warrior',       name='Warrior',                page='Warrior (Thieving)',           level=25, xp=26,    color='#b06f3c'),
    dict(id='rogue',         name='Rogue',                  page='Rogue',                        level=32, xp=36.5,  color='#6e6e8b'),
    dict(id='caveGoblin',    name='Cave goblin',            page='Cave goblin (Dorgesh-Kaan)',   level=36, xp=40,    color='#7a8056'),
    dict(id='masterFarmer',  name='Master Farmer',          page='Master Farmer',                level=38, xp=43,    color='#c8a06b'),
    dict(id='guard',         name='Guard',                  page='Guard',                        level=40, xp=46.8,  color='#5a8fa8'),
    dict(id='fremennik',     name='Fremennik citizen',      page='Fremennik Citizen',            level=45, xp=65,    color='#9aa6b8'),
    dict(id='wealthy',       name='Wealthy citizen',        page='Wealthy citizen',              level=50, xp=96,    color='#c8553d'),
    dict(id='desertBandit',  name='Desert Bandit',          page='Bandit (Bandit Camp)',         level=53, xp=79.4,  color='#d6a754'),
    dict(id='knight',        name='Knight of Ardougne',     page='Knight of Ardougne',           level=55, xp=84.3,  color='#5a8fa8'),
    dict(id='pirate',        name='Pirate',                 page='Pirate (Thieving)',            level=60, xp=72,    color='#527a4e'),
    dict(id='watchman',      name='Watchman',               page='Watchman',                     level=65, xp=137.5, color='#7b6cd9'),
    dict(id='menaphiteThug', name='Menaphite Thug',         page='Menaphite Thug',               level=65, xp=137.5, color='#a55a2d'),
    dict(id='paladin',       name='Paladin',                page='Paladin',                      level=70, xp=131.8, color='#d28a5e'),
    dict(id='gnome',         name='Gnome',                  page='Gnome',                        level=75, xp=133.3, color='#7eb47e'),
    dict(id='hero',          name='Hero',                   page='Hero',                         level=80, xp=163.3, color='#c97070'),
    dict(id='vyre',          name='Vyre',                   page='Vyre',                         level=82, xp=306.9, color='#76273a'),
    dict(id='elf',           name='Elf',                    page='Elf (Thieving)',               level=85, xp=353.3, color='#9b6b8a'),
    dict(id='tzhaarHur',     name='TzHaar-Hur',             page='TzHaar-Hur',                   level=90, xp=103.4, color='#a02020'),
]

# Stalls: authored directly (no success curve). respawn in seconds.
STALLS = [
    dict(id='veg',       name='Vegetable stall', level=2,  xp=10,    respawn=1.2,  color='#8f9d4f'),
    dict(id='bakery',    name='Bakery stall',    level=5,  xp=16,    respawn=2.4,  color='#c8a06b'),
    dict(id='tea',       name='Tea stall',       level=5,  xp=16,    respawn=2.4,  color='#a3804f'),
    dict(id='crafting',  name='Crafting stall',  level=5,  xp=20,    respawn=4.8,  color='#7a8056'),
    dict(id='silk',      name='Silk stall',      level=20, xp=24,    respawn=4.8,  color='#9b6b8a'),
    dict(id='wine',      name='Wine stall',      level=22, xp=27,    respawn=4.8,  color='#76273a'),
    dict(id='fruit',     name='Fruit stall',     level=25, xp=28.5,  respawn=2.4,  color='#d68754'),
    dict(id='seed',      name='Seed stall',      level=27, xp=10,    respawn=2.4,  color='#8f9d4f'),
    dict(id='fur',       name='Fur stall',       level=35, xp=45,    respawn=7.2,  color='#a55a2d'),
    dict(id='fish',      name='Fish stall',      level=42, xp=42,    respawn=7.2,  color='#5a8fa8'),
    dict(id='crossbow',  name='Crossbow stall',  level=49, xp=52,    respawn=4.8,  color='#6e6e6e'),
    dict(id='silver',    name='Silver stall',    level=50, xp=205,   respawn=19.2, color='#c0c0c0'),
    dict(id='spice',     name='Spice stall',     level=65, xp=92,    respawn=6,    color='#d6a754'),
    dict(id='magic',     name='Magic stall',     level=65, xp=90,    respawn=7.2,  color='#7b6cd9'),
    dict(id='scimitar',  name='Scimitar stall',  level=65, xp=210,   respawn=19.2, color='#9aa6b8'),
    dict(id='gem',       name='Gem stall',       level=75, xp=408,   respawn=60,   color='#c8553d'),
    dict(id='oreTzhaar', name='Ore stall (Mor Ul Rek)', level=82, xp=350, respawn=30, color='#a02020'),
    dict(id='cannonball',name='Cannonball stall',level=87, xp=223,   respawn=2.4,  color='#444'),
]


def fetch_wikitext(page):
    url = 'https://oldschool.runescape.wiki/w/' + urllib.parse.quote(page.replace(' ', '_')) + '?action=raw'
    req = urllib.request.Request(url, headers={'User-Agent': 'osrs-training-optimizer-scraper/1.0'})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read().decode('utf-8')


def iter_chart_templates(wikitext):
    """Yield the body text of every {{Skilling success chart}} template."""
    pos = 0
    while True:
        start = wikitext.find('{{Skilling success chart', pos)
        if start < 0:
            return
        depth = 0
        i = start
        while i < len(wikitext):
            if wikitext[i:i+2] == '{{':
                depth += 1; i += 2
            elif wikitext[i:i+2] == '}}':
                depth -= 1; i += 2
                if depth == 0:
                    break
            else:
                i += 1
        yield wikitext[start:i]
        pos = i


def chart_title(body):
    m = re.search(r'\|\s*label\s*=\s*([^|}\n]+)', body)
    return (m.group(1).strip() if m else '')


def parse_series(body):
    """Parse labelN/lowN/highN/reqN series. Negative lookbehind keeps
    bonuslowN/bonushighN comparison curves from clobbering the base values."""
    s = {}
    for m in re.finditer(r'label(\d+)\s*=\s*([^|}\n]+)', body):
        s.setdefault(m.group(1), {})['label'] = m.group(2).strip()
    for m in re.finditer(r'(?<![a-zA-Z])low(\d+)\s*=\s*(\d+)', body):
        s.setdefault(m.group(1), {})['low'] = int(m.group(2))
    for m in re.finditer(r'(?<![a-zA-Z])high(\d+)\s*=\s*(\d+)', body):
        s.setdefault(m.group(1), {})['high'] = int(m.group(2))
    for m in re.finditer(r'req(\d+)\s*=\s*(\d+)', body):
        s.setdefault(m.group(1), {})['req'] = int(m.group(2))
    return [v for v in s.values() if v.get('low') is not None and v.get('high') is not None]


def scrape_npc(npc):
    print(f'scraping {npc["id"]} ({npc["page"]})...', file=sys.stderr)
    txt = fetch_wikitext(npc['page'])
    charts = list(iter_chart_templates(txt))
    # Prefer the chart explicitly titled "... pickpocket chance" (NPC pages that
    # also have a blackjack chart). Fall back to the page's only success chart
    # for simple NPCs whose chart title omits the word.
    preferred = [b for b in charts if 'pickpocket' in chart_title(b).lower()]
    for body in (preferred or charts):
        series = parse_series(body)
        if not series:
            continue
        # Base (no-gear) curve = the lowest series; gear only raises low/high.
        base = min(series, key=lambda v: v['low'])
        return {'low': base['low'], 'high': base['high'], 'req': base.get('req', npc['level'])}
    return None


def main():
    results = []
    for npc in PICKPOCKET:
        try:
            curve = scrape_npc(npc)
        except Exception as e:
            print(f'  ! failed {npc["id"]}: {e}', file=sys.stderr)
            curve = None
        if curve is None:
            print(f'  ! no pickpocket chart for {npc["id"]} — skipped', file=sys.stderr)
            continue
        out = dict(npc); out['success'] = curve
        results.append(out)

    lines = []
    lines.append('// Auto-generated by scrape-thieving-data.py -- do not hand-edit.')
    lines.append('// To refresh: `python scrape-thieving-data.py > thieving-catalog.snippet.js`')
    lines.append('window.TRAINING_DATA_THIEVING = {')
    lines.append('  pickpocket: [')
    for n in results:
        lines.append('    { ' +
                     f'id: {json.dumps(n["id"])}, name: {json.dumps(n["name"])}, color: {json.dumps(n["color"])}, ' +
                     f'level: {n["level"]}, xp: {n["xp"]}, ' +
                     f'success: {{ low: {n["success"]["low"]}, high: {n["success"]["high"]}, req: {n["success"]["req"]} }} }},')
    lines.append('  ],')
    lines.append('  stalls: [')
    for s in STALLS:
        lines.append('    { ' +
                     f'id: {json.dumps(s["id"])}, name: {json.dumps(s["name"])}, color: {json.dumps(s["color"])}, ' +
                     f'level: {s["level"]}, xp: {s["xp"]}, respawn: {s["respawn"]} }},')
    lines.append('  ]')
    lines.append('};')
    print('\n'.join(lines))

    print('\n=== Summary ===', file=sys.stderr)
    print(f'pickpocket: {len(results)}/{len(PICKPOCKET)} NPCs with curves', file=sys.stderr)
    print(f'stalls: {len(STALLS)}', file=sys.stderr)


if __name__ == '__main__':
    main()
