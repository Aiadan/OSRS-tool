"""Dev-only one-shot scraper. Fetches each fish's raw + cooked wiki pages,
parses the {{Skilling success chart}} template parameters, and prints a JS
object literal you can paste into data.js as TRAINING_DATA fishCatalog.

Run (from this dir):
    python scrape-fish-data.py > fish-catalog.snippet.js

Re-run when the wiki updates its numbers. Output is committed to the repo
so end users never need Python installed.

The wiki's actual chance formula (from Module:Skilling_success_chart):
    value = floor(low*(99-level)/98 + high*(level-1)/98 + 0.5) + 1
    chance = clamp(value / 256, 0, 1)
We capture (low, high, req) tuples per series here; the runtime calc applies
the formula. That keeps the data minimal and lets us swap formula
approximations later without rescraping.
"""

import json
import re
import sys
import urllib.request

FISH = [
    dict(id='shrimp',     raw='Raw_shrimps',    cooked='Shrimps',    fishLevel=1,  fishXp=10,  cookLevel=1,  cookXp=30,  gauntletsAffected=False, color='#b18065'),
    dict(id='anchovy',    raw='Raw_anchovies',  cooked='Anchovies',  fishLevel=15, fishXp=40,  cookLevel=1,  cookXp=30,  gauntletsAffected=False, color='#6e6e8b'),
    dict(id='sardine',    raw='Raw_sardine',    cooked='Sardine',    fishLevel=5,  fishXp=20,  cookLevel=1,  cookXp=40,  gauntletsAffected=False, color='#c19a6b'),
    dict(id='herring',    raw='Raw_herring',    cooked='Herring',    fishLevel=10, fishXp=30,  cookLevel=5,  cookXp=50,  gauntletsAffected=False, color='#9aa6b8'),
    dict(id='mackerel',   raw='Raw_mackerel',   cooked='Mackerel',   fishLevel=16, fishXp=20,  cookLevel=10, cookXp=60,  gauntletsAffected=False, color='#3a7ca5'),
    dict(id='cod',        raw='Raw_cod',        cooked='Cod',        fishLevel=23, fishXp=45,  cookLevel=18, cookXp=75,  gauntletsAffected=False, color='#6a8caf'),
    dict(id='bass',       raw='Raw_bass',       cooked='Bass',       fishLevel=46, fishXp=100, cookLevel=43, cookXp=130, gauntletsAffected=False, color='#86936b'),
    dict(id='trout',      raw='Raw_trout',      cooked='Trout',      fishLevel=20, fishXp=50,  cookLevel=15, cookXp=70,  gauntletsAffected=False, color='#d28a5e'),
    dict(id='salmon',     raw='Raw_salmon',     cooked='Salmon',     fishLevel=30, fishXp=70,  cookLevel=25, cookXp=90,  gauntletsAffected=False, color='#e07b5c'),
    dict(id='pike',       raw='Raw_pike',       cooked='Pike',       fishLevel=25, fishXp=60,  cookLevel=20, cookXp=80,  gauntletsAffected=False, color='#7c8556'),
    dict(id='tuna',       raw='Raw_tuna',       cooked='Tuna',       fishLevel=35, fishXp=80,  cookLevel=30, cookXp=100, gauntletsAffected=False, color='#4e6e8e'),
    dict(id='lobster',    raw='Raw_lobster',    cooked='Lobster',    fishLevel=40, fishXp=90,  cookLevel=40, cookXp=120, gauntletsAffected=True,  color='#c8553d'),
    dict(id='swordfish',  raw='Raw_swordfish',  cooked='Swordfish',  fishLevel=50, fishXp=100, cookLevel=45, cookXp=140, gauntletsAffected=True,  color='#5a8fa8'),
    dict(id='monkfish',   raw='Raw_monkfish',   cooked='Monkfish',   fishLevel=62, fishXp=120, cookLevel=62, cookXp=150, gauntletsAffected=True,  color='#86a07c'),
    dict(id='shark',      raw='Raw_shark',      cooked='Shark',      fishLevel=76, fishXp=110, cookLevel=80, cookXp=210, gauntletsAffected=True,  color='#4d6b87'),
    dict(id='anglerfish', raw='Raw_anglerfish', cooked='Anglerfish', fishLevel=82, fishXp=120, cookLevel=84, cookXp=230, gauntletsAffected=True,  color='#9b6b8a'),
    dict(id='darkCrab',   raw='Raw_dark_crab',  cooked='Dark_crab',  fishLevel=85, fishXp=130, cookLevel=90, cookXp=215, gauntletsAffected=False, color='#444'),
]

