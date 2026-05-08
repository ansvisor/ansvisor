import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter, Plus_Jakarta_Sans } from "next/font/google";
import { FontProvider } from "@/components/providers/font-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Ansvisor",
    template: "%s | Ansvisor",
  },
  description:
    "Monitor, analyze, and optimize your brand's visibility in AI-powered search engines.",
  // The product app at app.ansvisor.com should not appear in search results;
  // ansvisor.com (the Webflow marketing site) is the indexable surface.
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${jakarta.variable}`}>
      <body
        suppressHydrationWarning
        className="font-sans antialiased"
      >
        <FontProvider />
        {children}
      </body>
    </html>
  );
}
