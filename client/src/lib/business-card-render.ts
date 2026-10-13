// Drawing the provider's business card: the WhatsApp Status image
// (1080 × 1920), and the print card's front and back (85 × 55 mm with 3 mm
// bleed at 300 dpi) as a two-page PDF. No rating, no personal number: the QR
// code opens the provider's page, and TBM's official number is on the back.
import { loadImage, newCanvas, roundedRect, wrapText } from "@/lib/card-canvas";
import {
  CARD_HOW_TO_BOOK,
  CARD_PAY_SAFELY,
  PRINT_PIXELS,
  PRINT_POINTS,
  STATUS_PIXELS,
  type BusinessCardContent,
} from "@shared/business-card";
import { SUPPORT_PHONE_DISPLAY } from "@shared/support-contact";

const TEAL = "#0f3d3a";
const TEAL_LIGHT = "#134e4a";
const CREAM = "#fbf8f3";
const INK = "#1c1917";
const STONE = "#57534e";
const SERIF = "'Cormorant Garamond', Georgia, serif";
const SANS = "'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif";

async function fontsReady() {
  try {
    await Promise.all([`600 40px ${SERIF}`, `500 20px ${SANS}`, `600 20px ${SANS}`].map((font) => document.fonts.load(font)));
  } catch {
    // The fallback fonts are fine.
  }
}

