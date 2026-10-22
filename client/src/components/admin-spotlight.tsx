// TBM's Spotlight for one provider: a tracked link to their live page, the
// message TBM posts with it, and a Status image. Built only from the page's
// public, allowlisted data. The provider is the hero; bookings stay theirs.
import { useState } from "react";
import { Copy, ImageDown, Loader2, MessageCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { saveFile } from "@/lib/card-canvas";
import type { ProviderPageSettingsView } from "@/lib/provider-page";
import { businessCardContent, cardFileName } from "@shared/business-card";
import { buildSpotlightShareUrl, buildWhatsAppShareHref, type ShareChannel } from "@shared/listing-share";
import type { PublicProviderProfile } from "@shared/provider-public";
import { buildSpotlightMessage, type SpotlightSubject } from "@shared/spotlight";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^\d+:\s*/, "").replace(/^\{"error":"(.*)"\}$/, "$1");

type Ready = { code: string; path: string; profile: PublicProviderProfile; subject: SpotlightSubject };

export function AdminSpotlight({ providerId, settings }: { providerId: string; settings: ProviderPageSettingsView }) {
  const { toast } = useToast();
  const [ready, setReady] = useState<Ready | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const origin = typeof window === "undefined" ? "https://tembeabilamatata.com" : window.location.origin;

  if (!settings.live) return null;
  if (!settings.spotlightAllowed) {
    return <p className="text-xs text-muted-foreground" data-testid="text-spotlight-declined">They've asked TBM not to feature their page in the Spotlight.</p>;
  }

  const prepare = async () => {
    setBusy("prepare");
    try {
      const link = await (await apiRequest("POST", `/api/admin/providers/${providerId}/spotlight-link`, {})).json() as { code: string; pageCode: string; path: string };
      const response = await fetch(`/api/public/providers/${link.pageCode}`, { credentials: "include" });
      const body = await response.json().catch(() => null) as { provider?: PublicProviderProfile } | null;
      if (!response.ok || !body?.provider) throw new Error("The page isn't live any more.");
      const profile = body.provider;
      setReady({
        code: link.code,
        path: link.path,
        profile,
        subject: {
          kind: "provider",
          name: profile.displayName,
          serviceTypes: profile.serviceTypes,
          serviceAreas: profile.serviceAreas,
          verified: profile.verified,
          rating: profile.rating,
          foundingProvider: profile.foundingProvider,
          about: profile.about,
        },
      });
    } catch (error) {
      toast({ title: "Couldn't prepare the Spotlight", description: errorText(error), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const urlFor = (channel: ShareChannel) => buildSpotlightShareUrl(origin, ready!.path, { channel, code: ready!.code });
  const recordShare = (channel: ShareChannel) => {
    void apiRequest("POST", `/api/admin/spotlight-links/${ready!.code}/shared`, { channel }).catch(() => undefined);
  };

  const shareWhatsApp = () => {
    recordShare("whatsapp");
    window.open(buildWhatsAppShareHref(buildSpotlightMessage(ready!.subject, urlFor("whatsapp"))), "_blank", "noopener,noreferrer");
  };
  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(buildSpotlightMessage(ready!.subject, urlFor("copy")));
      recordShare("copy");
      toast({ title: "Spotlight message copied", description: "Paste it into TBM's channels or newsletter." });
    } catch {
      toast({ title: "Couldn't copy", description: "Select the message and copy it instead.", variant: "destructive" });
    }
  };
  const saveImage = async () => {
    setBusy("image");
    try {
      const [{ renderStatusImage }, QRCode] = await Promise.all([import("@/lib/business-card-render"), import("qrcode")]);
      const code = QRCode.create(urlFor("qr"), { errorCorrectionLevel: "Q" });
      const pageLabel = `${origin.replace(/^https?:\/\//, "")}/p/${ready!.profile.code}`;
      const image = await renderStatusImage(businessCardContent(ready!.profile), { size: code.modules.size, data: Array.from(code.modules.data) }, pageLabel, { eyebrow: "TBM Spotlight" });
      saveFile(image, cardFileName(ready!.profile.displayName, "spotlight.png"));
      recordShare("qr");
      toast({ title: "Spotlight image saved", description: "1080 × 1920, for Status, Stories and posts." });
    } catch (error) {
      toast({ title: "Couldn't make the image", description: errorText(error), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-amber-200/80 bg-amber-50/60 p-3" data-testid={`admin-spotlight-${providerId}`}>
      <div className="flex items-center gap-1.5 font-medium text-amber-950"><Sparkles className="h-4 w-4 text-amber-600" aria-hidden="true" />TBM Spotlight</div>
      <p className="text-xs leading-5 text-stone-700">
        Feature this provider on TBM's channels. The link opens their page, with only their services; bookings from it are theirs and show in their Your shares. They're told when TBM features them.
      </p>
      {!ready ? (
        <Button type="button" size="sm" className="rounded-full" disabled={busy === "prepare"} onClick={() => void prepare()} data-testid={`button-spotlight-${providerId}`}>
          {busy === "prepare" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}Prepare a Spotlight
        </Button>
      ) : (
        <>
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-lg bg-white p-3 font-sans text-xs leading-5 text-stone-800" data-testid="text-spotlight-message">
            {buildSpotlightMessage(ready.subject, urlFor("copy"))}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" className="rounded-full bg-[#1f7a4d] text-white hover:bg-[#19663f]" onClick={shareWhatsApp} data-testid="button-spotlight-whatsapp">
              <MessageCircle className="mr-2 h-4 w-4" aria-hidden="true" />WhatsApp
            </Button>
            <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={() => void copyMessage()} data-testid="button-spotlight-copy">
              <Copy className="mr-2 h-4 w-4" aria-hidden="true" />Copy message
            </Button>
            <Button type="button" size="sm" variant="outline" className="rounded-full" disabled={busy === "image"} onClick={() => void saveImage()} data-testid="button-spotlight-image">
              {busy === "image" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImageDown className="mr-2 h-4 w-4" aria-hidden="true" />}Spotlight image
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
