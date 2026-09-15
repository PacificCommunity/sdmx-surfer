"""Build the Pacific Data Hub tool wordmarks.

Run:  python3 scripts/build-wordmarks.py   (writes public/brand/wordmark/*.svg)

Every PDH tool sets its name in Trade Gothic Bold Extended with one bespoke
letter picked out in orange: .STAT EXPL⊙RER, PACIFIC MΛP, NEXUS GE⊙NODE,
MICR⊙DATA LIBRΛRY. These follow the same convention.

Three kinds of accent:

  substitute  a real glyph from the font, addressed by character. DATA SURƒER
              uses U+0192, the florin, which Trade Gothic has. Worth reaching
              for first: it is drawn by the type designer at the right weight,
              where anything drawn here is matched by eye against a face
              somebody else made.
  lambda      the A with its crossbar removed, which is what PDH does. Its
              geometry is taken from the real A outline rather than eyeballed.
  odot        the O with a dot at its optical centre, sized to leave the
              counter breathing.

Outlining rather than serving the font is also the licence-clean way round:
Trade Gothic is a licensed Linotype family, and outlining glyphs for a logo is
ordinary desktop use where serving the TTF as a webfont is not.

Boxes are centred on the CAP band, not the ink, so a descender or a dot cannot
pull the capitals off centre wherever the mark is vertically centred. Every call
site can then just use items-center.
"""
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.boundsPen import BoundsPen

FONT = "brand/fonts/Font - 14 Trade Gothic/Trade Gothic LT Bold Extended.ttf"
BLUE, ORANGE, WHITE = "#223b83", "#e37b0a", "#ffffff"
PAD = 40

f = TTFont(FONT)
gs = f.getGlyphSet()
cmap = f.getBestCmap()
kern = {}
if "kern" in f:
    for st in f["kern"].kernTables:
        kern.update(st.kernTable)

def outline(ch):
    pen = SVGPathPen(gs); gs[cmap[ord(ch)]].draw(pen); return pen.getCommands()
def bounds(ch):
    bp = BoundsPen(gs); gs[cmap[ord(ch)]].draw(bp); return bp.bounds
def advance(ch):
    return f["hmtx"][cmap[ord(ch)]][0]

# The A minus its crossbar: outer edges are the A's own, inner edges are those
# offset by the stem width, meeting at (447,585).
LAMBDA = "M8 0 L366 727 L528 727 L881 0 L731 0 L447 585 L159 0 Z"

def odot():
    x0, y0, x1, y1 = bounds("O")
    cx, cy, r = (x0+x1)/2, (y0+y1)/2, (x1-x0)*0.125
    k = r*0.5523
    return outline("O") + (
        "M%.0f %.0f C%.0f %.0f %.0f %.0f %.0f %.0f C%.0f %.0f %.0f %.0f %.0f %.0f "
        "C%.0f %.0f %.0f %.0f %.0f %.0f C%.0f %.0f %.0f %.0f %.0f %.0f Z" % (
            cx+r,cy, cx+r,cy+k, cx+k,cy+r, cx,cy+r, cx-k,cy+r, cx-r,cy+k, cx-r,cy,
            cx-r,cy-k, cx-k,cy-r, cx,cy-r, cx+k,cy-r, cx+r,cy-k, cx+r,cy))

WORDMARKS = [
    {"file": "data-surfer", "text": "DATA SURFER",
     "accent": {"index": 8, "kind": "substitute", "char": "ƒ"}},
    {"file": "country-snapshots", "text": "COUNTRY SNAPSHOTS",
     "accent": {"index": 1, "kind": "odot"}},
]

def build(spec, colour, path):
    text, acc = spec["text"], spec["accent"]
    glyphs, x, prev = [], 0, None
    for i, ch in enumerate(text):
        src = acc["char"] if (i == acc["index"] and acc["kind"] == "substitute") else ch
        name = cmap[ord(src)]
        if prev is not None:
            x += kern.get((prev, name), 0)
        if i == acc["index"] and acc["kind"] == "lambda":
            d = LAMBDA
        elif i == acc["index"] and acc["kind"] == "odot":
            d = odot()
        else:
            d = outline(src)
        glyphs.append({"d": d, "x": x, "b": bounds(src), "accent": i == acc["index"]})
        x += advance(src)
        prev = name
    total = x

    cap = max(g["b"][3] for g in glyphs if g["b"] and not g["accent"])
    ymin = min(g["b"][1] for g in glyphs if g["b"])
    ymax = max(g["b"][3] for g in glyphs if g["b"])
    half = max(cap/2 - (ymin - PAD), (ymax + PAD) - cap/2)
    y0, h = cap/2 - half, 2*half

    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="%d %d %d %d" '
             'width="%d" height="%d" role="img" aria-label="%s">'
             % (-PAD, -(y0+h), total+2*PAD, h, total+2*PAD, h, text.title()),
             '<g transform="scale(1,-1)">']
    for g in glyphs:
        if not g["d"].strip():
            continue
        parts.append('<path transform="translate(%d 0)" d="%s" fill="%s"/>'
                     % (g["x"], g["d"], ORANGE if g["accent"] else colour))
    parts.append("</g></svg>")
    open(path, "w").write("".join(parts))
    return total + 2*PAD, h

for spec in WORDMARKS:
    for colour, suffix in [(BLUE, ""), (WHITE, "-white")]:
        p = "public/brand/wordmark/%s%s.svg" % (spec["file"], suffix)
        w, h = build(spec, colour, p)
        if not suffix:
            print("  %-22s %s  %d x %d" % (spec["file"], spec["text"], w, h))
