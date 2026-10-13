// Drawing the provider's business card: the WhatsApp Status image
// (1080 × 1920), and the print card's front and back (85 × 55 mm with 3 mm
// bleed at 300 dpi) as a two-page PDF. No rating, no personal number: the QR
// code opens the provider's page, and TBM's official number is on the back.
//
// The look: deep ink-teal and ivory with champagne-gold hairlines, a quiet
// coastal wave line, Cormorant Garamond for names and tracked small capitals
// for labels. The QR code is drawn here from its modules (rounded dots and
// rounded corner eyes) in dark teal on ivory, so it keeps strong contrast.
import { loadImage, newCanvas, roundedRect, wrapText } from "@/lib/card-canvas";
import {
  CARD_HOW_TO_BOOK,
  CARD_PAY_HEADING,
  CARD_PAY_SAFELY,
  PRINT_PIXELS,
  PRINT_POINTS,
  STATUS_PIXELS,
  type BusinessCardContent,
} from "@shared/business-card";
import { SUPPORT_PHONE_DISPLAY } from "@shared/support-contact";

const INK = "#0a2a28";
const TEAL = "#0f3d3a";
const TEAL_LIGHT = "#165049";
const IVORY = "#f8f3ea";
const IVORY_SOFT = "rgba(248, 243, 234, 0.78)";
const IVORY_FAINT = "rgba(248, 243, 234, 0.6)";
const GOLD = "#c9a45c";
const GOLD_LIGHT = "#e8d3a2";
const GOLD_DEEP = "#9c7631";
const TEXT = "#1d1a16";
const TEXT_MUTED = "#5f5548";
const SERIF = "'Cormorant Garamond', Georgia, serif";
const SANS = "'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif";

// The QR code's modules, row by row (1 = dark), from qrcode's create().
export type QrMatrix = { size: number; data: ArrayLike<number> };

async function fontsReady() {
  try {
    await Promise.all([`600 40px ${SERIF}`, `italic 500 40px ${SERIF}`, `500 20px ${SANS}`, `600 20px ${SANS}`, `700 20px ${SANS}`].map((font) => document.fonts.load(font)));
  } catch {
    // The fallback fonts are fine.
  }
}

type Context = CanvasRenderingContext2D;

// A champagne-gold sheen across a span, for rules, rings and lettering.
function goldGradient(context: Context, x0: number, y0: number, x1: number, y1: number) {
  const gradient = context.createLinearGradient(x0, y0, x1, y1);
  gradient.addColorStop(0, GOLD_DEEP);
  gradient.addColorStop(0.45, GOLD_LIGHT);
  gradient.addColorStop(0.7, GOLD);
  gradient.addColorStop(1, GOLD_DEEP);
  return gradient;
}

// Letter-spaced capitals, drawn letter by letter so every browser spaces them.
function trackedWidth(context: Context, text: string, tracking: number) {
  const letters = Array.from(text);
  return letters.reduce((sum, letter) => sum + context.measureText(letter).width, 0) + tracking * Math.max(0, letters.length - 1);
}

function drawTracked(context: Context, text: string, x: number, y: number, tracking: number, align: "left" | "center" = "left") {
  const width = trackedWidth(context, text, tracking);
  let cursor = align === "center" ? x - width / 2 : x;
  const previous = context.textAlign;
  context.textAlign = "left";
  for (const letter of Array.from(text)) {
    context.fillText(letter, cursor, y);
    cursor += context.measureText(letter).width + tracking;
  }
  context.textAlign = previous;
  return width;
}

// Two lines of even length rather than a long line and a stray word.
function balancedLines(context: Context, text: string, maxWidth: number, measure: (value: string) => number = (value) => context.measureText(value).width) {
  const lines = wrapText(context, text, maxWidth);
  if (lines.length !== 2) return lines;
  const words = text.split(/\s+/);
  let best = lines;
  let bestWidth = Math.max(...lines.map(measure));
  for (let split = 1; split < words.length; split += 1) {
    const candidate = [words.slice(0, split).join(" "), words.slice(split).join(" ")];
    const widest = Math.max(...candidate.map(measure));
    if (widest <= maxWidth && widest < bestWidth) {
      best = candidate;
      bestWidth = widest;
    }
  }
  return best;
}

