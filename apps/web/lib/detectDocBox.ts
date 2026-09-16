export type DocBox = { x: number; y: number; w: number; h: number; score: number };

function grayOf(data: Uint8ClampedArray | Uint8Array, i: number, channels: 1 | 4) {
  if (channels === 1) return data[i];
  const p = i * 4;
  return (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
}

/** Hoja tipo A4 (blanca sobre carpeta oscura). No es OCR. */
export function detectDocBox(
  data: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  channels: 1 | 4 = 4
): DocBox | null {
  const n = width * height;
  const gray = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const g = Math.max(0, Math.min(255, grayOf(data, i, channels) | 0));
    gray[i] = g;
    hist[g]++;
  }
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
  let best: DocBox | null = null;
  const frame = n;

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
    const areaRatio = count / frame;
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
      best = { x: x0 / width, y: y0 / height, w: bw / width, h: bh / height, score };
    }
  }
  return best;
}