# Wiki series labels -> our catch-curve keys (raw pages).
# These are tool-variant labels (only appear for fish caught with the harpoon line).
CATCH_KEY_MAP = {
    'Harpoon':          'harpoon',
    'Dragon':           'dragon-harpoon',
    'Dragon harpoon':   'dragon-harpoon',
    'Crystal':          'crystal-harpoon',
    'Crystal harpoon':  'crystal-harpoon',
    'Infernal':         'infernal-harpoon',
    'Infernal harpoon': 'infernal-harpoon',
    'Sandworms':        'default',   # anglerfish standard bait
    'Normal':           'default',   # dark crab no-diary
    # Intentionally NOT mapped: 'Diabolic worms', 'Elite Wilderness Diary' (advanced variants)
}

# Wiki series labels -> list of (method, with_gauntlets) tuples this label
# populates. Some labels mean "applies to multiple scenarios" -- e.g.
# "Fire or Range" populates both fire and range, and "Range or cooking
# gauntlets" populates both range-without-gauntlets and fire-with-gauntlets.
COOK_KEY_MAP = {
    'Fire or Range':              [('fire', False), ('range', False)],
    'Fire':                       [('fire', False)],
    'Range':                      [('range', False)],
    'Range or cooking gauntlets': [('range', False), ('fire', True)],
    'Lumbridge range':            [('lumbridge', False)],
    'Gauntlets':                  [('fire', True), ('range', True)],
    'Hosidius +5%':               [('hosidius-5', False)],
    'Hosidius +10%':              [('hosidius-10', False)],
    'Hosidius +5%, gauntlets':    [('hosidius-5', True)],
    'Hosidius +10%, gauntlets':   [('hosidius-10', True)],
}

# Catch series whose label matches one of these patterns are the fish's
# own curve (for raw-pages whose template lists multiple fish, e.g.
# Raw_shrimps lists both anchovy and shrimp).
CATCH_LABEL_MATCH = {
    'shrimp':     ('shrimp',),
    'anchovy':    ('anchov',),    # "anchovies" / "anchovy"
    'sardine':    ('sardine',),
    'herring':    ('herring',),
    'mackerel':   ('mackerel',),
    'cod':        ('cod',),
    'bass':       ('bass',),
    'trout':      ('trout',),
    'salmon':     ('salmon',),
    'pike':       ('pike',),
    'tuna':       ('tuna',),
    'lobster':    ('lobster',),
    'swordfish':  ('swordfish',),
    'monkfish':   ('monkfish',),
    'shark':      ('shark',),
    'anglerfish': ('anglerfish',),
    'darkCrab':   ('dark crab',),
}


def fetch_wikitext(page):
    url = f'https://oldschool.runescape.wiki/w/{page}?action=raw'
    req = urllib.request.Request(url, headers={'User-Agent': 'osrs-training-optimizer-scraper/1.0'})
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.read().decode('utf-8')


def scope_to_section(wikitext, heading_substr):
    """Return the slice of wikitext between `=== <heading_substr> ===` and the
    next heading (`==` or `===`). Used to scope scraping to just the
    "Fishing chance" or "Cooking chance" sections — pages like Raw_shark have
    additional templates in sibling sections (Shark Lure, etc.) that we
    don't want to mistake for the fish's base catch curve."""
    # Find headings: `=== Fishing chance ===` or `===Fishing chance===`.
    pattern = re.compile(r'={2,}\s*' + re.escape(heading_substr) + r'\s*={2,}', re.IGNORECASE)
    m = pattern.search(wikitext)
    if not m:
        return wikitext   # heading not found: scan whole page (safer than empty)
    start = m.end()
    # Find the next heading (== or === or ====) AFTER our start position.
    next_heading = re.search(r'\n={2,}[^=].*?={2,}', wikitext[start:])
    end = start + (next_heading.start() if next_heading else len(wikitext) - start)
    return wikitext[start:end]