function drawLines(context: Context, lines: string[], x: number, y: number, lineHeight: number) {
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));
  return y + (lines.length - 1) * lineHeight;
}

// A thin gold rule, optionally with a small diamond in the middle.
function goldRule(context: Context, x: number, y: number, width: number, diamond = false, lineWidth = 2) {
  context.save();
  context.strokeStyle = goldGradient(context, x, y, x + width, y);
  context.fillStyle = context.strokeStyle;
  context.lineWidth = lineWidth;
  const mid = x + width / 2;
  const gap = diamond ? lineWidth * 7 : 0;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(mid - gap, y);
  context.moveTo(mid + gap, y);
  context.lineTo(x + width, y);
  context.stroke();
  if (diamond) {
    const r = lineWidth * 3.2;
    context.beginPath();
    context.moveTo(mid, y - r);
    context.lineTo(mid + r, y);
    context.lineTo(mid, y + r);
    context.lineTo(mid - r, y);
    context.closePath();
    context.fill();
  }
  context.restore();
}

// Long, low swells, like the tide line on the coast: a quiet texture.
function drawWaves(context: Context, x: number, y: number, width: number, height: number, color: string, count: number, lineWidth: number) {
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  for (let index = 0; index < count; index += 1) {
    const base = y + (height / (count + 1)) * (index + 1);
    const amplitude = height / (count * 2.6);
    const phase = index * 0.9;
    context.beginPath();
    for (let step = 0; step <= 80; step += 1) {
      const px = x + (width / 80) * step;
      const py = base + Math.sin((step / 80) * Math.PI * 2.2 + phase) * amplitude;
      if (step === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.stroke();
  }
  context.restore();
}

// The photo or logo in a circle with a gold ring, or the first letter of the
// name when there's no approved photo (or it can't be drawn).
async function drawAvatar(context: Context, content: BusinessCardContent, cx: number, cy: number, diameter: number) {
  const radius = diameter / 2;
  const ring = Math.max(3, diameter * 0.03);
  context.save();
  context.fillStyle = goldGradient(context, cx - radius, cy - radius, cx + radius, cy + radius);
  context.beginPath();
  context.arc(cx, cy, radius + ring * 1.6, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = INK;
  context.beginPath();
  context.arc(cx, cy, radius + ring * 0.45, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.clip();

  let drawn = false;
  if (content.photoUrl) {
    try {
      const image = await loadImage(content.photoUrl, !content.photoUrl.startsWith("/"));
      if (content.photoIsLogo) {
        context.fillStyle = IVORY;
        context.fillRect(cx - radius, cy - radius, diameter, diameter);
        const scale = Math.min((diameter * 0.66) / image.width, (diameter * 0.66) / image.height);
        context.drawImage(image, cx - (image.width * scale) / 2, cy - (image.height * scale) / 2, image.width * scale, image.height * scale);
      } else {
        const scale = Math.max(diameter / image.width, diameter / image.height);
        context.drawImage(image, cx - (image.width * scale) / 2, cy - (image.height * scale) / 2, image.width * scale, image.height * scale);
      }
      drawn = true;
    } catch {
      drawn = false;
    }
  }
  if (!drawn) {
    const fill = context.createLinearGradient(cx - radius, cy - radius, cx + radius, cy + radius);
    fill.addColorStop(0, TEAL_LIGHT);
    fill.addColorStop(1, TEAL);
    context.fillStyle = fill;
    context.fillRect(cx - radius, cy - radius, diameter, diameter);
    context.fillStyle = goldGradient(context, cx - radius, cy - radius, cx + radius, cy + radius);
    context.font = `600 ${Math.round(diameter * 0.52)}px ${SERIF}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(Array.from(content.name.trim())[0]?.toUpperCase() ?? "T", cx, cy + diameter * 0.03);
  }
  context.restore();
}

// "Verified by TBM" as a gold-outlined pill with a tick. It says TBM checked
// their ID; the page explains what that does and doesn't mean.
function drawVerified(context: Context, x: number, y: number, fontSize: number, align: "left" | "center" = "left") {
  const label = "VERIFIED BY TBM";
  const tracking = fontSize * 0.16;
  context.save();
  context.font = `600 ${fontSize}px ${SANS}`;
  const textWidth = trackedWidth(context, label, tracking);
  const padX = fontSize * 1.05;
  const tick = fontSize * 1.05;
  const width = textWidth + padX * 2 + tick + fontSize * 0.5;
  const height = fontSize * 2.3;
  const left = align === "center" ? x - width / 2 : x;
  context.strokeStyle = goldGradient(context, left, y, left + width, y + height);
  context.lineWidth = Math.max(1.5, fontSize / 11);
  context.beginPath();
  if (typeof context.roundRect === "function") context.roundRect(left, y, width, height, height / 2);
  else context.rect(left, y, width, height);
  context.stroke();
  context.lineWidth = Math.max(2, fontSize / 6.5);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  const tx = left + padX;
  const ty = y + height / 2;
  context.moveTo(tx, ty);
  context.lineTo(tx + tick * 0.32, ty + tick * 0.3);
  context.lineTo(tx + tick * 0.86, ty - tick * 0.32);
  context.stroke();
  context.fillStyle = GOLD_LIGHT;
  context.textBaseline = "middle";
  drawTracked(context, label, tx + tick + fontSize * 0.5, ty + 1, tracking);
  context.restore();
  return height;
}

// The QR code on an ivory tile: rounded dots, and rounded eyes in the three
// corners. Dark teal on ivory keeps the contrast phones need to read it.
function drawQrTile(context: Context, matrix: QrMatrix, x: number, y: number, qrSize: number, padding: number, radius: number) {
  const tileSize = qrSize + padding * 2;
  context.save();
  context.shadowColor = "rgba(0, 0, 0, 0.28)";
  context.shadowBlur = tileSize * 0.06;
  context.shadowOffsetY = tileSize * 0.02;
  context.fillStyle = IVORY;
  roundedRect(context, x, y, tileSize, tileSize, radius);
  context.restore();
  context.save();
  context.strokeStyle = goldGradient(context, x, y, x + tileSize, y + tileSize);
  context.lineWidth = Math.max(1.5, tileSize / 160);
  const inset = context.lineWidth * 2.5;
  context.beginPath();
  if (typeof context.roundRect === "function") context.roundRect(x + inset, y + inset, tileSize - inset * 2, tileSize - inset * 2, Math.max(2, radius - inset));
  else context.rect(x + inset, y + inset, tileSize - inset * 2, tileSize - inset * 2);
  context.stroke();
  context.restore();
  drawQrModules(context, matrix, x + padding, y + padding, qrSize);
  return tileSize;
}

export function drawQrModules(context: Context, matrix: QrMatrix, x: number, y: number, size: number) {
  const count = matrix.size;
  const cell = size / count;
  const inEye = (row: number, col: number) =>
    (row < 7 && col < 7) || (row < 7 && col >= count - 7) || (row >= count - 7 && col < 7);
  context.save();
  context.fillStyle = INK;
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (!matrix.data[row * count + col] || inEye(row, col)) continue;
      context.beginPath();
      context.arc(x + (col + 0.5) * cell, y + (row + 0.5) * cell, cell * 0.46, 0, Math.PI * 2);
      context.fill();
    }
  }
  const eye = (row: number, col: number) => {
    const ex = x + col * cell;
    const ey = y + row * cell;
    context.fillStyle = INK;
    roundedRect(context, ex, ey, cell * 7, cell * 7, cell * 2.1);
    context.fillStyle = IVORY;
    roundedRect(context, ex + cell, ey + cell, cell * 5, cell * 5, cell * 1.4);
    context.fillStyle = INK;
    roundedRect(context, ex + cell * 2, ey + cell * 2, cell * 3, cell * 3, cell * 0.9);
  };
  eye(0, 0);
  eye(0, count - 7);
  eye(count - 7, 0);
  context.restore();
}

function inkBackground(context: Context, width: number, height: number) {
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, INK);
  gradient.addColorStop(0.55, TEAL);
  gradient.addColorStop(1, INK);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
}

// ── WhatsApp Status image ────────────────────────────────────────────────────

// eyebrow: the small capitals at the top ("TBM SPOTLIGHT" when TBM features
// the provider); the brand name otherwise.
export async function renderStatusImage(content: BusinessCardContent, qr: QrMatrix, pageLabel: string, options: { eyebrow?: string } = {}) {
  await fontsReady();
  const { width, height } = STATUS_PIXELS;
  const { canvas, context } = newCanvas(width, height);
  inkBackground(context, width, height);
  const glow = context.createRadialGradient(width / 2, 360, 40, width / 2, 360, 720);
  glow.addColorStop(0, "rgba(201, 164, 92, 0.2)");
  glow.addColorStop(1, "rgba(201, 164, 92, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, width, height);
  drawWaves(context, 0, height - 330, width, 330, "rgba(201, 164, 92, 0.1)", 6, 2);

  context.textBaseline = "alphabetic";
  context.font = `600 26px ${SANS}`;
  context.fillStyle = goldGradient(context, 300, 0, 780, 0);
  const brandWidth = drawTracked(context, (options.eyebrow ?? "Tembea Bila Matata").toUpperCase(), width / 2, 150, 7, "center");
  goldRule(context, width / 2 - brandWidth / 2 - 130, 141, 100, false, 2);
  goldRule(context, width / 2 + brandWidth / 2 + 30, 141, 100, false, 2);

  await drawAvatar(context, content, width / 2, 390, 236);

  context.textAlign = "center";
  context.fillStyle = IVORY;
  context.font = `600 84px ${SERIF}`;
  let y = drawLines(context, balancedLines(context, content.name, width - 220).slice(0, 2), width / 2, 640, 88);
  goldRule(context, width / 2 - 50, y + 42, 100, true, 2);
  context.fillStyle = IVORY_SOFT;
  context.font = `500 34px ${SANS}`;
  y = drawLines(context, balancedLines(context, content.line, width - 260).slice(0, 2), width / 2, y + 108, 46);
  if (content.verified) {
    y += 34 + drawVerified(context, width / 2, y + 34, 24, "center");
  }

  const qrSize = 500;
  const padding = 44;
  const tileSize = qrSize + padding * 2;
  const tileTop = Math.max(y + 56, 980);
  const ctaHeight = 96;
  context.save();
  context.shadowColor = "rgba(0, 0, 0, 0.3)";
  context.shadowBlur = 40;
  context.shadowOffsetY = 12;
  context.fillStyle = IVORY;
  roundedRect(context, (width - tileSize) / 2, tileTop, tileSize, tileSize + ctaHeight, 40);
  context.restore();
  context.save();
  context.strokeStyle = goldGradient(context, 0, tileTop, width, tileTop + tileSize);
  context.lineWidth = 3;
  context.beginPath();
  if (typeof context.roundRect === "function") context.roundRect((width - tileSize) / 2 + 10, tileTop + 10, tileSize - 20, tileSize + ctaHeight - 20, 32);
  else context.rect((width - tileSize) / 2 + 10, tileTop + 10, tileSize - 20, tileSize + ctaHeight - 20);
  context.stroke();
  context.restore();
  drawQrModules(context, qr, (width - qrSize) / 2, tileTop + padding, qrSize);
  context.fillStyle = TEAL;
  context.font = `700 28px ${SANS}`;
  drawTracked(context, content.callToAction.toUpperCase(), width / 2, tileTop + tileSize + 44, 4, "center");

  const below = tileTop + tileSize + ctaHeight;
  context.fillStyle = IVORY_SOFT;
  context.font = `500 30px ${SANS}`;
  context.textAlign = "center";
  context.fillText(pageLabel, width / 2, below + 58);
  goldRule(context, width / 2 - 70, below + 104, 140, true, 2);
  context.fillStyle = IVORY_FAINT;
  context.font = `500 26px ${SANS}`;
  drawLines(context, balancedLines(context, content.coordinatedBy, width - 200).slice(0, 2), width / 2, below + 152, 36);
  return canvas.toDataURL("image/png");
}

// ── Print card ───────────────────────────────────────────────────────────────

// Print sizes: at 300 dpi, 25 px is about 6 pt, so the smallest words on the
// card stay readable once printed (labels 5.5–6 pt, text 7 pt and up).
export async function renderPrintFront(content: BusinessCardContent, qr: QrMatrix) {
  await fontsReady();
  const { width, height, safe } = PRINT_PIXELS;
  const { canvas, context } = newCanvas(width, height);
  inkBackground(context, width, height);
  drawWaves(context, 0, height - 230, width, 230, "rgba(201, 164, 92, 0.09)", 4, 1.6);
  context.textBaseline = "alphabetic";

  // Right: the QR code on an ivory tile, the call to action under it, the
  // pair centred on the card.
  const qrSize = 238;
  const padding = 24;
  const tileSize = qrSize + padding * 2;
  const tileLeft = width - safe - tileSize;
  const rightWidth = tileSize + 40;
  context.font = `600 21px ${SANS}`;
  const cta = content.callToAction.toUpperCase();
  const ctaTracking = 3;
  const measureCta = (value: string) => trackedWidth(context, value, ctaTracking);
  let ctaLines = [cta];
  if (measureCta(cta) > rightWidth) {
    const words = cta.split(" ");
    ctaLines = words.slice(1).map((_, index) => [words.slice(0, index + 1).join(" "), words.slice(index + 1).join(" ")])
      .reduce((best, candidate) => (Math.max(...candidate.map(measureCta)) < Math.max(...best.map(measureCta)) ? candidate : best));
  }
  const rightHeight = tileSize + 30 + ctaLines.length * 30;
  const tileTop = Math.round((height - rightHeight) / 2);
  drawQrTile(context, qr, tileLeft, tileTop, qrSize, padding, 22);
  context.fillStyle = goldGradient(context, tileLeft, 0, tileLeft + tileSize, 0);
  ctaLines.forEach((text, index) => drawTracked(context, text, tileLeft + tileSize / 2, tileTop + tileSize + 46 + index * 30, ctaTracking, "center"));

  // A gold hairline between the two halves.
  const dividerX = tileLeft - 40;
  context.save();
  const line = context.createLinearGradient(0, safe, 0, height - safe);
  line.addColorStop(0, "rgba(201, 164, 92, 0)");
  line.addColorStop(0.5, "rgba(201, 164, 92, 0.75)");
  line.addColorStop(1, "rgba(201, 164, 92, 0)");
  context.strokeStyle = line;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(dividerX, safe + 10);
  context.lineTo(dividerX, height - safe - 10);
  context.stroke();
  context.restore();

  // Left: the brand at the top, the line about TBM at the foot, and who,
  // what and where centred between them.
  const left = safe + 4;
  const columnWidth = dividerX - left - 30;
  context.fillStyle = goldGradient(context, left, 0, left + 320, 0);
  context.font = `600 21px ${SANS}`;
  drawTracked(context, "TEMBEA BILA MATATA", left, safe + 20, 4.5);

  context.font = `500 23px ${SANS}`;
  const footer = balancedLines(context, content.coordinatedBy, columnWidth + 10).slice(0, 2);
  const footerTop = height - safe - 6 - (footer.length - 1) * 29;

  let nameSize = 56;
  context.font = `600 ${nameSize}px ${SERIF}`;
  let nameLines = balancedLines(context, content.name, columnWidth);
  if (nameLines.length > 2) {
    nameSize = 46;
    context.font = `600 ${nameSize}px ${SERIF}`;
    nameLines = balancedLines(context, content.name, columnWidth);
  }
  nameLines = nameLines.slice(0, 2);
  context.font = `500 29px ${SANS}`;
  const serviceLines = balancedLines(context, content.line, columnWidth).slice(0, 2);
  const avatar = 112;
  const pillHeight = content.verified ? 19 * 2.3 : 0;
  const blockHeight = avatar + 22 + nameSize * 0.78 + (nameLines.length - 1) * (nameSize + 2) + 26 + 18 + 29 * 0.78 + (serviceLines.length - 1) * 37 + (pillHeight ? 20 + pillHeight : 0);
  const areaTop = safe + 44;
  const areaBottom = footerTop - 23 - 26;
  let y = Math.max(areaTop, areaTop + (areaBottom - areaTop - blockHeight) / 2);

  await drawAvatar(context, content, left + avatar / 2 + 6, y + avatar / 2, avatar);
  y += avatar + 22 + nameSize * 0.78;
  context.textAlign = "left";
  context.fillStyle = IVORY;
  context.font = `600 ${nameSize}px ${SERIF}`;
  y = drawLines(context, nameLines, left, y, nameSize + 2);
  goldRule(context, left, y + 22, 64, false, 2);
  y += 26 + 18 + 29 * 0.78;
  context.fillStyle = IVORY_SOFT;
  context.font = `500 29px ${SANS}`;
  y = drawLines(context, serviceLines, left, y, 37);
  if (content.verified) drawVerified(context, left, y + 20, 19);

  context.fillStyle = IVORY_FAINT;
  context.font = `500 23px ${SANS}`;
  drawLines(context, footer, left, footerTop, 29);
  return canvas;
}

export async function renderPrintBack(pageLabel: string) {
  await fontsReady();
  const { width, height, safe } = PRINT_PIXELS;
  const { canvas, context } = newCanvas(width, height);
  context.fillStyle = IVORY;
  context.fillRect(0, 0, width, height);
  const paper = context.createRadialGradient(width / 2, height * 0.35, 60, width / 2, height * 0.35, width * 0.7);
  paper.addColorStop(0, "rgba(255, 255, 255, 0.7)");
  paper.addColorStop(1, "rgba(232, 211, 162, 0.18)");
  context.fillStyle = paper;
  context.fillRect(0, 0, width, height);

  // The teal band at the foot runs off the edge into the bleed.
  const bandTop = height - safe - 116;
  const band = context.createLinearGradient(0, bandTop, width, height);
  band.addColorStop(0, INK);
  band.addColorStop(0.6, TEAL);
  band.addColorStop(1, INK);
  context.fillStyle = band;
  context.fillRect(0, bandTop, width, height - bandTop);
  drawWaves(context, 0, bandTop, width, height - bandTop, "rgba(201, 164, 92, 0.12)", 3, 1.4);
  context.fillStyle = goldGradient(context, 0, bandTop, width, bandTop);
  context.fillRect(0, bandTop, width, 3);

  // The words, centred in the ivory part.
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  const textWidth = width - 2 * safe - 90;
  context.font = `500 26px ${SANS}`;
  const payLines = wrapText(context, CARD_PAY_SAFELY, textWidth).slice(0, 4);
  context.font = `600 28px ${SANS}`;
  const howLines = wrapText(context, CARD_HOW_TO_BOOK, textWidth);
  // Baseline steps from the top of the block.
  const steps = { wordmark: 44, tagline: 38, rule: 26, heading: 62, how: 46, pay: 42 };
  const blockHeight = steps.wordmark + steps.tagline + steps.rule + steps.heading + steps.how + (howLines.length - 1) * 36 + steps.pay + (payLines.length - 1) * 34 + 8;
  let y = safe + Math.max(0, (bandTop - safe - 18 - blockHeight) / 2);

  y += steps.wordmark;
  context.fillStyle = TEAL;
  context.font = `600 58px ${SERIF}`;
  context.fillText("Tembea Bila Matata", width / 2, y);
  y += steps.tagline;
  context.fillStyle = goldGradient(context, width / 2 - 220, 0, width / 2 + 220, 0);
  context.font = `600 19px ${SANS}`;
  drawTracked(context, "TRAVEL WITHOUT WORRIES", width / 2, y, 5.5, "center");
  y += steps.rule;
  goldRule(context, width / 2 - 130, y, 260, true, 1.6);
  y += steps.heading;
  context.fillStyle = TEAL;
  context.font = `italic 500 44px ${SERIF}`;
  context.fillText(CARD_PAY_HEADING, width / 2, y);
  y += steps.how;
  context.fillStyle = TEXT;
  context.font = `600 28px ${SANS}`;
  y = drawLines(context, howLines, width / 2, y, 36);
  y += steps.pay;
  context.fillStyle = TEXT_MUTED;
  context.font = `500 26px ${SANS}`;
  drawLines(context, payLines, width / 2, y, 34);

  context.fillStyle = IVORY;
  context.font = `600 28px ${SANS}`;
  context.fillText(pageLabel, width / 2, bandTop + 52);
  context.fillStyle = GOLD_LIGHT;
  context.font = `500 25px ${SANS}`;
  context.fillText(`TBM's official number  ${SUPPORT_PHONE_DISPLAY}`, width / 2, bandTop + 92);
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
