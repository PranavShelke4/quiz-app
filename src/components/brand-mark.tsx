import { Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BrandLogoSources {
  mark: string | null;
  wordmarkLight: string | null;
}

/**
 * Brand lockup. Light backgrounds: the "i" mark + app name, with "ICICI Bank" underneath.
 * Navy backgrounds (tone="inverse"): the white "ICICI Bank" wordmark + app name.
 * Presentational only; the server resolves the logo files with brandLogos().
 */
export function BrandMark({
  logos,
  appName = "Daily Quiz",
  tone = "default",
  className,
}: {
  logos: BrandLogoSources;
  appName?: string;
  /** "inverse" for navy backgrounds. */
  tone?: "default" | "inverse";
  className?: string;
}) {
  // Plain <img>: tiny logos that must not be re-encoded or cropped.
  /* eslint-disable @next/next/no-img-element */
  if (tone === "inverse" && logos.wordmarkLight) {
    return (
      <span className={cn("flex items-center gap-3", className)}>
        <img src={logos.wordmarkLight} alt="ICICI Bank" width={512} height={98} className="h-7 w-auto sm:h-8" />
        <span className="border-l border-white/30 pl-3 font-semibold tracking-tight text-white">{appName}</span>
      </span>
    );
  }
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      {logos.mark ? (
        <img src={logos.mark} alt="" width={256} height={256} className={cn("size-9 shrink-0", tone === "inverse" && "rounded-lg bg-white p-0.5")} />
      ) : (
        <span
          className={cn("flex size-9 items-center justify-center rounded-lg", tone === "inverse" ? "bg-white text-primary" : "bg-primary text-primary-foreground")}
          aria-hidden
        >
          <Trophy className="size-4" />
        </span>
      )}
      <span className="flex flex-col leading-tight">
        <span className={cn("font-semibold tracking-tight", tone === "inverse" ? "text-white" : "text-brand-navy")}>{appName}</span>
        {logos.mark && <span className={cn("text-[11px] font-medium", tone === "inverse" ? "text-white/70" : "text-muted-foreground")}>ICICI Bank</span>}
      </span>
    </span>
  );
  /* eslint-enable @next/next/no-img-element */
}
