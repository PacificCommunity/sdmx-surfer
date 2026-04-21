import type { Metadata } from "next";
import "bootstrap/dist/css/bootstrap-grid.min.css";
import "sdmx-dashboard-components/dist/index.css";
import "./globals.css";
import { BRAND_GOOGLE_FONTS_HREF } from "@/lib/brand-theme";
import { SdmxProxyBoot } from "./sdmx-proxy-boot";

export const metadata: Metadata = {
  title: "SDMX Surfer",
  description:
    "Surf Pacific data — explore SDMX statistics through conversation",
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
        <SdmxProxyBoot />
        {children}
      </body>
    </html>
  );
}
