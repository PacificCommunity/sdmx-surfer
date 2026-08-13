# Aligning with the Pacific Data Hub visual identity

Distilled from *Pacific Data Hub Visual Identity Guidelines V1.0* (52pp, 2025,
redrawn by Eudanla), with page references so any claim here can be checked. The
full package (~300 MB of `.ai`, `.pdf`, `.idml` and licensed fonts) lives in
SharePoint and is deliberately not in this repository; only the curated web
assets under `public/brand/` are committed.

## The headline: we are already most of the way there

**The PDH website uses Inter** (stated on p26 and p27). Data Surfer already uses
Inter for interface and data. Trade Gothic, which the guidelines otherwise
specify (p12, p25), is for the logotype and print collateral, and is a licensed
Linotype face that we could not have served as a webfont anyway. That removes
what looked like the largest obstacle before we read the document: there is no
font licensing problem and no typeface migration.

What remains is colour, chrome, and iconography.

## Typefaces

**Inter for everything on screen. Trade Gothic only as outlines in the
wordmark.** This was questioned, and the evidence supports it twice over.

PDH's own guidelines say it, on p26 and p27: "the website uses the Inter font
family". And the live site agrees: `pacificdata.org` serves Inter, Roboto Flex
and a Glyphicons icon font, with **no occurrence of Trade Gothic anywhere** in
the page or any of its stylesheets. So the split is PDH's stated and
implemented position rather than a limitation of ours.

There is also a licensing distinction worth keeping separate from the design
one, because it is the part most likely to bite. Desktop and webfont licences
are sold separately. A desktop licence covers installing the family and
producing artwork, which includes outlining the wordmark as we do. It does not
cover `@font-face`, which is usually priced by traffic. "We already paid for
Trade Gothic" can be true and still not extend to serving it.

If a webfont licence covering `pacificdata.org` and its subdomains is ever
confirmed, serving it is about half an hour: convert the needed weights to
woff2, add `@font-face`, point `--font-display` at it, and the wordmark could
become live text instead of SVG. Two reasons not to rush there even then: it
would make Surfer an outlier among its siblings, and Trade Gothic Bold Extended
is a display face that would serve the dense UI and data labels poorly. Inter is
doing real work in those places.

Weights loaded are 400, 500, 600, 700 and 800. Nothing should reach for 900:
the previous Montserrat request only went to 800 as well, so `font-black` was
being faux-bolded by the browser wherever it appeared.

## Colour

From p11, with Pantone references:

| Role | Hex | RGB | Pantone |
| --- | --- | --- | --- |
| Dark blue | `#223b83` | 34, 59, 131 | Dark Blue C |
| Turquoise | `#00a6c8` | 0, 166, 200 | 312 C |
| Deep orange | `#e37b0a` | 227, 123, 10 | 138 C |

The signature background is a gradient between the two blues, turquoise to dark
blue (p11, and used on every section divider in the document). Orange is an
accent: it marks the active nav item (p26, p28), the bespoke letterforms in the
wordmark, and the pictograms. It is never a large field.

**Resolved by the Web Elements assets.** The print PDFs render `#1c478e` and
`#e47f25`, which had looked like a conflict with the `#223b83` and `#e37b0a`
printed on p11. The official web SVGs use `#223b83` and `#e37b0a` exactly. So
the guidelines' hex values are authoritative for web and the print artwork
simply carries a CMYK-to-RGB export difference. Nothing to ask PDH about.

Two accents in the supplied assets are **not** the brand values, and this is
worth knowing before anyone "corrects" them:

| Asset | Colour | Brand equivalent |
| --- | --- | --- |
| Pictograms | `#f47216` | brand orange is `#e37b0a` |
| Pattern | `#1ab4cf` | brand turquoise is `#00a6c8` |

Both are brighter than the brand colour they correspond to, which reads as
deliberate: the pictograms and pattern sit on dark blue fields where the brand
values would go muddy. Treat them as the intended values for those assets rather
than as drift to be normalised.

## Chrome

**Header** (p28). A solid dark blue bar, full width. Horizontal logo lockup in
white at the left. Navigation to the right, with the active item on an orange
fill. Account and help icons at the far right. The Pacific pattern appears very
faintly in the bar as a watermark.

Note that each PDH tool gets the same bar with its own name in the wordmark
style: `.STAT EXPLORER`, `PACIFIC MAP`, `NEXUS GEONODE`, `MICRODATA LIBRARY`.
A Surfer header would be a sibling of these, which means the product name needs
setting in that style, including the bespoke `Λ` and `⊙` letterforms picked out
in orange (p12).

