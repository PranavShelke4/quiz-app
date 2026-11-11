import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const SITE_NAME = "Daily Quiz";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: { default: `${SITE_NAME}: one question a day, one champion`, template: `%s · ${SITE_NAME}` },
  description:
    "A daily quiz competition: one question every day, one answer, results hidden until the final leaderboard is revealed.",
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME}: the daily quiz competition`,
    description: "Answer one question a day. Results stay hidden until the final reveal.",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME}: the daily quiz competition`,
    description: "Answer one question a day. Results stay hidden until the final reveal.",
  },
};

export const viewport: Viewport = {
  themeColor: "#004a7f",
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-card px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          Skip to content
        </a>
        {children}
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
