"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/primitives";

/** Switches the `competitionId` query param for competition-scoped admin pages. */
export function CompetitionPicker({ options, value }: { options: { id: string; label: string }[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      Competition
      <Select
        value={value}
        className="min-w-64 text-foreground"
        onChange={(e) => {
          const sp = new URLSearchParams(params.toString());
          sp.set("competitionId", e.target.value);
          sp.delete("page");
          router.push(`${pathname}?${sp.toString()}`);
        }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </Select>
    </label>
  );
}
