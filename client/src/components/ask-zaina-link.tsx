import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { openZaina } from "@/lib/zaina";

// Checkout keeps Zaina's floating button out of the way on phones, so the
// booking summary carries its own way to ask her.
export function AskZainaLink({ listingName, className }: { listingName: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => openZaina(`I'm booking ${listingName} and have a question: `)}
      className={cn("inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline", className)}
      data-testid="button-ask-zaina-checkout"
    >
      <MessageCircle className="h-4 w-4" />
      Questions about this booking? Ask Zaina
    </button>
  );
}
