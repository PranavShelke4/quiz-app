export const COMPANY_TEAMS = [
  "All",
  "Engineering",
  "Product",
  "Design",
  "Marketing",
  "Sales",
  "Human Resources",
  "Finance",
  "Operations",
  "Customer Support",
  "General",
] as const;

export type CompanyTeam = (typeof COMPANY_TEAMS)[number];
