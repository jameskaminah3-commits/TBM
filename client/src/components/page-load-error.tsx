import { RefreshCw } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

/**
 * A page whose data couldn't be loaded (no connection, a server error), as
 * opposed to a page that doesn't exist. It deliberately sets no robots or
 * canonical tags: the page itself is fine, so the ones the server sent stay,
 * and a search engine that couldn't load the data isn't told the page is gone.
 */
export function PageLoadError({ onRetry, browseHref = "/", browseLabel = "Go to the home page" }: {
  onRetry: () => void;
  browseHref?: string;
  browseLabel?: string;
}) {
  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6" data-testid="page-load-error">
        <h1 className="font-serif text-3xl font-medium">We couldn't load this page</h1>
        <p className="mt-3 text-muted-foreground">Check your connection and try again.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          <Button className="rounded-full" onClick={onRetry} data-testid="button-retry-page">
            <RefreshCw className="mr-2 h-4 w-4" />
            Try again
          </Button>
          <Button asChild variant="outline" className="rounded-full"><Link href={browseHref}>{browseLabel}</Link></Button>
        </div>
      </div>
    </div>
  );
}
