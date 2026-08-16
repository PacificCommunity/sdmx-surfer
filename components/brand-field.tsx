/**
 * A Pacific Data Hub branded field: a coloured surface carrying the Pacific
 * pattern.
 *
 * The pattern is a structural element of the identity rather than a texture
 * (guidelines p16: it "illustrates the dissemination of information and
 * knowledge... a structuring and inspiring graphic element"), so it belongs on
 * the surfaces that frame the app.
 *
 * THE PATTERN GOES AROUND CONTENT, NOT UNDER IT. This is how the guidelines
 * use it: every section divider puts the pattern in the top-right and
 * bottom-right and leaves the title in clear space, and the home page on p26
 * keeps it to the edges. Running it full-bleed behind body text drops the
 * contrast far enough to be genuinely hard to read, which is also the one thing
 * the guidelines ask for outright: "always give priority to legibility" (p24).
 *
 * `patternArea` is how that is enforced rather than remembered. The pattern is
 * masked a second time by a gradient, so it is present at the edges and gone
 * where text sits. The header is the deliberate exception: it is a thin ribbon
 * with large type at 18%, which the guidelines themselves do full width.
 *
 * Drawn with a CSS mask rather than as an image, so one 186 KB asset takes
 * whatever colour a surface needs. Where masks are unsupported the field
 * renders as flat colour, which is a clean degradation rather than a broken
 * one. The pattern is decorative in every variant and is hidden from assistive
 * technology.
 */

export type BrandFieldVariant = "header" | "hero" | "footer" | "panel";

/** Where the pattern is allowed to appear. */
export type PatternArea = "full" | "frame" | "right" | "sides";

const SURFACES: Record<BrandFieldVariant, string> = {
  // Solid dark blue bar, as the website headers on p28.
  header: "#223b83",
  // The signature gradient. Dark blue FIRST, which is the opposite of the
  // guidelines' section dividers and deliberate: their dividers carry a short
  // centred title, ours carries a headline and a paragraph in the top-left.
  // White on the turquoise end is 2.9:1, below AA for body text; on the dark
  // end it is 10.4:1. So the copy sits on the dark end and the turquoise runs
  // out to the right, behind the stat cards, which have their own surfaces.
  hero: "linear-gradient(115deg, #223b83 0%, #1b4a94 45%, #00a6c8 140%)",
  // Near-black, as the website footer on p27.
  footer: "#111417",
  // A light surface, for empty states. The rule says the pattern belongs
  // where there is nothing to read, and an empty state is the clearest case
  // of that: the user is waiting rather than reading, and it is the one
  // moment a working screen can carry the identity without being in the way.
  panel: "var(--color-surface-low)",
};

const PATTERN_OPACITY: Record<BrandFieldVariant, number> = {
  header: 0.18,
  // Higher than before it was confined to the edges: it can be bolder now
  // precisely because it is no longer competing with anything.
  hero: 0.5,
  footer: 0.24,
  // Quiet: this sits inside a working surface, not a brand moment.
  panel: 0.1,
};

/** Pattern height relative to the field. Larger reads calmer. */
const PATTERN_SCALE: Record<BrandFieldVariant, string> = {
  header: "auto 340%",
  hero: "auto 118%",
  footer: "auto 150%",
  panel: "auto 190%",
};

/** The header is a ribbon and does the full width, as PDH's own headers do. */
const DEFAULT_AREA: Record<BrandFieldVariant, PatternArea> = {
  header: "full",
  // Not "right": both hero columns carry text, and below lg the text column
  // goes full width, so any vertical band would end up under it at some
  // breakpoint. A frame stays in the padding at every size.
  hero: "frame",
  footer: "sides",
  panel: "frame",
};

/**
 * Gradient that clears the middle so content never sits over pattern.
 *
 * Applied as a mask on a wrapper, with the pattern mask on the child, so the
 * two compose by nesting. Doing it in one element would need
 * `mask-composite`, which is less widely supported and fails in the direction
 * that leaves the pattern everywhere.
 */
const AREA_MASK: Record<PatternArea, string | undefined> = {
  full: undefined,
  // Clear in the middle, pattern in the outer band. Content sits inside the
  // field's padding, so this holds at every breakpoint without needing to know
  // the layout, which a left/right split does not.
  frame:
    "radial-gradient(ellipse 78% 74% at 50% 50%, transparent 62%, rgba(0,0,0,.55) 84%, #000 100%)",
  right:
    "linear-gradient(to right, transparent 0%, transparent 52%, rgba(0,0,0,.65) 72%, #000 88%)",
  sides:
    "linear-gradient(to right, #000 0%, rgba(0,0,0,.5) 14%, transparent 30%, " +
    "transparent 70%, rgba(0,0,0,.5) 86%, #000 100%)",
};

export function BrandField({
  variant = "header",
  patternColour,
  patternArea,
  className = "",
  children,
}: {
  variant?: BrandFieldVariant;
  /** Pattern colour. Defaults to white on dark fields, brand blue on light. */
  patternColour?: string;
  patternArea?: PatternArea;
  className?: string;
  children?: React.ReactNode;
}) {
  const area = patternArea ?? DEFAULT_AREA[variant];
  const colour =
    patternColour ?? (variant === "panel" ? "var(--color-primary)" : "#ffffff");
  const areaMask = AREA_MASK[area];
  const patternMask = "url(/brand/patterns/pattern.svg)";

  const pattern = (
    <div
      className="absolute inset-0"
      style={{
        background: colour,
        opacity: PATTERN_OPACITY[variant],
        maskImage: patternMask,
        WebkitMaskImage: patternMask,
        maskRepeat: "repeat",
        WebkitMaskRepeat: "repeat",
        maskSize: PATTERN_SCALE[variant],
        WebkitMaskSize: PATTERN_SCALE[variant],
      }}
    />
  );

  return (
    <div
      className={"relative overflow-hidden " + className}
      style={{ background: SURFACES[variant] }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={
          areaMask
            ? {
                maskImage: areaMask,
                WebkitMaskImage: areaMask,
              }
            : undefined
        }
      >
        {pattern}
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}
