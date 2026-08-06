/**
 * PDH alignment preview.
 *
 * A scratch surface for looking at the brand pieces together before any of it
 * touches the real app: the header bar with the pattern watermark, both
 * wordmark treatments, the palette, and the domain pictograms.
 *
 * Not linked from anywhere and not intended to ship. Deleting this route
 * removes the whole experiment.
 */

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
    <div
      className="relative overflow-hidden"
      style={{ background: BLUE }}
    >
      {/* The pattern sits as a faint watermark, as on p26 and p28. It is
          decorative, so it is a background rather than an <img>. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "url(/brand/patterns/pattern.svg)",
          backgroundRepeat: "repeat",
          backgroundSize: "auto 100%",
          opacity: 0.22,
        }}
      />
      <div className="relative flex items-center justify-between px-6 py-3">
        <div className="flex items-center gap-4">
          <img src="/brand/logos/logo_horizontal_white_orange.svg" alt="Pacific Data Hub" className="h-9" />
          <span className="h-8 w-px" style={{ background: "rgba(255,255,255,.35)" }} />
          {/* The descender means the wordmark box runs below the baseline, so
              it cannot be centred on its bounding box without sitting high. */}
          <img src={wordmark} alt="Data Surfer" className="h-7" />
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
    </div>
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
      <HeaderBar wordmark="/brand/wordmark/data-surfer-florin-white.svg" />

      <section className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="mb-1 text-2xl font-semibold">PDH alignment preview</h1>
        <p className="mb-8 text-sm opacity-70">
          Scratch surface. Nothing here is wired into the app.
        </p>

        <h2 className="mb-3 text-lg font-semibold">Wordmark</h2>
        <p className="mb-3 max-w-2xl text-sm opacity-75">
          The florin carries the meaning and is Surfer&rsquo;s own mark. The
          lambda restates what <span className="font-mono">PΛCIFIC DΛTΛ HUB</span>{" "}
          already does, so the second option reads as family resemblance and the
          first as an identity.
        </p>
        <div className="mb-4 rounded-lg border border-black/10 p-5">
          <img src="/brand/wordmark/data-surfer-florin.svg" alt="" className="h-14" />
          <p className="mt-2 text-xs opacity-60">One accent, matching .STAT EXPL⊙RER and PACIFIC MΛP</p>
        </div>
        <div className="mb-10 rounded-lg border border-black/10 p-5">
          <img src="/brand/wordmark/data-surfer-lambda-florin.svg" alt="" className="h-14" />
          <p className="mt-2 text-xs opacity-60">Three accents, closer to the parent lockup</p>
        </div>

        <h2 className="mb-3 text-lg font-semibold">Palette</h2>
        <div className="mb-10 flex flex-wrap gap-4">
          <Swatch hex={BLUE} name="Dark blue" note="Pantone Dark Blue C" />
          <Swatch hex={TURQUOISE} name="Turquoise" note="Pantone 312 C" />
          <Swatch hex={ORANGE} name="Deep orange" note="Pantone 138 C, accent only" />
          <Swatch hex={ICON_ORANGE} name="Icon orange" note="pictograms only" />
          <Swatch hex={PATTERN_TURQUOISE} name="Pattern turquoise" note="pattern only" />
        </div>

        <h2 className="mb-3 text-lg font-semibold">Gradient field</h2>
        <div
          className="mb-10 flex h-32 items-center justify-center rounded-lg"
          style={{ background: `linear-gradient(110deg, ${TURQUOISE}, ${BLUE})` }}
        >
          <img src="/brand/logos/logo_vertical_white_orange.svg" alt="" className="h-20" />
        </div>

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
    </main>
  );
}
