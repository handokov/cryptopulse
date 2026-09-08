import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "flag-icons/css/flag-icons.min.css";
import { Toaster as RadixToaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { IntlProvider } from "@/i18n/intl-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CryptoPulse — Market Intelligence, Visualized",
  description:
    "Aggregates trusted crypto news and tracks daily market trends for high-volume assets. Interactive signal polygons, slider-driven projection graphs, and step-by-step forward-looking trade analysis.",
  keywords: [
    "crypto",
    "bitcoin",
    "ethereum",
    "market analysis",
    "trading",
    "news aggregation",
    "technical indicators",
  ],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "CryptoPulse — Market Intelligence, Visualized",
    description:
      "Track daily crypto market trends, drag signal vertices, tune projection functions, and run step-by-step forward-looking analysis.",
    siteName: "CryptoPulse",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <IntlProvider>{children}</IntlProvider>
        <RadixToaster />
        {/* forced-dark app: pin sonner to dark (wrapper's useTheme() resolves to system without a ThemeProvider) */}
        <SonnerToaster theme="dark" position="bottom-right" />
      </body>
    </html>
  );
}
