import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/primitives";

/**
 * Server-rendered GET filter form: filters live in the URL, so tables are
 * paginated/sorted/filtered on the server with zero client state.
 */
export function FilterBar({ action, children, resetHref }: { action: string; children: ReactNode; resetHref?: string }) {
  return (
    <form action={action} method="get" className="flex flex-wrap items-end gap-2" role="search">
      {children}
      <Button type="submit" variant="secondary" size="md">
        Apply
      </Button>
      {resetHref && (
        <ButtonLink href={resetHref} variant="ghost">
          Reset
        </ButtonLink>
      )}
    </form>
  );
}

export function SearchInput({ name = "search", defaultValue, placeholder }: { name?: string; defaultValue?: string; placeholder: string }) {
  return (
    <div className="relative min-w-52 flex-1 sm:max-w-xs">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input type="search" name={name} defaultValue={defaultValue} placeholder={placeholder} aria-label={placeholder} className="pl-9" />
    </div>
  );
}

export function FilterSelect({
  name,
  label,
  value,
  options,
}: {
  name: string;
  label: string;
  value?: string;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Select name={name} defaultValue={value ?? ""} className="h-10 min-w-36 text-foreground">
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </label>
  );
}

export function FilterDate({ name, label, value }: { name: string; label: string; value?: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      <Input type="date" name={name} defaultValue={value} className="h-10 text-foreground" />
    </label>
  );
}

export function sp(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}
