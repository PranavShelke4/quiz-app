/**
 * Tracks participants belong to (shown as "Track" in the UI; stored in the `team` field).
 * "All" is only used for filters and company-wide competitions.
 */
export const COMPANY_TEAMS = ["All", "UCJ", "Credit Card", "Auto Loan", "NRI & WGC", "Personal Loan", "3-in-1"] as const;

export type CompanyTeam = (typeof COMPANY_TEAMS)[number];

/** Selectable tracks (without "All"). */
export const TRACKS = COMPANY_TEAMS.filter((t) => t !== "All");

/** Track options for a select, keeping a user's current value even if it's no longer in the list. */
export function trackOptions(current?: string | null): string[] {
  return current && !TRACKS.includes(current as (typeof TRACKS)[number]) ? [...TRACKS, current] : [...TRACKS];
}
