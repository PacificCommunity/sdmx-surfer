# Aligning with the Pacific Data Hub visual identity

Distilled from *Pacific Data Hub Visual Identity Guidelines V1.0* (52pp, 2025,
redrawn by Eudanla), with page references so any claim here can be checked. The
full package (~300 MB of `.ai`, `.pdf`, `.idml` and licensed fonts) lives in
SharePoint and is deliberately not in this repository; only the curated web
assets under `public/brand/` are committed.

## The headline: we are already most of the way there

**The PDH website uses Inter** (stated on p26 and p27). SDMX Surfer already uses
Inter for interface and data. Trade Gothic, which the guidelines otherwise
specify (p12, p25), is for the logotype and print collateral, and is a licensed
Linotype face that we could not have served as a webfont anyway. That removes
what looked like the largest obstacle before we read the document: there is no
font licensing problem and no typeface migration.

What remains is colour, chrome, and iconography.

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

**Unresolved: the artwork does not match the specification.** The supplied logo
PDFs render `#1c478e` and `#e47f25`, against the `#223b83` and `#e37b0a` printed
on p11. Most likely a CMYK-to-RGB conversion difference on export. It matters
because our UI colour would sit directly beside the logo and any drift is
visible at that distance.

Taking the guidelines' stated hex values as authoritative, since they are the
written specification and are given in RGB explicitly. The supplied artwork is
left untouched: altering brand files is PDH's call, not ours. **Worth asking
the PDH team which is canonical** before this is locked in.

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

## Still missing

The SharePoint download reported that a folder named **`0. Web Elements`** did
not transfer. For web alignment that is likely the most directly relevant folder
in the package, and everything above is reconstructed from the guidelines PDF
and the logo artwork instead. Worth re-fetching before treating this document as
complete.
