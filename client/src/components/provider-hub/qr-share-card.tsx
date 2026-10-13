// A printable "scan to book" card for one listing: for the villa's door, the
// car's back seat or a chef's menu. Scans count in Your shares like any link.
import { useEffect, useState } from "react";
import { Download, Loader2, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { loadImage, newCanvas, roundedRect, wrapText } from "@/lib/card-canvas";
import { buildListingShareUrl } from "@shared/listing-share";
import type { PublicListingKind } from "@shared/seo";

const cardTagline: Record<PublicListingKind, string> = {
  stay: "Scan to see photos, prices and dates, and book your stay",
  car: "Scan to book this car with or without a driver",
  cook: "Scan to book a private chef",
  errand: "Scan to book help at home",
  experience: "Scan to see this experience and book",
};

async function composeCard(args: { qrDataUrl: string; name: string; tagline: string }) {
  const width = 1080;
  const height = 1350;
  const { canvas, context } = newCanvas(width, height);

  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#0f3d3a");
  gradient.addColorStop(1, "#134e4a");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.fillStyle = "#fbf8f3";
  roundedRect(context, 70, 70, width - 140, height - 140, 48);

  context.fillStyle = "#0f766e";
  context.font = "600 30px 'Plus Jakarta Sans', sans-serif";
  context.textAlign = "center";
  context.fillText("TEMBEA BILA MATATA", width / 2, 160);

  context.fillStyle = "#1c1917";
  context.font = "600 64px 'Cormorant Garamond', Georgia, serif";
  const nameLines = wrapText(context, args.name, width - 260).slice(0, 2);
  nameLines.forEach((line, index) => context.fillText(line, width / 2, 250 + index * 72));

  const qr = await loadImage(args.qrDataUrl);
  const qrSize = 600;
  const qrTop = 250 + nameLines.length * 72 + 30;
  context.fillStyle = "#ffffff";
  roundedRect(context, (width - qrSize) / 2 - 30, qrTop - 30, qrSize + 60, qrSize + 60, 36);
  context.drawImage(qr, (width - qrSize) / 2, qrTop, qrSize, qrSize);

  context.fillStyle = "#44403c";
  context.font = "500 34px 'Plus Jakarta Sans', sans-serif";
  wrapText(context, args.tagline, width - 300).slice(0, 2).forEach((line, index) => {
    context.fillText(line, width / 2, qrTop + qrSize + 100 + index * 44);
  });

  context.fillStyle = "#78716c";
  context.font = "400 26px 'Plus Jakarta Sans', sans-serif";
  context.fillText("Secure payment and support from TBM", width / 2, height - 120);

  return canvas.toDataURL("image/png");
}

export function QrShareCard({ kind, id, name, isPublic, triggerClassName }: { kind: PublicListingKind; id: string; name: string; isPublic: boolean; triggerClassName?: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !isPublic || qrDataUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await apiRequest("POST", "/api/provider/share-links", { kind, listingId: id });
        const { code: shareCode } = await response.json() as { code: string };
        const url = buildListingShareUrl(window.location.origin, { kind, id, name }, { source: "provider", channel: "qr", code: shareCode });
        const QRCode = await import("qrcode");
        const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 720, errorCorrectionLevel: "M", color: { dark: "#0f3d3a", light: "#ffffff" } });
        if (!cancelled) {
          setCode(shareCode);
          setQrDataUrl(dataUrl);
        }
      } catch {
        if (!cancelled) toast({ title: "Couldn't make the QR code", description: "Please try again.", variant: "destructive" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, isPublic, qrDataUrl, kind, id, name, toast]);

  const download = async () => {
    if (!qrDataUrl) return;
    setBusy(true);
    try {
      const png = await composeCard({ qrDataUrl, name, tagline: cardTagline[kind] });
      const link = document.createElement("a");
      link.href = png;
      link.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "listing"}-tbm-qr.png`;
      link.click();
      if (code) void apiRequest("POST", `/api/provider/share-links/${code}/shared`, { channel: "qr" }).catch(() => undefined);
      toast({ title: "Card saved", description: "Print it, or post it on your WhatsApp status." });
    } catch (error) {
      toast({ title: "Couldn't save the card", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={cn("rounded-full", triggerClassName)} disabled={!isPublic} data-testid={`button-qr-${kind}-${id}`}>
          <QrCode className="mr-1.5 h-3.5 w-3.5" />
          QR card
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Scan-to-book card</DialogTitle>
          <DialogDescription>
            Put it where guests already are: at the door, in the car, on your menu. Scans and bookings show in Your shares.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-[1.75rem] bg-gradient-to-b from-[#0f3d3a] to-[#134e4a] p-4">
          <div className="space-y-3 rounded-[1.4rem] bg-[#fbf8f3] px-5 py-6 text-center">
            <div className="text-[0.7rem] font-semibold tracking-[0.24em] text-teal-700">TEMBEA BILA MATATA</div>
            <div className="font-serif text-2xl font-semibold leading-tight text-stone-900">{name}</div>
            <div className="mx-auto flex aspect-square w-full max-w-[15rem] items-center justify-center rounded-2xl bg-white p-3">
              {qrDataUrl ? <img src={qrDataUrl} alt={`QR code for ${name}`} className="h-full w-full" data-testid="img-share-qr" /> : <Loader2 className="h-6 w-6 animate-spin text-stone-400" />}
            </div>
            <div className="text-sm text-stone-600">{cardTagline[kind]}</div>
          </div>
        </div>
        <Button type="button" className="w-full rounded-full" disabled={!qrDataUrl || busy} onClick={download} data-testid="button-download-qr">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
          Save card as image
        </Button>
      </DialogContent>
    </Dialog>
  );
}
