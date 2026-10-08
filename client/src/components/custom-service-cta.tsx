import { Link } from "wouter";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openZaina } from "@/lib/zaina";

type CustomServiceCtaProps = {
  source?: string;
  compact?: boolean;
  className?: string;
};

// TBM doesn't do dead ends: when a list runs out, the guest can ask Zaina or
// send the team a request, and the team finds and checks it on the ground.
export function CustomServiceCta({ source, compact = false, className = "" }: CustomServiceCtaProps) {
  const href = source
    ? `/request-custom-service?source=${encodeURIComponent(source)}`
    : "/request-custom-service";

  return (
    <div className={`rounded-2xl border border-border/70 bg-muted/25 p-5 ${className}`.trim()}>
      <p className={`font-semibold ${compact ? "text-base" : "text-lg"}`}>Can&apos;t find exactly what you need?</p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        Tell us what you&apos;re after and your budget. If it isn&apos;t listed, our team finds it along the Coast and checks it before you pay.
      </p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        Our team replies within a few hours, Monday to Saturday, 8am to 8pm. Zaina answers any time.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          className="h-11 rounded-full px-5"
          onClick={() => openZaina("I can't find exactly what I need. Here's what I'm looking for: ")}
          data-testid={`button-ask-zaina-${source ?? "custom"}`}
        >
          <MessageCircle className="mr-2 h-4 w-4" />
          Ask Zaina
        </Button>
        <Button asChild variant="outline" className="h-11 rounded-full px-5">
          <Link href={href}>Send a request</Link>
        </Button>
      </div>
    </div>
  );
}
