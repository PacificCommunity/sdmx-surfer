import Link from "next/link";
import { BrandField } from "@/components/brand-field";

/**
 * The Pacific Data Hub footer (guidelines p27): a near-black field carrying the
 * pattern, with the lockup and an attribution line.
 *
 * `compact` keeps the original single line for pages that only want a footnote,
 * so adopting the branded version is a per-page choice rather than something
 * that lands on every screen at once. PDH's own footer also carries column
 * groups for Information, Tools and all 22 countries; those are links we do not
 * own yet, so they are left out rather than invented.
 */
export function AppFooter({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <footer
        className={
          "text-center text-xs text-on-surface-variant " +
          (className ?? "mt-16 pb-8")
        }
      >
        Data Surfer · Built at the Pacific Community ·{" "}
        <Link href="/about" className="hover:underline">
          About
        </Link>
      </footer>
    );
  }

  return (
    <BrandField
      variant="footer"
      patternColour="var(--color-brand-pattern)"
      className={className ?? "mt-16"}
    >
      <footer className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-8 px-6 py-10 text-sm text-white/75">
        <div>
          <img
            src="/brand/logos/logo_horizontal_white_orange.svg"
            alt="Pacific Data Hub"
            className="mb-3 h-8 w-auto"
          />
          <p className="text-xs">
            Data Surfer · Built at the Pacific Community
          </p>
        </div>

        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
          <Link href="/about" className="hover:text-white">
            About
          </Link>
          <Link href="/gallery" className="hover:text-white">
            Gallery
          </Link>
          <a
            href="https://pacificdata.org"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-white"
          >
            Pacific Data Hub
          </a>
          <span className="opacity-60">
            © Pacific Community {new Date().getFullYear()}
          </span>
        </nav>
      </footer>
    </BrandField>
  );
}
