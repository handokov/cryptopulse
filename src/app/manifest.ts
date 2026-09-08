import type { MetadataRoute } from "next";

/**
 * PWA web app manifest (served automatically at /manifest.webmanifest).
 * Palette mirrors the forced-dark emerald design system:
 * background ≈ oklch(0.135 0.008 170) → #0b1310, primary emerald → #34d399.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "CryptoPulse — Market Intelligence, Visualized",
    short_name: "CryptoPulse",
    description:
      "Real-time crypto market intelligence: trusted news aggregation, top-100 price tracking, signal labs, step-by-step analysis, portfolio analytics and price alerts.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0b1310",
    theme_color: "#0b1310",
    categories: ["finance", "news"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Portfolio dashboard",
        url: "/#portfolio",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Markets",
        url: "/#markets",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
