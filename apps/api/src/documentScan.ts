import sharp from "sharp";

const MAX_EDGE = 1280;
const TARGET_QUALITY = 72;
const SMALL_QUALITY = 55;
const MAX_BYTES = 280_000;

export type NormBox = { x: number; y: number; w: number; h: number };

function detectPageBox(gray: Buffer, width: number, height: number): NormBox | null {
  const n = width * height;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[gray[i]]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let maxVar = 0;
  let thresh = 160;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      thresh = i;
    }
  }
  thresh = Math.min(210, Math.max(125, thresh + 6));

  const seen = new Uint8Array(n);
  const stack: number[] = [];
  let best: { box: NormBox; score: number } | null = null;

  for (let i = 0; i < n; i++) {
    if (seen[i] || gray[i] < thresh) continue;
    stack.push(i);
    seen[i] = 1;
    let count = 0;
    let x0 = width;
    let y0 = height;
    let x1 = 0;
    let y1 = 0;
    let innerSum = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % width;
      const y = (p / width) | 0;
      count++;
      innerSum += gray[p];
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      const neigh = [p - 1, p + 1, p - width, p + width];
      for (const q of neigh) {
        if (q < 0 || q >= n || seen[q] || gray[q] < thresh) continue;
        if (Math.abs((q % width) - x) > 1) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (bw < 24 || bh < 24) continue;
    const bboxArea = bw * bh;
    const fill = count / bboxArea;
    const areaRatio = count / n;
    const aspect = bw / bh;
    if (fill < 0.52 || areaRatio < 0.05 || areaRatio > 0.62) continue;
    if (aspect < 0.35 || aspect > 3.2) continue;
    const pad = Math.max(4, Math.round(Math.min(bw, bh) * 0.08));
    let ringSum = 0;
    let ringN = 0;
    for (let y = Math.max(0, y0 - pad); y <= Math.min(height - 1, y1 + pad); y++) {
      for (let x = Math.max(0, x0 - pad); x <= Math.min(width - 1, x1 + pad); x++) {
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1) continue;
        ringSum += gray[y * width + x];
        ringN++;
      }
    }
    const innerMean = innerSum / count;
    const ringMean = ringN ? ringSum / ringN : innerMean;
    const contrast = innerMean - ringMean;
    if (contrast < 18) continue;
    const score = fill * contrast * (1 - Math.abs(areaRatio - 0.22));
    if (!best || score > best.score) {
      best = {
        score,
        box: { x: x0 / width, y: y0 / height, w: bw / width, h: bh / height },
      };
    }
  }
  return best?.box ?? null;
}

function clampBox(box: NormBox): NormBox {
  const x = Math.max(0, Math.min(0.92, box.x));
  const y = Math.max(0, Math.min(0.92, box.y));
  const w = Math.max(0.08, Math.min(1 - x, box.w));
  const h = Math.max(0.08, Math.min(1 - y, box.h));
  return { x, y, w, h };
}

export async function processDocumentImage(
  input: Buffer,
  hint?: NormBox | null
): Promise<{
  jpeg: Buffer;
  cropped: boolean;
  rotated: boolean;
  width: number;
  height: number;
}> {
  if (input.length > 8 * 1024 * 1024) {
    throw new Error("La imagen pesa más de 8 MB. Subí una foto más liviana.");
  }

  const oriented = await sharp(input, { failOn: "none" }).rotate().toBuffer();
  const meta = await sharp(oriented).metadata();
  const srcW = meta.width || 0;
  const srcH = meta.height || 0;
  if (!srcW || !srcH) throw new Error("No se pudo leer la imagen");

  let box = hint ? clampBox(hint) : null;
  if (!box) {
    const analysisW = Math.min(480, srcW);
    const { data, info } = await sharp(oriented)
      .greyscale()
      .blur(0.8)
      .resize({ width: analysisW, withoutEnlargement: true })
      .raw()
      .toBuffer({ resolveWithObject: true });
    box = detectPageBox(data, info.width, info.height);
  }

  let extract: { left: number; top: number; width: number; height: number } | null = null;
  if (box) {
    const padX = box.w * 0.03;
    const padY = box.h * 0.03;
    const left = Math.max(0, Math.floor((box.x - padX) * srcW));
    const top = Math.max(0, Math.floor((box.y - padY) * srcH));
    const width = Math.min(srcW - left, Math.max(1, Math.ceil((box.w + padX * 2) * srcW)));
    const height = Math.min(srcH - top, Math.max(1, Math.ceil((box.h + padY * 2) * srcH)));
    if (
      width >= 48 &&
      height >= 48 &&
      left + width <= srcW &&
      top + height <= srcH &&
      (width < srcW * 0.97 || height < srcH * 0.97)
    ) {
      extract = { left, top, width, height };
    }
  }

  let page = extract ? await sharp(oriented).extract(extract).toBuffer() : oriented;
  const pageMeta = await sharp(page).metadata();
  const cw = pageMeta.width || srcW;
  const ch = pageMeta.height || srcH;
  const rotated = Boolean(extract) && cw > ch * 1.08;
  if (rotated) page = await sharp(page).rotate(90).toBuffer();

  let jpeg = await sharp(page)
    .normalize()
    .sharpen({ sigma: 0.8 })
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: TARGET_QUALITY, mozjpeg: true })
    .toBuffer();
  if (jpeg.length > MAX_BYTES) {
    jpeg = await sharp(jpeg).jpeg({ quality: SMALL_QUALITY, mozjpeg: true }).toBuffer();
  }
  const outMeta = await sharp(jpeg).metadata();
  return {
    jpeg,
    cropped: Boolean(extract),
    rotated,
    width: outMeta.width || 0,
    height: outMeta.height || 0,
  };
}
