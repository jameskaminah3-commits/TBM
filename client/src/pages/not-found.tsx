import { Link } from "wouter";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SeoHead } from "@/components/seo-head";
import { openZaina } from "@/lib/zaina";

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-16">
      <SeoHead title="Page not found | Tembea Bila Matata" robots="noindex,follow" />
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">Page not found</p>
        <h1 className="mt-3 font-serif text-3xl font-medium leading-tight sm:text-4xl">This page isn&apos;t here</h1>
        <p className="mt-4 text-muted-foreground">
          The link may be old, or the listing may have come off the site. Tell us what you were looking for and we&apos;ll help you find it.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="h-12 rounded-full text-base" data-testid="button-home">
            <Link href="/">Go to the home page</Link>
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="h-12 rounded-full text-base"
            onClick={() => openZaina("I was looking for something on the site and couldn't find it: ")}
          >
            <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />
            Ask Zaina
          </Button>
        </div>
      </div>
    </div>
  );
}
