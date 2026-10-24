import type { MetadataRoute } from "next";

/**
 * Web app manifest for the iamyou PWA.
 *
 * Using the Next.js App Router metadata convention: this file is served at
 * `/manifest.webmanifest` and Next automatically injects the
 * `<link rel="manifest">` tag, so no change to app/layout.tsx is required.
 *
 * Colors follow the app palette in app/globals.css: `background_color` is the
 * near-white canvas (--color-canvas) and `theme_color` is the slate accent
 * (--color-accent). Every icon referenced here exists under public/.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "iamyou",
    short_name: "iamyou",
    description: "Your digital twin: a predict-and-correct check-in loop.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f7f6",
    theme_color: "#1e293b",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
