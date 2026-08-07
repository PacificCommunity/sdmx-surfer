"""Set the DATA SURƒER wordmark from Trade Gothic's own outlines.

Run:  python3 scripts/build-wordmark.py   (writes public/brand/wordmark/*.svg)

The florin is the font's own glyph, U+0192, not a drawn approximation. It was
worth checking for: an earlier version hand-built an F with a tail, which had
to be weighted and curved by eye against a face designed by someone else.
pymupdf silently drops the character because insert_text encodes Latin-1, and
its TextWriter cannot embed this font at all, which is why this reads the
outlines from the font directly.

Outlining rather than serving the font is also the licence-clean way round:
Trade Gothic is a licensed Linotype family, and outlining glyphs for a logo is
ordinary desktop use where serving the TTF as a webfont is not.

The box is centred on the CAP band, not on the ink. The florin descends well
below the baseline, so a box centred on the ink leaves the capitals sitting
high wherever the mark is vertically centred. Doing it here means every call
site can just use items-center.
"""
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

FONT = "brand/fonts/Font - 14 Trade Gothic/Trade Gothic LT Bold Extended.ttf"
TEXT = "DATA SURƒER"
ACCENT_INDEX = 8            # the florin
BLUE, ORANGE = "#223b83", "#e37b0a"

f = TTFont(FONT)
upm = f["head"].unitsPerEm
cmap = f.getBestCmap()
gs = f.getGlyphSet()
kern = {}
if "kern" in f:
    for st in f["kern"].kernTables:
        kern.update(st.kernTable)

glyphs, x = [], 0
prev = None
for i, ch in enumerate(TEXT):
    name = cmap[ord(ch)]
    if prev is not None:
        x += kern.get((prev, name), 0)
    pen = SVGPathPen(gs)
    gs[name].draw(pen)
    bp = BoundsPen(gs)
    gs[name].draw(bp)
    glyphs.append({"ch": ch, "d": pen.getCommands(), "x": x,
                   "bounds": bp.bounds, "accent": i == ACCENT_INDEX})
    x += f["hmtx"][name][0]
    prev = name
total = x

# Ink bounds, then pad and centre the box on the CAP band so `items-center`
# aligns on the capitals rather than on the florin's descender.
cap = max(g["bounds"][3] for g in glyphs if g["bounds"] and not g["accent"])
ymin = min(g["bounds"][1] for g in glyphs if g["bounds"])
ymax = max(g["bounds"][3] for g in glyphs if g["bounds"])
PAD = 40
cap_centre = cap / 2                       # baseline 0 to cap top
bottom = ymax + PAD                        # in flipped space this is the top
top = ymin - PAD
half = max(cap_centre - top, bottom - cap_centre)
y0, h = cap_centre - half, 2 * half

def svg(base):
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="%d %d %d %d" '
             'width="%d" height="%d" role="img" aria-label="Data Surfer">'
             % (-PAD, -(y0 + h), total + 2 * PAD, h, total + 2 * PAD, h)]
    parts.append('<g transform="scale(1,-1)">')
    for g in glyphs:
        if not g["d"].strip():
            continue
        parts.append('<path transform="translate(%d 0)" d="%s" fill="%s"/>'
                     % (g["x"], g["d"], ORANGE if g["accent"] else base))
    parts.append("</g></svg>")
    return "".join(parts)

for out, base in [("public/brand/wordmark/data-surfer.svg", BLUE),
                  ("public/brand/wordmark/data-surfer-white.svg", "#ffffff")]:
    open(out, "w").write(svg(base))

print("accent glyph:", TEXT[ACCENT_INDEX], " upm:", upm)
print("advance width:", total, " cap:", cap, " ink y:", ymin, "..", ymax)
print("box: %d x %d   (cap-centred)" % (total + 2 * PAD, h))
print("kern pairs applied:", sum(1 for i in range(1, len(TEXT))))
