import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, ExternalLink, Gift, MessageCircle, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import {
  buildListingShareMessage,
  buildListingShareUrl,
  buildProviderPageShareMessage,
  buildProviderPageShareUrl,
  buildWhatsAppShareHref,
  formatSharePriceLine,
  type ShareSource,
} from "@shared/listing-share";
import { getPublicListingPath, type PublicListingKind } from "@shared/seo";
import { shareOfferMessageLine, shareOfferTerms, shareOfferValue, withPromoCode, type ShareOffer } from "@shared/share-offer";

type ListingShareSheetProps = {
  // "provider": the provider's own public page (pagePath), not one listing.
  kind: PublicListingKind | "provider";
  id: string;
  name: string;
  pagePath?: string;
  /** For a provider page: "Stays · Car hire". */
  services?: string;
  /** For a provider page: where they work. */
  areas?: string[];
  description?: string | null;
  /** The current public price in US dollars, offered as an optional line. */
  priceUsd?: number | null;
  /** How the price is counted, e.g. "a night" or "a person". */
  priceUnit?: string;
  isPublic: boolean;
  source: ShareSource;
  triggerLabel?: string;
  triggerClassName?: string;
  size?: "sm" | "default";
};

// Share a listing by WhatsApp, a copied link or the phone's share menu. The link
// is the public listing page; the message can be edited before it is sent.
export function ListingShareSheet({
  kind,
  id,
  name,
  pagePath,
  services,
  areas,
  description,
  priceUsd,
  priceUnit = "",
  isPublic,
  source,
  triggerLabel = "Share",
  triggerClassName,
  size = "sm",
}: ListingShareSheetProps) {
  const { toast } = useToast();
  const { usdToKes, formatAmount } = useCurrency();
  const [open, setOpen] = useState(false);
  const [includePrice, setIncludePrice] = useState(false);
  const [message, setMessage] = useState("");
  const linkInputRef = useRef<HTMLInputElement | null>(null);
  const whatsappRef = useRef<HTMLAnchorElement | null>(null);
  const canShareNatively = typeof navigator !== "undefined" && typeof navigator.share === "function";

  // Phase 3: the listing's own provider gets a random share code, so visits and
  // bookings from this share show in Your shares. Anyone else shares the plain link.
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const wantsCode = source === "provider" && isPublic;
  useEffect(() => {
    if (!open || !wantsCode || shareCode) {
      return;
    }
    let cancelled = false;
    setCodeLoading(true);
    apiRequest("POST", "/api/provider/share-links", { kind, listingId: id })
      .then((response) => response.json() as Promise<{ code: string }>)
      .then((data) => {
        if (!cancelled) setShareCode(data.code);
      })
      .catch(() => {
        // Not this provider's listing, or offline: share the plain link.
      })
      .finally(() => {
        if (!cancelled) setCodeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, wantsCode, shareCode, kind, id]);

  // A guest sharing a listing can give the friend TBM's current gift, if TBM has one.
  const isGuestShare = source === "visitor" && kind !== "provider" && isPublic;
  const { data: offer } = useQuery<ShareOffer | null>({
    queryKey: ["/api/marketing/share-offer"],
    enabled: isGuestShare,
    staleTime: 120_000,
  });
  const giftOffer = isGuestShare ? offer ?? null : null;
  const giftValue = giftOffer ? shareOfferValue(giftOffer, formatAmount) : null;
  const giftTerms = giftOffer ? shareOfferTerms(giftOffer, formatAmount) : "";

  const markShared = (channel: "whatsapp" | "copy" | "native") => {
    if (shareCode) {
      void apiRequest("POST", `/api/provider/share-links/${shareCode}/shared`, { channel }).catch(() => undefined);
    }
  };

  const origin = typeof window === "undefined" ? "https://tembeabilamatata.com" : window.location.origin;
  const previewPath = kind === "provider" ? pagePath ?? "/" : getPublicListingPath(kind, id, name);
  const links = useMemo(() => {
    const build = (channel: "whatsapp" | "copy" | "native") => {
      const url = kind === "provider"
        ? buildProviderPageShareUrl(origin, pagePath ?? "/", { channel, code: shareCode })
        : buildListingShareUrl(origin, { kind, id, name }, { source, channel, code: shareCode });
      return giftOffer ? withPromoCode(url, giftOffer.code) : url;
    };
    return { whatsapp: build("whatsapp"), copy: build("copy"), native: build("native") };
  }, [origin, kind, id, name, pagePath, source, shareCode, giftOffer]);
  const priceLine = includePrice && priceUsd && priceUsd > 0 ? formatSharePriceLine(priceUsd * usdToKes, priceUnit) : null;

  // A fresh message each time the sheet opens or the price choice changes.
  useEffect(() => {
    if (open) {
      setMessage(kind === "provider"
        ? buildProviderPageShareMessage({ name, services, areas, about: description, url: links.whatsapp })
        : buildListingShareMessage({ kind, name, description, url: links.whatsapp, priceLine, offerLine: giftValue ? shareOfferMessageLine(giftValue) : null }));
    }
  }, [open, kind, name, services, areas, description, links.whatsapp, priceLine, giftValue]);

  const copyLink = async () => {
    markShared("copy");
    try {
      await navigator.clipboard.writeText(links.copy);
      toast({ title: "Link copied", description: "Paste it anywhere to share this listing." });
    } catch {
      linkInputRef.current?.focus();
      linkInputRef.current?.select();
      toast({ title: "Copy the link from the box", description: "Your browser didn't allow copying automatically." });
    }
  };

  const shareNatively = async () => {
    try {
      await navigator.share({
        title: name,
        text: message.replace(links.whatsapp, links.native),
      });
      markShared("native");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        await copyLink();
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={size}
          className={cn("rounded-full", triggerClassName)}
          data-testid={`button-share-${kind}-${id}`}
        >
          <Share2 className="mr-1.5 h-3.5 w-3.5" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
        // Start on the WhatsApp button, not the message box, so phones don't open the keyboard.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          whatsappRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Share {name}</DialogTitle>
          <DialogDescription>
            {isPublic
              ? "Send the public page on Tembea Bila Matata. Guests book through TBM, and dates are confirmed when they book."
              : kind === "provider"
                ? "Your page isn't live yet. Share links start working once it is."
                : "This listing isn't public yet. Share links start working once TBM publishes it."}
          </DialogDescription>
        </DialogHeader>

        {isPublic ? (
          <div className="space-y-4">
            {giftValue ? (
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" data-testid="share-gift">
                <Gift className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
                <div>
                  <div className="font-semibold">Give your friends {giftValue} off</div>
                  <div className="text-amber-900/80">
                    Anyone who books through your link gets {giftValue} off, TBM's welcome gift to them{giftTerms ? ` (${giftTerms})` : ""}.
                  </div>
                </div>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor={`share-message-${id}`}>Message</Label>
              <Textarea
                id={`share-message-${id}`}
                rows={7}
                value={message}
                disabled={codeLoading}
                onChange={(event) => setMessage(event.target.value)}
              />
              {priceUsd && priceUsd > 0 ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                  <Label htmlFor={`share-price-${id}`} className="text-sm font-normal">
                    Include today's price
                    <span className="block text-xs text-muted-foreground">Marked as subject to availability and TBM's terms.</span>
                  </Label>
                  <Switch id={`share-price-${id}`} checked={includePrice} onCheckedChange={setIncludePrice} />
                </div>
              ) : null}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Button asChild className="bg-[#1f7a4d] text-white hover:bg-[#19663f] sm:col-span-2">
                <a
                  ref={whatsappRef}
                  href={buildWhatsAppShareHref(message)}
                  target="_blank"
                  rel="noreferrer"
                  data-testid={`link-share-whatsapp-${id}`}
                  aria-disabled={codeLoading || undefined}
                  className={codeLoading ? "pointer-events-none opacity-60" : undefined}
                  onClick={() => markShared("whatsapp")}
                >
                  <MessageCircle className="mr-2 h-4 w-4" />
                  Share on WhatsApp
                </a>
              </Button>
              <Button type="button" variant="outline" onClick={copyLink} disabled={codeLoading} data-testid={`button-copy-link-${id}`}>
                <Copy className="mr-2 h-4 w-4" />
                Copy link
              </Button>
              {canShareNatively ? (
                <Button type="button" variant="outline" onClick={shareNatively} disabled={codeLoading}>
                  <Share2 className="mr-2 h-4 w-4" />
                  More options
                </Button>
              ) : (
                <Button asChild variant="outline">
                  <a href={previewPath} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Preview page
                  </a>
                </Button>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`share-link-${id}`} className="text-xs text-muted-foreground">Link</Label>
              <Input id={`share-link-${id}`} ref={linkInputRef} readOnly value={links.copy} onFocus={(event) => event.currentTarget.select()} onCopy={() => markShared("copy")} />
              {shareCode ? (
                <p className="text-xs text-muted-foreground">Visits and bookings from this link show in Share &amp; grow, in your Provider Hub.</p>
              ) : null}
            </div>

            {canShareNatively ? (
              <a
                href={previewPath}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Preview the page guests will see
              </a>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
