import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Outfit } from "next/font/google";
import "./globals.css";

// The two typefaces of the iamyou look, shared by the landing page, the app and
// the film: Outfit for text, JetBrains Mono for labels and readouts.
const display = Outfit({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--lx-display", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400"], variable: "--lx-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://www.iamyou.si"),
  title: "iamyou",
  description: "Your digital twin: a predict-and-correct check-in loop.",
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#f4f7fb",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
