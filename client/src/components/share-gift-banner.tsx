import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gift } from "lucide-react";
import { useCurrency } from "@/lib/currency";
import { getMarketingAttributionPayload } from "@/lib/marketing-attribution";
import { shareOfferTerms, shareOfferValue, type ShareOffer } from "@shared/share-offer";

// A friend arrived through a guest's share link: say so, and that the gift
// applies at checkout (the code is already kept for them, so there's nothing to type).
export function ShareGiftBanner({ className }: { className?: string }) {
  const { formatAmount } = useCurrency();
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    const fromLink = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("promoCode");
    setCode((fromLink || getMarketingAttributionPayload().promoCode || "").trim().toUpperCase() || null);
  }, []);
  const { data: offer } = useQuery<ShareOffer | null>({
    queryKey: ["/api/marketing/share-offer"],
    enabled: Boolean(code),
    staleTime: 120_000,
  });
  if (!code || !offer || offer.code !== code) return null;
  const value = shareOfferValue(offer, formatAmount);
  const terms = shareOfferTerms(offer, formatAmount);
  return (
    <div className={`flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 ${className ?? ""}`} data-testid="share-gift-banner">
      <Gift className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
      <div>
        <div className="font-semibold">A friend's link: {value} off your booking</div>
        <div className="text-amber-900/80">It's applied at checkout{terms ? `, ${terms}` : ""}. Nothing to type.</div>
      </div>
    </div>
  );
}
