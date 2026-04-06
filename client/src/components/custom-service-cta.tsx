import { Link } from "wouter";
import { Button } from "@/components/ui/button";

type CustomServiceCtaProps = {
  source?: string;
  compact?: boolean;
  className?: string;
};

export function CustomServiceCta({ source, compact = false, className = "" }: CustomServiceCtaProps) {
  const href = source
    ? `/request-custom-service?source=${encodeURIComponent(source)}`
    : "/request-custom-service";

  return (
    <div className={`rounded-2xl border border-border/70 bg-muted/25 p-5 ${className}`.trim()}>
      <p className={`font-semibold ${compact ? "text-base" : "text-lg"}`}>Can&apos;t find exactly what you need?</p>
      <p className="mt-1 text-sm text-muted-foreground">
        We specialize in making your Coast trip perfect.
      </p>
      <Button asChild variant="outline" className="mt-4 rounded-full px-5">
        <Link href={href}>Request a Custom Service</Link>
      </Button>
    </div>
  );
}
