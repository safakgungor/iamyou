import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "iamyou",
  description: "Your digital twin: a predict-and-correct check-in loop.",
  icons: {
    icon: "/icon-192.png",
    apple: "/apple-touch-icon.png",
  },
};

// Slate accent (--color-accent in app/globals.css), matching the manifest.
export const viewport: Viewport = {
  themeColor: "#1e293b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
