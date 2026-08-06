/**
 * A Pacific Data Hub branded field: a coloured surface carrying the Pacific
 * pattern.
 *
 * The pattern is a structural element of the identity rather than a texture
 * (guidelines p16: it "illustrates the dissemination of information and
 * knowledge... a structuring and inspiring graphic element"), so it belongs on
 * the surfaces that frame the app, not only in the header.
 *
 * Drawn with a CSS mask rather than as an image. The artwork is 337 filled
 * paths in a single colour, so masking lets one 186 KB asset take whatever
 * colour a surface needs instead of shipping a recoloured copy per context.
 * Where masks are unsupported the field renders as flat colour, which is a
 * clean degradation rather than a broken one.
 *
 * The pattern is decorative in every variant here, so it is hidden from
 * assistive technology and never carries meaning on its own.
 */

export type BrandFieldVariant = "header" | "hero" | "footer";

const SURFACES: Record<BrandFieldVariant, string> = {
  // Solid dark blue bar, as the website headers on p28.
  header: "#223b83",
  // The signature gradient, turquoise into dark blue, as every section
  // divider in the guidelines and the home page hero on p26.
  hero: "linear-gradient(115deg, #00a6c8 0%, #223b83 100%)",
  // Near-black, as the website footer on p27.
  footer: "#111417",
};

/**
 * How loudly the pattern reads. Chrome sits behind content and has to stay
 * quiet; a hero can carry it much stronger because nothing competes with it.
 */
const PATTERN_OPACITY: Record<BrandFieldVariant, number> = {
  header: 0.18,
  hero: 0.4,
  footer: 0.22,
};

/** Pattern height relative to the field. Larger reads calmer. */
const PATTERN_SCALE: Record<BrandFieldVariant, string> = {
  header: "auto 340%",
  hero: "auto 118%",
  footer: "auto 150%",
};

export function BrandField({
  variant = "header",
  patternColour = "#ffffff",
  className = "",
  children,
}: {
  variant?: BrandFieldVariant;
  /** Colour of the pattern itself. White on blue, turquoise on near-black. */
  patternColour?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const mask = "url(/brand/patterns/pattern.svg)";
  return (
    <div
      className={"relative overflow-hidden " + className}
      style={{ background: SURFACES[variant] }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: patternColour,
          opacity: PATTERN_OPACITY[variant],
          maskImage: mask,
          WebkitMaskImage: mask,
          maskRepeat: "repeat",
          WebkitMaskRepeat: "repeat",
          maskSize: PATTERN_SCALE[variant],
          WebkitMaskSize: PATTERN_SCALE[variant],
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}
