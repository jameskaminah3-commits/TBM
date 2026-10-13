// The provider's smart business card, offered only while their page is live:
// a WhatsApp Status image, a print-ready PDF (85 × 55 mm with bleed) and a
// contact file with TBM's number. The digital card is the page link itself.
// The QR code is a tracked page link (channel "qr"), so scans show in Your
// shares like any other share. No rating and no personal number on any of it.
import { useEffect, useState } from "react";
import { Contact, Download, FileText, IdCard, Loader2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { saveFile } from "@/lib/card-canvas";
import { buildPrintPdf, renderPrintBack, renderPrintFront, renderStatusImage, type QrMatrix } from "@/lib/business-card-render";
import { cn } from "@/lib/utils";
import type { ProviderPageSettingsView } from "@/lib/provider-page";
import { buildProviderVCard, businessCardContent, cardFileName, type BusinessCardContent } from "@shared/business-card";
import { buildProviderPageShareUrl } from "@shared/listing-share";
import type { PublicProviderProfile } from "@shared/provider-public";

type Ready = { content: BusinessCardContent; qrUrl: string; qr: QrMatrix; shareCode: string; front: string; back: string };

export function BusinessCard({ settings }: { settings: ProviderPageSettingsView }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState<Ready | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [side, setSide] = useState<"front" | "back">("front");
  const origin = typeof window === "undefined" ? "https://tembeabilamatata.com" : window.location.origin;
  const shortPath = `/p/${settings.code}`;
  const pageLabel = `${origin.replace(/^https?:\/\//, "")}${shortPath}`;

  useEffect(() => {
    if (!open || ready || !settings.live) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await (await fetch(`/api/public/providers/${settings.code}`, { credentials: "include" })).json() as { provider: PublicProviderProfile };
        const content = businessCardContent(page.provider);
        const { code: shareCode } = await (await apiRequest("POST", "/api/provider/share-links", { kind: "provider" })).json() as { code: string };
        const qrUrl = buildProviderPageShareUrl(origin, shortPath, { channel: "qr", code: shareCode });
        const QRCode = await import("qrcode");
        // Error correction Q (25%) leaves room for the rounded dots and eyes.
        const code = QRCode.create(qrUrl, { errorCorrectionLevel: "Q" });
        const qr: QrMatrix = { size: code.modules.size, data: Array.from(code.modules.data) };
        const [frontCanvas, backCanvas] = await Promise.all([renderPrintFront(content, qr), renderPrintBack(pageLabel)]);
        if (!cancelled) setReady({ content, qrUrl, qr, shareCode, front: frontCanvas.toDataURL("image/png"), back: backCanvas.toDataURL("image/png") });
      } catch {
        if (!cancelled) toast({ title: "Couldn't make your card", description: "Please try again.", variant: "destructive" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, ready, settings.live, settings.code, origin, shortPath, pageLabel, toast]);

  const markShared = () => {
    if (ready) void apiRequest("POST", `/api/provider/share-links/${ready.shareCode}/shared`, { channel: "qr" }).catch(() => undefined);
  };
  const run = async (key: string, task: () => Promise<void>, done: string) => {
    setBusy(key);
    try {
      await task();
      markShared();
      toast({ title: done });
    } catch (error) {
      toast({ title: "Couldn't save it", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const saveStatus = () => run("status", async () => {
    saveFile(await renderStatusImage(ready!.content, ready!.qr, pageLabel), cardFileName(ready!.content.name, "status.png"));
  }, "Status image saved: post it on your WhatsApp Status");
  const savePdf = () => run("pdf", async () => {
    const [front, back] = await Promise.all([renderPrintFront(ready!.content, ready!.qr), renderPrintBack(pageLabel)]);
    saveFile(await buildPrintPdf(front, back, `${ready!.content.name} business card`), cardFileName(ready!.content.name, "card.pdf"));
  }, "Print file saved: 85 × 55 mm, with 3 mm bleed");
  const saveContact = () => run("vcf", async () => {
    saveFile(new Blob([buildProviderVCard({ name: ready!.content.name, pageUrl: `${origin}${shortPath}` })], { type: "text/vcard" }), cardFileName(ready!.content.name, "contact.vcf"));
  }, "Contact file saved");

  if (!settings.live) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="rounded-full" data-testid="button-business-card">
          <IdCard className="mr-2 h-4 w-4" aria-hidden="true" />Business card
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Your business card</DialogTitle>
          <DialogDescription>
            The QR code opens your page on TBM. It carries no phone number or rating: guests book and pay through TBM, and scans show in Your shares.
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-xl border border-stone-200 bg-stone-900 shadow-[0_18px_40px_-24px_rgba(10,42,40,0.6)]">
          {ready ? (
            <>
              <img src={ready.front} alt="Front of your business card" className={cn("w-full", side !== "front" && "hidden")} data-testid="img-card-preview" data-qr-url={ready.qrUrl} />
              <img src={ready.back} alt="Back of your business card" className={cn("w-full", side !== "back" && "hidden")} data-testid="img-card-preview-back" />
            </>
          ) : (
            <div className="flex aspect-[91/61] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-stone-400" /></div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex rounded-full bg-stone-100 p-1 text-sm" role="tablist" aria-label="Card side">
            {(["front", "back"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={side === value}
                onClick={() => setSide(value)}
                className={cn("min-h-9 rounded-full px-4 capitalize", side === value ? "bg-white font-medium text-stone-900 shadow-sm" : "text-stone-600")}
                data-testid={`button-card-side-${value}`}
              >
                {value}
              </button>
            ))}
          </div>
          <p className="text-right text-xs text-muted-foreground">Shown with its 3 mm bleed</p>
        </div>
        <div className="grid gap-2">
          <Button type="button" className="justify-start rounded-full" disabled={!ready || Boolean(busy)} onClick={saveStatus} data-testid="button-card-status">
            {busy === "status" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Smartphone className="mr-2 h-4 w-4" />}WhatsApp Status image (1080 × 1920)
          </Button>
          <Button type="button" variant="outline" className="justify-start rounded-full" disabled={!ready || Boolean(busy)} onClick={savePdf} data-testid="button-card-pdf">
            {busy === "pdf" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4" />}Print file, front and back (PDF, 85 × 55 mm)
          </Button>
          <Button type="button" variant="outline" className="justify-start rounded-full" disabled={!ready || Boolean(busy)} onClick={saveContact} data-testid="button-card-vcf">
            {busy === "vcf" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Contact className="mr-2 h-4 w-4" />}Contact file (TBM's number and your page)
          </Button>
        </div>
        <div className="rounded-xl bg-stone-50 p-3 text-sm">
          <div className="flex items-center gap-1.5 font-medium"><Download className="h-4 w-4" aria-hidden="true" />Digital card</div>
          <p className="mt-1 text-stone-600">Your page link is your digital card: it shows your photo, name and services when shared. Use "Share your page".</p>
          <p className="mt-1 break-all text-stone-500" data-testid="text-card-link">{pageLabel}</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
