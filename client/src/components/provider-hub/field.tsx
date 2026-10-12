// A labelled form field for Provider Hub editors: the label says what goes
// in, the hint says why or how.
import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function Field({ id, label, hint, children, className }: { id: string; label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
