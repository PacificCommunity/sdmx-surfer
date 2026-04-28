import Link from "next/link";

export function AppFooter({ className }: { className?: string }) {
  return (
    <footer
      className={
        "text-center text-xs text-on-surface-variant " +
        (className ?? "mt-16 pb-8")
      }
    >
      SDMX Surfer · Built at the Pacific Community ·{" "}
      <Link href="/about" className="hover:underline">
        About
      </Link>
    </footer>
  );
}
