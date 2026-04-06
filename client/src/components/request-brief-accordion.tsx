import { useState, type ReactNode } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

type RequestBriefAccordionProps = {
  id: string;
  title: string;
  content: string;
  summary?: ReactNode;
  accent?: "amber" | "sky" | "stone";
  className?: string;
};

const accentStyles: Record<NonNullable<RequestBriefAccordionProps["accent"]>, { shell: string; label: string; summary: string }> = {
  amber: {
    shell: "border-amber-200/70 bg-amber-50/40",
    label: "text-amber-800",
    summary: "text-amber-700",
  },
  sky: {
    shell: "border-sky-200/70 bg-sky-50/40",
    label: "text-sky-800",
    summary: "text-sky-700",
  },
  stone: {
    shell: "border-stone-200/80 bg-stone-50/70",
    label: "text-stone-800",
    summary: "text-stone-600",
  },
};

export function RequestBriefAccordion({
  id,
  title,
  content,
  summary,
  accent = "stone",
  className,
}: RequestBriefAccordionProps) {
  const styles = accentStyles[accent];
  const [value, setValue] = useState<string>("");
  const isOpen = value === id;

  return (
    <div className={cn("rounded-xl border p-4", styles.shell, className)}>
      <Accordion type="single" collapsible className="w-full" value={value} onValueChange={setValue}>
        <AccordionItem value={id} className="border-none">
          <AccordionTrigger className="py-0 text-left hover:no-underline">
            <div className="space-y-2 pr-4">
              <div className={cn("text-[0.68rem] font-semibold uppercase tracking-[0.2em]", styles.label)}>{title}</div>
              {summary ? <div className={cn("text-xs font-medium", styles.summary)}>{summary}</div> : null}
              <div className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {isOpen ? "Hide Brief" : "Show Brief"}
              </div>
            </div>
          </AccordionTrigger>
          <AccordionContent className="pt-3">
            <div className="whitespace-pre-wrap text-sm leading-6 text-stone-700">{content}</div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
