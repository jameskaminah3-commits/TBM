// Small pieces every Provider Hub page shares: the page heading, the panel
// card, the verification badge and the icon for each kind of service.
import type { ReactNode } from "react";
import { BadgeCheck, BedDouble, Car, ChefHat, Clock3, HandHelping, Sailboat, ShieldAlert } from "lucide-react";
import type { ProviderCategory } from "@shared/schema";
import { cn } from "@/lib/utils";

export const workspaceIcons: Record<ProviderCategory, typeof Car> = {
  stays: BedDouble,
  cars: Car,
  cooks: ChefHat,
  errands: HandHelping,
  experiences: Sailboat,
};

// A soft colour per service, so a multi-service provider can tell them apart at a glance.
export const workspaceTones: Record<ProviderCategory, string> = {
  stays: "bg-teal-50 text-teal-800 ring-teal-200",
  cars: "bg-sky-50 text-sky-800 ring-sky-200",
  cooks: "bg-amber-50 text-amber-800 ring-amber-200",
  errands: "bg-rose-50 text-rose-800 ring-rose-200",
  experiences: "bg-indigo-50 text-indigo-800 ring-indigo-200",
};

export function WorkspaceIcon({ workspace, className }: { workspace: ProviderCategory; className?: string }) {
  const Icon = workspaceIcons[workspace];
  return (
    <span className={cn("inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ring-1", workspaceTones[workspace], className)}>
      <Icon className="h-5 w-5" aria-hidden="true" />
    </span>
  );
}

export function HubPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? <div className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-700">{eyebrow}</div> : null}
        <h1 className="font-serif text-[1.85rem] font-semibold leading-tight tracking-tight text-stone-950 sm:text-4xl">{title}</h1>
        {description ? <p className="max-w-2xl text-sm leading-6 text-stone-600 sm:text-[0.95rem]">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function HubPanel({
  title,
  description,
  action,
  children,
  className,
  id,
  tone = "default",
}: {
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  tone?: "default" | "accent" | "quiet";
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-24 rounded-[1.75rem] border p-4 sm:p-6",
        tone === "accent" && "border-teal-200/80 bg-gradient-to-br from-teal-50/90 via-white to-amber-50/60 shadow-[0_28px_70px_-48px_rgba(15,118,110,0.55)]",
        tone === "default" && "border-stone-200/80 bg-white/90 shadow-[0_24px_60px_-46px_rgba(92,73,47,0.45)]",
        tone === "quiet" && "border-stone-200/70 bg-stone-50/70",
        className,
      )}
    >
      {title || action ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            {title ? <h2 className="text-lg font-semibold tracking-tight text-stone-950">{title}</h2> : null}
            {description ? <p className="text-sm leading-6 text-stone-600">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export type VerificationState = "not-started" | "in-review" | "verified";

export function VerificationBadge({ status, className }: { status: VerificationState | undefined; className?: string }) {
  if (status === "verified") {
    return (
      <span className={cn("inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[0.7rem] font-semibold text-emerald-800 ring-1 ring-emerald-200", className)}>
        <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
        Verified by TBM
      </span>
    );
  }
  if (status === "in-review") {
    return (
      <span className={cn("inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[0.7rem] font-semibold text-amber-800 ring-1 ring-amber-200", className)}>
        <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
        Verification in review
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full bg-stone-100 px-2 py-0.5 text-[0.7rem] font-semibold text-stone-700 ring-1 ring-stone-200", className)}>
      <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
      Not verified yet
    </span>
  );
}

export function initialsOf(...parts: Array<string | null | undefined>) {
  const words = parts.filter(Boolean).join(" ").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("") || "TBM";
}

export function HubAvatar({ photoUrl, name, className }: { photoUrl?: string | null; name: string; className?: string }) {
  return photoUrl ? (
    <img src={photoUrl} alt="" className={cn("h-10 w-10 shrink-0 rounded-2xl object-cover ring-1 ring-stone-200", className)} />
  ) : (
    <span className={cn("inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-700 to-teal-900 text-sm font-semibold text-white", className)}>
      {initialsOf(name)}
    </span>
  );
}

export function CountBadge({ count, tone = "amber", className }: { count: number; tone?: "amber" | "teal" | "stone"; className?: string }) {
  if (!count) return null;
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
        tone === "amber" && "bg-amber-500 text-white",
        tone === "teal" && "bg-teal-700 text-white",
        tone === "stone" && "bg-stone-200 text-stone-700",
        className,
      )}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
