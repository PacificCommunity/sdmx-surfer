/**
 * PDH alignment preview.
 *
 * A scratch surface for looking at the brand pieces together before any of it
 * touches the real app: the pattern carried through header, hero and footer,
 * the wordmark, the palette, and the domain pictograms.
 *
 * Not linked from anywhere and not intended to ship. Deleting this route
 * removes the whole experiment.
 */

import { BrandField } from "@/components/brand-field";

const BLUE = "#223b83";
const TURQUOISE = "#00a6c8";
const ORANGE = "#e37b0a";
const ICON_ORANGE = "#f47216";
const PATTERN_TURQUOISE = "#1ab4cf";

const ICONS = [
  "agriculture", "climatechange", "disability", "economy", "education",
  "energy", "environment", "fisheries", "food", "gender", "health",
  "ict", "ocean", "population", "social",
];

/** The header from the guidelines p28: solid blue, pattern watermark, orange active item. */
function HeaderBar({ wordmark }: { wordmark: string }) {
  return (
    <BrandField variant="header">
      <div className="flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-4">
          <img src="/brand/logos/logo_horizontal_white_orange.svg" alt="Pacific Data Hub" className="h-9" />
          <span className="h-8 w-px" style={{ background: "rgba(255,255,255,.35)" }} />
          {/* Self-centring on its caps, so items-center needs no nudge. */}
          <img src={wordmark} alt="Data Surfer" className="h-14" />
        </div>
        <nav className="flex items-center gap-1 text-sm text-white">
          {["Home", "Explore", "Dashboards", "Countries"].map((item, i) => (
            <span
              key={item}
              className="rounded px-3 py-1.5"
              style={i === 1 ? { background: ORANGE } : undefined}
            >
              {item}
            </span>
          ))}
        </nav>
      </div>
    </BrandField>
  );
}

function Swatch({ hex, name, note }: { hex: string; name: string; note?: string }) {
  return (
    <div className="min-w-40">
      <div className="h-16 rounded-md" style={{ background: hex }} />
      <p className="mt-1.5 text-sm font-medium">{name}</p>
      <p className="font-mono text-xs opacity-70">{hex}</p>
      {note && <p className="mt-0.5 text-xs opacity-60">{note}</p>}
    </div>
  );
}

export default function PdhPreview() {
  return (
    <main className="min-h-screen bg-white pb-24 text-[#181c1e]">
      <HeaderBar wordmark="/brand/wordmark/data-surfer-white.svg" />

      <section className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="mb-1 text-2xl font-semibold">PDH alignment preview</h1>
        <p className="mb-8 text-sm opacity-70">
          Scratch surface. Nothing here is wired into the app.
        </p>

        <h2 className="mb-3 text-lg font-semibold">Wordmark</h2>
        <p className="mb-3 max-w-2xl text-sm opacity-75">
          One accent, matching the sibling tools, which use one each:{" "}
          <span className="font-mono">.STAT EXPL⊙RER</span>,{" "}
          <span className="font-mono">PACIFIC MΛP</span>,{" "}
          <span className="font-mono">NEXUS GE⊙NODE</span>. The florin is
          Surfer&rsquo;s own mark and carries the meaning; a lambda in DATA would
          only restate what <span className="font-mono">PΛCIFIC DΛTΛ HUB</span>{" "}
          already says.
        </p>
        <div className="mb-10 rounded-lg border border-black/10 p-5">
          <img src="/brand/wordmark/data-surfer.svg" alt="" className="h-14" />
        </div>

        <h2 className="mb-3 text-lg font-semibold">Palette</h2>
        <div className="mb-10 flex flex-wrap gap-4">
          <Swatch hex={BLUE} name="Dark blue" note="Pantone Dark Blue C" />
          <Swatch hex={TURQUOISE} name="Turquoise" note="Pantone 312 C" />
          <Swatch hex={ORANGE} name="Deep orange" note="Pantone 138 C, accent only" />
          <Swatch hex={ICON_ORANGE} name="Icon orange" note="pictograms only" />
          <Swatch hex={PATTERN_TURQUOISE} name="Pattern turquoise" note="pattern only" />
        </div>

        <h2 className="mb-3 text-lg font-semibold">Hero field</h2>
        <p className="mb-3 max-w-2xl text-sm opacity-75">
          The pattern carried at strength, as on the guidelines&rsquo; section
          dividers and the home page. Nothing competes with it here, so it can
          be much louder than in chrome.
        </p>
        <BrandField variant="hero" className="mb-10 rounded-lg">
          <div className="flex flex-col items-center gap-4 px-6 py-14 text-center">
            <img src="/brand/wordmark/data-surfer-white.svg" alt="Data Surfer" className="h-12" />
            <p className="max-w-lg text-sm text-white/85">
              Explore Pacific statistics by asking for them.
            </p>
          </div>
        </BrandField>

        <h2 className="mb-3 text-lg font-semibold">Domain pictograms</h2>
        <p className="mb-3 max-w-2xl text-sm opacity-75">
          Fifteen of them, and we already carry a category per dataflow from
          CAS_COM_TOPIC, so these can key off data we hold rather than a new
          mapping.
        </p>
        <div className="flex flex-wrap gap-3">
          {ICONS.map((n) => (
            <div key={n} className="flex w-24 flex-col items-center gap-1">
              <img src={`/brand/icons/icon_${n}.svg`} alt="" className="h-14 w-14" />
              <span className="text-center text-[10px] opacity-60">{n}</span>
            </div>
          ))}
        </div>
      </section>

      <BrandField variant="footer" patternColour="#1ab4cf">
        <div className="mx-auto flex max-w-5xl items-start justify-between gap-8 px-6 py-12 text-sm text-white/80">
          <div>
            <p className="mb-2 font-semibold text-white">INFORMATION</p>
            <p>About</p><p>User guides</p><p>Contact</p>
          </div>
          <div>
            <p className="mb-2 font-semibold text-white">PDH TOOLS</p>
            <p>Pacific Map</p><p>.Stat Data Explorer</p><p>Microdata Library</p>
          </div>
          <div className="text-right">
            <img src="/brand/logos/logo_horizontal_white_orange.svg" alt="" className="ml-auto h-9" />
            <p className="mt-3 text-xs opacity-70">
              Copyright Pacific Community 2026
            </p>
          </div>
        </div>
      </BrandField>
    </main>
  );
}
