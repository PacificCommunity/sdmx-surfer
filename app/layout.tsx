import type { Metadata } from "next";
import "bootstrap/dist/css/bootstrap-grid.min.css";
import "sdmx-dashboard-components/dist/index.css";
import "./globals.css";
import { BRAND_GOOGLE_FONTS_HREF } from "@/lib/brand-theme";

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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href={BRAND_GOOGLE_FONTS_HREF} rel="stylesheet" />
      </head>
      <body className="min-h-screen bg-surface">
        {children}
      </body>
    </html>
  );
}