def iter_chart_templates(wikitext):
    """Yields (preamble, body) tuples for every {{Skilling success chart}}
    template in the provided text. Preamble is the ~250 chars immediately
    preceding each template (used to detect tabber-style tier headings like
    `<tabber>\nDragon harpoon=`)."""
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
        preamble = wikitext[max(0, start - 250):start]
        body = wikitext[start:i]
        yield preamble, body
        pos = i


def detect_tier(preamble):
    """Walk backwards through the preamble's non-empty lines. The most recent
    tabber heading (line ending with `=`) names the tier — e.g. `Harpoon=`,
    `Dragon harpoon=`, `Crystal harpoon=`. If no tabber heading is found,
    return 'default'."""
    for line in reversed([l.strip() for l in preamble.split('\n') if l.strip()]):
        if line.endswith('='):
            label = line[:-1].strip().lstrip('|').strip()
            if label in CATCH_KEY_MAP:
                return CATCH_KEY_MAP[label]
            # Heading we don't recognise -> treat as default for safety
            return 'default'
    return 'default'


def parse_series_from_body(body):
    series = {}
    for m in re.finditer(r'label(\d+)\s*=\s*([^|}\n]+)', body):
        series.setdefault(m.group(1), {})['label'] = m.group(2).strip()
    # Negative lookbehind: don't let `bonuslow1`/`bonushigh1` (a second,
    # comparison curve drawn by the template, e.g. a fishing boost) clobber the
    # real `low1`/`high1` catch curve. The original regex matched the `low`/
    # `high` inside `bonuslow`/`bonushigh` and, parsed last, overwrote the base
    # values — which is how mackerel's big-net curve got stored as a flat 10/10.
    for m in re.finditer(r'(?<![a-zA-Z])low(\d+)\s*=\s*(\d+)', body):
        series.setdefault(m.group(1), {})['low'] = int(m.group(2))
    for m in re.finditer(r'(?<![a-zA-Z])high(\d+)\s*=\s*(\d+)', body):
        series.setdefault(m.group(1), {})['high'] = int(m.group(2))
    for m in re.finditer(r'req(\d+)\s*=\s*(\d+)', body):
        series.setdefault(m.group(1), {})['req'] = int(m.group(2))
    return [s for s in series.values()
            if s.get('label') and s.get('low') is not None and s.get('high') is not None]


def scrape_one(fish):
    print(f'scraping {fish["id"]}...', file=sys.stderr)
    raw_txt = fetch_wikitext(fish['raw'])
    cooked_txt = fetch_wikitext(fish['cooked'])

    catch = {}
    fish_label_patterns = CATCH_LABEL_MATCH.get(fish['id'], (fish['id'],))
    # Scope to the Fishing chance section to skip sibling sections like
    # "Shark Lure" which carry their own templates we don't want to fold in.
    raw_scoped = scope_to_section(raw_txt, 'Fishing chance')
    for preamble, body in iter_chart_templates(raw_scoped):
        tier = detect_tier(preamble)
        for s in parse_series_from_body(body):
            label = s['label']
            tup = {'low': s['low'], 'high': s['high'], 'req': s.get('req', fish['fishLevel'])}

            # Tool-variant labels (Harpoon/Dragon/Crystal as the SERIES label, e.g. shark page)
            if label in CATCH_KEY_MAP:
                catch[CATCH_KEY_MAP[label]] = tup
                continue
            # Otherwise the series must name THIS fish (skip sibling fish in cascade templates).
            label_lower = label.lower()
            if any(pat in label_lower for pat in fish_label_patterns):
                # Use the tabber's tier as the key when present, else 'default'.
                key = tier if tier != 'default' else 'default'
                catch[key] = tup

    cook, cook_g = {}, {}
    # Scope to the cooking-success template region. The cooked pages typically
    # have a single template under a "Cooking chance" / "Cooking" heading;
    # scoping isolates it from any unrelated chart templates further down.
    cooked_scoped = scope_to_section(cooked_txt, 'Cooking chance')
    if not cooked_scoped or '{{Skilling success chart' not in cooked_scoped:
        cooked_scoped = cooked_txt   # fall back to whole page
    for preamble, body in iter_chart_templates(cooked_scoped):
        for s in parse_series_from_body(body):
            targets = COOK_KEY_MAP.get(s['label'])
            if not targets:
                print(f'  ! unknown cook label: {s["label"]!r}', file=sys.stderr)
                continue
            tup = {'low': s['low'], 'high': s['high'], 'req': s.get('req', fish['cookLevel'])}
            for method, with_gauntlets in targets:
                (cook_g if with_gauntlets else cook)[method] = tup

    out = dict(fish)
    out['catch'] = catch
    out['cook'] = cook
    if cook_g:
        out['cookGauntlets'] = cook_g
    return out