// The photo or logo, or the first letter of the name on TBM teal when there's
// no approved photo (or it can't be drawn).
async function drawAvatar(context: CanvasRenderingContext2D, content: BusinessCardContent, x: number, y: number, size: number) {
  context.save();
  context.fillStyle = content.photoIsLogo ? "#ffffff" : TEAL;
  roundedRect(context, x, y, size, size, size * 0.22);
  context.clip();
  let drawn = false;
  if (content.photoUrl) {
    try {
      const image = await loadImage(content.photoUrl, !content.photoUrl.startsWith("/"));
      if (content.photoIsLogo) {
        const scale = Math.min((size * 0.84) / image.width, (size * 0.84) / image.height);
        const w = image.width * scale;
        const h = image.height * scale;
        context.drawImage(image, x + (size - w) / 2, y + (size - h) / 2, w, h);
      } else {
        const scale = Math.max(size / image.width, size / image.height);
        const w = image.width * scale;
        const h = image.height * scale;
        context.drawImage(image, x + (size - w) / 2, y + (size - h) / 2, w, h);
      }
      drawn = true;
    } catch {
      drawn = false;
    }
  }
  if (!drawn) {
    context.fillStyle = TEAL;
    context.fillRect(x, y, size, size);
    context.fillStyle = CREAM;
    context.font = `600 ${Math.round(size * 0.5)}px ${SERIF}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(Array.from(content.name.trim())[0]?.toUpperCase() ?? "T", x + size / 2, y + size / 2 + size * 0.03);
  }
  context.restore();
}

function drawVerified(context: CanvasRenderingContext2D, x: number, y: number, fontSize: number, align: "left" | "center" = "left") {
  const label = "Verified by TBM";
  context.font = `600 ${fontSize}px ${SANS}`;
  const textWidth = context.measureText(label).width;
  const padX = fontSize * 0.8;
  const tick = fontSize * 1.1;
  const width = textWidth + padX * 2 + tick;
  const height = fontSize * 2;
  const left = align === "center" ? x - width / 2 : x;
  context.fillStyle = "#ecfdf5";
  roundedRect(context, left, y, width, height, height / 2);
  context.strokeStyle = "#6ee7b7";
  context.lineWidth = Math.max(1.5, fontSize / 12);
  context.beginPath();
  if (typeof context.roundRect === "function") context.roundRect(left, y, width, height, height / 2);
  else context.rect(left, y, width, height);
  context.stroke();
  // A tick.
  context.strokeStyle = "#047857";
  context.lineWidth = Math.max(2, fontSize / 7);
  context.beginPath();
  const tx = left + padX;
  const ty = y + height / 2;
  context.moveTo(tx, ty);
  context.lineTo(tx + tick * 0.3, ty + tick * 0.3);
  context.lineTo(tx + tick * 0.8, ty - tick * 0.3);
  context.stroke();
  context.fillStyle = "#065f46";
  context.textAlign = "left";
  context.textBaseline = "middle";
  context.fillText(label, tx + tick, ty + 1);
}

function drawLines(context: CanvasRenderingContext2D, lines: string[], x: number, y: number, lineHeight: number) {
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
  return y + lines.length * lineHeight;
}

// ── WhatsApp Status image ────────────────────────────────────────────────────

export async function renderStatusImage(content: BusinessCardContent, qrDataUrl: string, pageLabel: string) {
  await fontsReady();
  const { width, height } = STATUS_PIXELS;
  const { canvas, context } = newCanvas(width, height);
  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, TEAL);
  gradient.addColorStop(1, TEAL_LIGHT);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.fillStyle = "#99f6e4";
  context.font = `600 30px ${SANS}`;
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.fillText("TEMBEA BILA MATATA", width / 2, 150);

  context.fillStyle = CREAM;
  roundedRect(context, 80, 210, width - 160, 1480, 56);

  await drawAvatar(context, content, width / 2 - 110, 290, 220);
  context.fillStyle = INK;
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.font = `600 76px ${SERIF}`;
  let y = drawLines(context, wrapText(context, content.name, width - 280).slice(0, 2), width / 2, 620, 82);
  context.fillStyle = STONE;
  context.font = `500 36px ${SANS}`;
  y = drawLines(context, wrapText(context, content.line, width - 300).slice(0, 2), width / 2, y + 10, 48);
  if (content.verified) {
    drawVerified(context, width / 2, y + 10, 30, "center");
    y += 90;
  }

  const qr = await loadImage(qrDataUrl);
  const qrSize = 560;
  const qrTop = Math.max(y + 40, 900);
  context.fillStyle = "#ffffff";
  roundedRect(context, (width - qrSize) / 2 - 28, qrTop - 28, qrSize + 56, qrSize + 56, 36);
  context.drawImage(qr, (width - qrSize) / 2, qrTop, qrSize, qrSize);
  context.fillStyle = TEAL;
  context.font = `600 44px ${SANS}`;
  context.textAlign = "center";
  context.fillText(content.callToAction, width / 2, qrTop + qrSize + 110);
  context.fillStyle = STONE;
  context.font = `500 30px ${SANS}`;
  context.fillText(pageLabel, width / 2, qrTop + qrSize + 160);

  context.fillStyle = "#ccfbf1";
  context.font = `500 28px ${SANS}`;
  drawLines(context, wrapText(context, content.coordinatedBy, width - 120), width / 2, 1800, 40);
  return canvas.toDataURL("image/png");
}

// ── Print card ───────────────────────────────────────────────────────────────

export async function renderPrintFront(content: BusinessCardContent, qrDataUrl: string) {
  await fontsReady();
  const { width, height, safe } = PRINT_PIXELS;
  const { canvas, context } = newCanvas(width, height);
  context.fillStyle = CREAM;
  context.fillRect(0, 0, width, height);
  // The QR panel runs off the right edge into the bleed.
  const panelLeft = 700;
  context.fillStyle = TEAL;
  context.fillRect(panelLeft, 0, width - panelLeft, height);

  const qr = await loadImage(qrDataUrl);
  const qrSize = 250;
  const panelCenter = panelLeft + (width - safe - panelLeft) / 2 + 4;
  const qrTop = 170;
  context.fillStyle = "#ffffff";
  roundedRect(context, panelCenter - qrSize / 2 - 14, qrTop - 14, qrSize + 28, qrSize + 28, 20);
  context.drawImage(qr, panelCenter - qrSize / 2, qrTop, qrSize, qrSize);
  context.fillStyle = CREAM;
  context.font = `600 23px ${SANS}`;
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  drawLines(context, wrapText(context, content.callToAction, width - panelLeft - safe - 20), panelCenter, qrTop + qrSize + 56, 30);

  const left = safe;
  await drawAvatar(context, content, left, safe, 116);
  context.textAlign = "left";
  context.fillStyle = INK;
  context.font = `600 50px ${SERIF}`;
  let y = drawLines(context, wrapText(context, content.name, panelLeft - left - 40).slice(0, 2), left, safe + 116 + 62, 52);
  context.fillStyle = STONE;
  context.font = `500 22px ${SANS}`;
  y = drawLines(context, wrapText(context, content.line, panelLeft - left - 40).slice(0, 2), left, y + 4, 30);
  if (content.verified) drawVerified(context, left, y + 6, 18);

  context.fillStyle = "#78716c";
  context.font = `500 16px ${SANS}`;
  context.textBaseline = "alphabetic";
  drawLines(context, wrapText(context, content.coordinatedBy, panelLeft - left - 40), left, height - safe - 6, 22);
  return canvas;
}

export async function renderPrintBack(pageLabel: string) {
  await fontsReady();
  const { width, height, safe } = PRINT_PIXELS;
  const { canvas, context } = newCanvas(width, height);
  context.fillStyle = TEAL;
  context.fillRect(0, 0, width, height);
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.fillStyle = CREAM;
  context.font = `600 64px ${SERIF}`;
  context.fillText("Tembea Bila Matata", width / 2, safe + 120);
  context.fillStyle = "#99f6e4";
  context.font = `600 18px ${SANS}`;
  context.fillText("TRAVEL WITHOUT WORRIES", width / 2, safe + 160);
  context.fillStyle = CREAM;
  context.font = `500 24px ${SANS}`;
  let y = drawLines(context, wrapText(context, CARD_HOW_TO_BOOK, width - 2 * safe - 80), width / 2, safe + 250, 32);
  context.fillStyle = "#ccfbf1";
  context.font = `500 20px ${SANS}`;
  y = drawLines(context, wrapText(context, CARD_PAY_SAFELY, width - 2 * safe - 120), width / 2, y + 12, 28);
  context.fillStyle = CREAM;
  context.font = `600 22px ${SANS}`;
  context.fillText(pageLabel, width / 2, height - safe - 46);
  context.font = `500 20px ${SANS}`;
  context.fillText(`TBM's official number: ${SUPPORT_PHONE_DISPLAY}`, width / 2, height - safe - 12);
  return canvas;
}

const canvasPng = (canvas: HTMLCanvasElement) => new Promise<Uint8Array>((resolve, reject) => {
  canvas.toBlob(async (blob) => {
    if (!blob) return reject(new Error("Couldn't draw the card"));
    resolve(new Uint8Array(await blob.arrayBuffer()));
  }, "image/png");
});

// Two pages, front and back, each 91 × 61 mm with the 85 × 55 mm trim marked
// as the TrimBox, so a printer cuts it to size. pdf-lib loads only here.
export async function buildPrintPdf(front: HTMLCanvasElement, back: HTMLCanvasElement, title: string) {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator("Tembea Bila Matata");
  for (const side of [front, back]) {
    const image = await pdf.embedPng(await canvasPng(side));
    const page = pdf.addPage([PRINT_POINTS.width, PRINT_POINTS.height]);
    page.drawImage(image, { x: 0, y: 0, width: PRINT_POINTS.width, height: PRINT_POINTS.height });
    page.setBleedBox(0, 0, PRINT_POINTS.width, PRINT_POINTS.height);
    page.setTrimBox(PRINT_POINTS.bleed, PRINT_POINTS.bleed, PRINT_POINTS.trimWidth, PRINT_POINTS.trimHeight);
  }
  return new Blob([await pdf.save()], { type: "application/pdf" });
}
