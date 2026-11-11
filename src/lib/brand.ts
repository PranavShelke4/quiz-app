export const APP_NAME = "Daily Quiz";

/**
 * Brand logos, committed in public/brand/ and served as static files.
 *  - mark:          the "i" symbol on its own (for light backgrounds)
 *  - wordmarkLight: symbol + "ICICI Bank" in white lettering (for navy/dark backgrounds only)
 *
 * These are fixed paths on purpose: on Vercel, files in public/ are served from the CDN
 * and are not on the server function's disk, so checking for them at runtime would fail.
 */
export interface BrandLogos {
  mark: string | null;
  wordmarkLight: string | null;
}

const LOGOS: BrandLogos = {
  mark: "/brand/icicibank-com-logo.png",
  wordmarkLight: "/brand/icicibank-com-brandmark.png",
};

export function brandLogos(): BrandLogos {
  return LOGOS;
}