def capitalize_id(fid):
    if fid == 'darkCrab':
        return 'Dark crab'
    return fid[0].upper() + fid[1:]


def to_js_literal(value, indent=0):
    """Produce a JS-friendly literal (compact JSON with single-quote conversion not required)."""
    return json.dumps(value, separators=(', ', ': '))


def main():
    results = []
    for fish in FISH:
        try:
            results.append(scrape_one(fish))
        except Exception as e:
            print(f'  ! failed {fish["id"]}: {e}', file=sys.stderr)

    out = []
    out.append('// Auto-generated by scrape-fish-data.py -- do not hand-edit.')
    out.append('// To refresh: `python scrape-fish-data.py > fish-catalog.snippet.js`')
    out.append('//')
    out.append('// This data is derived from the Old School RuneScape Wiki and is licensed')
    out.append('// under CC BY-NC-SA 3.0 (https://creativecommons.org/licenses/by-nc-sa/3.0/),')
    out.append('// NOT the repository\'s MIT code license. It uses material from the per-fish')
    out.append('// articles and {{Skilling success chart}} template on the OSRS Wiki')
    out.append('// (https://oldschool.runescape.wiki). See LICENSE-DATA.md for details.')
    out.append('window.TRAINING_DATA_FISH_CATALOG = [')
    for f in results:
        out.append('  {')
        out.append(f'    id: {json.dumps(f["id"])}, name: {json.dumps(capitalize_id(f["id"]))}, color: {json.dumps(f["color"])},')
        out.append(f'    fishLevel: {f["fishLevel"]}, fishXp: {f["fishXp"]},')
        out.append(f'    cookLevel: {f["cookLevel"]}, cookXp: {f["cookXp"]},')
        out.append(f'    gauntletsAffected: {"true" if f["gauntletsAffected"] else "false"},')
        out.append(f'    catch: {to_js_literal(f["catch"])},')
        suffix = ',' if 'cookGauntlets' in f else ''
        out.append(f'    cook: {to_js_literal(f["cook"])}{suffix}')
        if 'cookGauntlets' in f:
            out.append(f'    cookGauntlets: {to_js_literal(f["cookGauntlets"])}')
        out.append('  },')
    out.append('];')

    print('\n'.join(out))

    print('\n=== Summary ===', file=sys.stderr)
    for f in results:
        catch_keys = ', '.join(f['catch'].keys()) or '(none)'
        cook_keys = ', '.join(f['cook'].keys()) or '(none)'
        gaunt_keys = ', '.join(f['cookGauntlets'].keys()) if 'cookGauntlets' in f else '--'
        print(f'{f["id"]:11s} catch: {catch_keys:50s} cook: {cook_keys:50s} gauntlets: {gaunt_keys}', file=sys.stderr)


if __name__ == '__main__':
    main()
