import Link from "next/link";
import { BrandField } from "@/components/brand-field";

/**
 * The Pacific Data Hub tool header (guidelines p28).
 *
 * Every PDH tool wears the same bar with its own name: `.STAT EXPL⊙RER`,
 * `PACIFIC MΛP`, `NEXUS GE⊙NODE`. Two of ours do too, so the bar takes the
 * wordmark as a prop rather than being forked per product: Data Surfer and
 * Country Snapshots are siblings under PDH, not one inside the other.
 *
 * Not mounted in the root layout. Pages compose their own top areas today, so
 * this is opt-in per page rather than a change that reaches every screen at
 * once.
 */
export function AppHeader({
  product = "data-surfer",
  home = "/",
  active,
  items = [
    { href: "/", label: "Home" },
    { href: "/explore", label: "Explore" },
    { href: "/dashboard", label: "Dashboards" },
  ],
  actions,
  sticky = false,
}: {
  /** Which sibling this is. Picks the wordmark and where the logo links. */
  product?: "data-surfer" | "country-snapshots";
  home?: string;
  active?: string;
  items?: Array<{ href: string; label: string }>;
  /** Page-specific controls, rendered after the nav. Style for a dark bar. */
  actions?: React.ReactNode;
  sticky?: boolean;
}) {
  return (
    <BrandField
      variant="header"
      className={sticky ? "sticky top-0 z-50" : undefined}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-3">
        <Link href={home} className="flex items-center gap-4">
          <img
            src="/brand/logos/logo_horizontal_white_orange.svg"
            alt="Pacific Data Hub"
            className="h-9 w-auto"
          />
          <span
            aria-hidden
            className="h-8 w-px"
            style={{ background: "rgba(255,255,255,.35)" }}
          />
          {/* The box is padded so its centre is the CAP centre, not the
              bounding-box centre, which the florin's descender would otherwise
              pull off. So items-center is correct here and no nudge is needed.
              Caps are 49% of the image height, hence the larger h. */}
          <img
            src={"/brand/wordmark/" + product + "-white.svg"}
            alt={product === "country-snapshots" ? "Country Snapshots" : "Data Surfer"}
            /* Country Snapshots is a much longer word at the same cap height,
               so it is set smaller to keep the bar from being all wordmark. */
            className={product === "country-snapshots" ? "h-7 w-auto" : "h-14 w-auto"}
          />
        </Link>

        <div className="flex items-center gap-3">
        <nav className="flex items-center gap-1 text-sm">
          {items.map((item) => {
            const isActive = active === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className="rounded-[var(--radius-sm)] px-3 py-1.5 text-white transition-colors hover:bg-white/10"
                style={
                  isActive
                    ? { background: "var(--color-tertiary)" }
                    : undefined
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        {actions}
        </div>
      </div>
    </BrandField>
  );
}
