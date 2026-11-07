/**
 * @file Bitmaps (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO) as image shapes.
 *
 * The file is stored in the drawing as a data: URL, so the project and the exported SVG stay self-contained.
 * Formats every SVG viewer shows (PNG, JPEG, GIF, WebP, AVIF) keep their own bytes: no quality loss, GIF / WebP
 * animation kept, nothing grows. BMP and ICO are re-encoded as PNG: BMP is uncompressed (huge as base64) and
 * many viewers cannot show either inside an SVG.
 */
import { readDataUrl } from './files';

/** Kept byte for byte. */
const KEEP = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp,image/x-icon,image/vnd.microsoft.icon,.png,.jpg,.jpeg,.gif,.webp,.avif,.bmp,.ico';

export const isImageFile = (f: File) => /^image\//.test(f.type) && f.type !== 'image/svg+xml' || /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i.test(f.name);

export interface LoadedImage { href: string; width: number; height: number; }

function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error('This image could not be read (the file may be damaged, or the browser does not support its format).'));
    img.src = src;
  });
}

/** Reads an image file into a data: URL and its natural size. */
export async function loadImageFile(file: File): Promise<LoadedImage> {
  const raw = await readDataUrl(file);
  const img = await decode(raw);
  const width = img.naturalWidth || 1, height = img.naturalHeight || 1;
  if (KEEP.has(file.type)) return { href: raw, width, height };
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available.');
  ctx.drawImage(img, 0, 0);
  return { href: canvas.toDataURL('image/png'), width, height };
}

/**
 * Where a new image goes: its natural size, scaled down (aspect kept) when it is larger than 80 % of the page,
 * centred on `at` (document units) or on the page.
 */
export function placeImage(w: number, h: number, page: { width: number; height: number }, at?: { x: number; y: number }) {
  const k = Math.min(1, (page.width * 0.8) / w, (page.height * 0.8) / h);
  const width = w * k, height = h * k;
  const c = at ?? { x: page.width / 2, y: page.height / 2 };
  return { x: c.x - width / 2, y: c.y - height / 2, width, height };
}
