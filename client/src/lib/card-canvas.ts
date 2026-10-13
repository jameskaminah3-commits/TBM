// Drawing helpers shared by the listing QR card and the provider business card.

export function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Rounded where the browser can draw it, square where it can't.
export function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  context.beginPath();
  if (typeof context.roundRect === "function") context.roundRect(x, y, w, h, r);
  else context.rect(x, y, w, h);
  context.fill();
}

export function loadImage(src: string, crossOrigin = false) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    if (crossOrigin) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Couldn't load an image for the card"));
    image.src = src;
  });
}

export function newCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser couldn't draw the card");
  return { canvas, context };
}

// Save a file the browser made (an image, a PDF, a contact file).
export function saveFile(data: Blob | string, fileName: string) {
  const href = typeof data === "string" ? data : URL.createObjectURL(data);
  const link = document.createElement("a");
  link.href = href;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  if (typeof data !== "string") setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
