"""Contrast audit.

Run:  python3 scripts/audit-contrast.py

Resolves Tailwind colour classes against the real token values in globals.css
and checks every text/background pair that co-occurs on an element, at the AA
threshold for the text size it is used at.

KNOWN BLIND SPOT: a translucent background composites over a parent this cannot
see, so `bg-primary/10` has no knowable colour here. Those are counted and
skipped rather than guessed; treating them as solid produced nonsense like
white text on bg-white/15 failing at 1.0:1. They still need an eye.

It found four real failures on first run, all of which had shipped: a badge at
1.1:1 that was light-on-light, placeholders at 2.4:1, the brand cyan as text on
white at 2.9:1, and a muted grey that passed on white and failed on the surface
it was actually used on.
"""
import re, subprocess, sys

# 1. Token table from globals.css
css = open("app/globals.css").read()
TOK = dict(re.findall(r'--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})', css))
NAMED = {"white": "#ffffff", "black": "#000000", "transparent": None}

def resolve(name):
    if name in NAMED: return NAMED[name]
    return TOK.get(name)

def lum(h):
    h = h.lstrip("#"); c = [int(h[i:i+2],16)/255 for i in (0,2,4)]
    c = [(x/12.92 if x <= .03928 else ((x+.055)/1.055)**2.4) for x in c]
    return .2126*c[0] + .7152*c[1] + .0722*c[2]
def ratio(a, b):
    la, lb = lum(a), lum(b); return (max(la,lb)+.05)/(min(la,lb)+.05)
def blend(bg, fg, a):
    b = [int(bg.lstrip('#')[i:i+2],16) for i in (0,2,4)]
    f = [int(fg.lstrip('#')[i:i+2],16) for i in (0,2,4)]
    return "#%02x%02x%02x" % tuple(round(b[i]*(1-a)+f[i]*a) for i in range(3))

# 2. Every className string in the tree
files = subprocess.run(["grep","-rl","className","app/","components/","--include=*.tsx"],
                       capture_output=True, text=True).stdout.split()
CLS = re.compile(r'className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})')
TEXT = re.compile(r'\btext-([a-z][a-z0-9-]*)(?:/(\d+))?\b')
BG   = re.compile(r'\bbg-([a-z][a-z0-9-]*)(?:/(\d+))?\b')
SIZE = re.compile(r'\btext-(xs|sm|base|lg|xl|\dxl)\b')
BOLD = re.compile(r'\bfont-(bold|extrabold|black|semibold)\b')

issues, checked, unknown = [], 0, []
for f in files:
    src = open(f).read()
    for m in CLS.finditer(src):
        cls = m.group(1) or m.group(2) or m.group(3) or ""
        tms, bms = TEXT.findall(cls), BG.findall(cls)
        if not tms or not bms: continue
        # ignore size utilities that also start with text-
        tms = [t for t in tms if not SIZE.match("text-"+t[0])]
        for tname, top in tms:
            for bname, bop in bms:
                fg, bg = resolve(tname), resolve(bname)
                if not fg or not bg: continue
                # A translucent background composites over a parent this script
                # cannot see, so its real colour is unknown. Counting it as
                # solid produced nonsense like white text on bg-white/15 at
                # 1.0:1. Skipped rather than guessed; these need an eye.
                if bop:
                    unknown.append((f, tname, bname + "/" + bop)); continue
                checked += 1
                eff_fg = blend(bg, fg, int(top)/100) if top else fg
                r = ratio(eff_fg, bg)
                large = bool(BOLD.search(cls)) and bool(SIZE.search(cls)) \
                        or re.search(r'\btext-([2-9]xl)\b', cls)
                need = 3.0 if large else 4.5
                if r < need:
                    line = src[:m.start()].count("\n") + 1
                    issues.append((r, need, f, line, tname + ("/"+top if top else ""),
                                   bname + ("/"+bop if bop else "")))

issues.sort()
print("solid pairs checked: %d   below threshold: %d" % (checked, len(issues)))
print("translucent backgrounds skipped (parent unknown): %d\n" % len(unknown))
seen = set()
for r, need, f, line, t, b in issues:
    k = (t, b)
    if k in seen: continue
    seen.add(k)
    print("  %5.2f:1 (need %.1f)  text-%-28s on bg-%-24s %s:%d" % (r, need, t, b, f, line))