**Logo orientation** (p5). The centred lockup is preferred everywhere *except*
the website, which uses the horizontal one. Both are in `public/brand/`.

**Footer** (p27). Near-black field, four column groups: Information, PDH Tools,
Countries (running to two columns, all 22 PICTs), and a right-hand block with
the logo and a newsletter signup. Social icons sit in a fixed right rail.
Copyright line reads "Copyright Pacific Community *year* | Privacy policy |
Terms of use".

## Pictograms

Fifteen domain pictograms (p21, p22): Fisheries & Aquaculture, Agriculture &
Forestry, Energy, Social & Culture, Gender, Health, Population, Food, Economy,
Ocean & Maritime, Education, Climate Change Disasters & Risks, Information
Communication & Technology, Environment, Disability. Two forms: orange line art
in a white circle, and a compact orange-filled circle.

These map closely onto the categories we already carry per dataflow from
`CAS_COM_TOPIC` and `CAS_COM_DEV`, so the explorer could show PDH's own domain
icons rather than generic ones. That is a real alignment opportunity rather than
a cosmetic one, and it is cheap because the categorisation already exists.

The guidelines are explicit that these "are not subject or secondary logos" and
should not be used in a way that suggests they are (p21).

## Where the pattern goes

The guidelines call the pattern "a structuring and inspiring graphic element"
that "illustrates the dissemination of information and knowledge" (p16, p24),
and close the same page with "always give priority to legibility". In a data
application those pull against each other harder than in a brochure.

The rule:

> **The pattern goes around content, never under it.**

An earlier version of this said "pattern density runs inversely to information
density", which sounds similar and is not. It permitted a strong pattern
wherever there was no *data*, so the home page hero got the pattern full-bleed
behind its headline and body copy, and the contrast dropped far enough to be
genuinely hard to read. "No data" is not "no text".

The rule above is also what the guidelines themselves do: every section divider
puts the pattern in the top-right and bottom-right with the title in clear
space, and the home page on p26 keeps it to the edges.

| Surface | Pattern | Where |
| --- | --- | --- |
| Header ribbon | 18% | Full width. The deliberate exception: a thin bar with large type, which PDH's own headers do the same way. |
| Hero | 50% | Framed. Clear in the middle, present in the outer band. |
| Footer | 24% | Side bands. |
| Section dividers | light | Full, since they carry no body text. |
| **Panels, charts, tables, chat** | **none** | Content is the point. |

The hero is the instructive case. It looks like a large empty field, but both of
its columns carry text, and below `lg` the text column goes full width, so any
vertical band would sit under copy at some breakpoint. A frame stays in the
padding at every size without the component needing to know the layout.

Implemented as `BrandField`, which takes a variant and a `patternArea` rather
than raw opacities, so this is enforced in one file rather than remembered at
each call site.

## What this means for Oceanic Data-Scapes

The current system is close in spirit and different in specifics. Oceanic runs
Deep Sea `#004467`, Reef Teal `#006970`, Lagoon `#6fd6df`; PDH runs a bluer,
more saturated `#223b83` with turquoise `#00a6c8` and an orange accent Oceanic
does not have at all. Manrope is used for display; PDH web uses Inter
throughout.

So this is a palette and chrome change rather than a rebuild. The open design
question is **charts**, where colour carries meaning rather than brand. A
three-colour brand palette cannot serve as a categorical scale, and stretching
it into one would produce indistinguishable series. The likely answer is brand
colours for chrome and a separate accessible categorical scale for data, tuned
to sit beside the brand rather than inside it, but that is a decision to take
deliberately.

## Web Elements

Retrieved on the second attempt, by downloading from inside the folder: OneDrive
raised a `SerializationException` packaging it whole. It contains web-ready SVGs
and supersedes the vector-PDF conversions made before it arrived.

- `logos/` — horizontal and vertical, coloured and white-with-orange
- `icons/` — the fifteen domain pictograms, one SVG each
- `patterns/` — the Pacific pattern at three densities, plus a picture variant
- `favicon/` — a full favicon set with `site.webmanifest`

Copied to `public/brand/{logos,icons,patterns}`, about 1.1 MB. The pattern files
dominate that; if they end up on a hot path they should be checked for whether a
tiled fragment does the job of the full artwork.

**The favicon set is deliberately not adopted.** It is the PDH mark, and using
it would make Surfer's browser tab claim to be Pacific Data Hub rather than a
tool within it. Whether Surfer takes PDH's favicon, keeps its own, or gets a
sibling mark is a naming and identity decision, not a file copy. It is the same
question as the per-tool header on p28.
