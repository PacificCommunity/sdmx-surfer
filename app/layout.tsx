import type { Metadata } from "next";
import "bootstrap/dist/css/bootstrap-grid.min.css";
import "sdmx-dashboard-components/dist/index.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "SPC Dashboard Builder",
  description:
    "Build SDMX data dashboards through natural-language conversation",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-surface-base">{children}</body>
    </html>
  );
}
