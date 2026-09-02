import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";

// Self-hosted via next/font/local (development.md §0 — no CDN at runtime;
// files vendored in apps/web/public/fonts/, Fontsource variable latin).
const jakarta = localFont({
  src: "../../public/fonts/PlusJakartaSans-Variable.woff2",
  weight: "200 800",
  display: "swap",
  variable: "--font-jakarta",
});
const workSans = localFont({
  src: "../../public/fonts/WorkSans-Variable.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-work-sans",
});
const jetbrains = localFont({
  src: "../../public/fonts/JetBrainsMono-Variable.woff2",
  weight: "100 800",
  display: "swap",
  variable: "--font-jetbrains",
});

export const metadata: Metadata = {
  title: "Cookbook",
  description: "Home recipe book",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${workSans.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh bg-(--color-bg) text-(--color-text-primary) antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
