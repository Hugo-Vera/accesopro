/** Lectura en vivo de QR (frente DNI nuevo) y PDF417 (dorso, tarjeta vieja y nueva). */

export type ScanBox = { x: number; y: number; w: number; h: number };
export type ScanHint = ScanBox & { kind: "qr" | "pdf417"; score: number };
export type ScanHit = {
  text: string;
  format: "qr" | "pdf417" | "unknown";
  box: ScanBox | null;
};

type NativeDetector = {
  detect: (src: CanvasImageSource) => Promise<
    {
      rawValue: string;
      format: string;
      boundingBox: { x: number; y: number; width: number; height: number };
      cornerPoints?: { x: number; y: number }[];
    }[]
  >;
};

type ZxingBundle = typeof import("@zxing/library");

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function formatOf(raw: string): ScanHit["format"] {
  const f = raw.toLowerCase();
  if (f.includes("pdf")) return "pdf417";
  if (f.includes("qr")) return "qr";
  return "unknown";
}

function looksLikeDni(text: string) {
  const t = text.trim();
  return t.includes("@") || /^\d{7,8}$/.test(t);
}

function downGray(gray: Uint8ClampedArray, w: number, h: number, maxW: number) {
  if (w <= maxW) return { gray, w, h };
  const nw = maxW;
  const nh = Math.max(8, Math.round((h * maxW) / w));
  const out = new Uint8ClampedArray(nw * nh);
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(h - 1, Math.round((y * h) / nh));
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(w - 1, Math.round((x * w) / nw));
      out[y * nw + x] = gray[sy * w + sx];
    }
  }
  return { gray: out, w: nw, h: nh };
}

function boxFromPoints(points: { x: number; y: number }[], vw: number, vh: number): ScanBox | null {
  if (!points.length || !vw || !vh) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = 0;
  let y1 = 0;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  const padX = (x1 - x0) * 0.08;
  const padY = (y1 - y0) * 0.08;
  return {
    x: clamp((x0 - padX) / vw, 0, 1),
    y: clamp((y0 - padY) / vh, 0, 1),
    w: clamp((x1 - x0 + padX * 2) / vw, 0, 1),
    h: clamp((y1 - y0 + padY * 2) / vh, 0, 1),
  };
}

function boxFromRect(
  r: { x: number; y: number; width: number; height: number },
  vw: number,
  vh: number,
): ScanBox | null {
  if (!vw || !vh) return null;
  return {
    x: clamp(r.x / vw, 0, 1),
    y: clamp(r.y / vh, 0, 1),
    w: clamp(r.width / vw, 0, 1),
    h: clamp(r.height / vh, 0, 1),
  };
}

function toGray(data: Uint8ClampedArray, w: number, h: number) {
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    let v = data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114;
    v = (v - 14) * 1.38;
    g[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return g;
}

function cropGray(src: Uint8ClampedArray, sw: number, sh: number, box: ScanBox) {
  const x0 = clamp(Math.floor(box.x * sw), 0, sw - 2);
  const y0 = clamp(Math.floor(box.y * sh), 0, sh - 2);
  const w = clamp(Math.ceil(box.w * sw), 8, sw - x0);
  const h = clamp(Math.ceil(box.h * sh), 8, sh - y0);
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    const row = (y0 + y) * sw + x0;
    out.set(src.subarray(row, row + w), y * w);
  }
  return { gray: out, w, h, ox: x0, oy: y0 };
}

/** Bandas anchas con mucha transición horizontal = PDF417 del dorso. */
export function findPdf417Hint(gray: Uint8ClampedArray, w: number, h: number): ScanHint | null {
  if (w < 24 || h < 16) return null;
  const energy = new Float32Array(h);
  let mean = 0;
  for (let y = 0; y < h; y++) {
    let e = 0;
    const row = y * w;
    for (let x = 1; x < w; x++) e += Math.abs(gray[row + x] - gray[row + x - 1]);
    energy[y] = e / w;
    mean += energy[y];
  }
  mean /= h;
  const thresh = mean * 1.5 + 6;
  let best: ScanHint | null = null;
  let run0 = -1;
  for (let y = 0; y <= h; y++) {
    const on = y < h && energy[y] >= thresh;
    if (on && run0 < 0) run0 = y;
    if ((!on || y === h) && run0 >= 0) {
      const y1 = y;
      const bh = y1 - run0;
      if (bh >= Math.max(6, h * 0.05) && bh <= h * 0.5) {
        let left = w;
        let right = 0;
        for (let yy = run0; yy < y1; yy++) {
          const row = yy * w;
          let x = 0;
          while (x < w && Math.abs(gray[row + x] - gray[row + Math.min(w - 1, x + 1)]) < 18) x++;
          let z = w - 1;
          while (z > x && Math.abs(gray[row + z] - gray[row + Math.max(0, z - 1)]) < 18) z--;
          if (x < left) left = x;
          if (z > right) right = z;
        }
        const bw = right - left + 1;
        if (bw > w * 0.42 && bw / Math.max(1, bh) >= 2.2) {
          const score = (bw / w) * (energy[run0 + ((bh / 2) | 0)] || mean);
          const hint: ScanHint = {
            kind: "pdf417",
            x: clamp((left - 8) / w, 0, 1),
            y: clamp((run0 - 6) / h, 0, 1),
            w: clamp((bw + 16) / w, 0, 1),
            h: clamp((bh + 12) / h, 0, 1),
            score,
          };
          if (!best || hint.score > best.score) best = hint;
        }
      }
      run0 = -1;
    }
  }
  return best;
}

/** Patrones 1:1:3:1:1 de los ojos del QR (frente del DNI nuevo). */
export function findQrHint(gray: Uint8ClampedArray, w: number, h: number): ScanHint | null {
  if (w < 40 || h < 40) return null;
  const hits: { x: number; y: number }[] = [];
  const maxModule = Math.max(2, Math.floor(w / 18));
  for (let y = 2; y < h - 2; y += 2) {
    const row = y * w;
    let x = 1;
    while (x < w - 10) {
      const start = x;
      const runs: number[] = [];
      let dark = gray[row + x] < 110;
      let len = 0;
      while (x < w && runs.length < 5) {
        const d = gray[row + x] < 110;
        if (d === dark) {
          len++;
          x++;
        } else {
          runs.push(len);
          dark = d;
          len = 1;
          x++;
        }
      }
      if (runs.length < 5) break;
      const [a, b, c, d, e] = runs;
      const unit = (a + b + d + e) / 4;
      if (
        unit >= 1 &&
        unit <= maxModule &&
        Math.abs(a - unit) <= unit * 0.7 &&
        Math.abs(b - unit) <= unit * 0.7 &&
        Math.abs(c - 3 * unit) <= unit * 1.2 &&
        Math.abs(d - unit) <= unit * 0.7 &&
        Math.abs(e - unit) <= unit * 0.7 &&
        gray[row + start] < 110
      ) {
        hits.push({ x: start + a + b + c / 2, y });
      }
      x = start + Math.max(1, a);
    }
  }
  if (hits.length < 4) return null;
  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  for (const p of hits) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (bw < w * 0.08 || bh < h * 0.08) return null;
  if (bw / w > 0.62 || bh / h > 0.62) return null;
  const ratio = bw / Math.max(1, bh);
  if (ratio < 0.55 || ratio > 1.8) return null;
  const side = Math.max(x1 - x0, y1 - y0, w * 0.18);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const pad = side * 0.55;
  return {
    kind: "qr",
    x: clamp((cx - pad) / w, 0, 1),
    y: clamp((cy - pad) / h, 0, 1),
    w: clamp((pad * 2) / w, 0, 1),
    h: clamp((pad * 2) / h, 0, 1),
    score: hits.length,
  };
}

function tryNativeDetector(): NativeDetector | null {
  const Ctor = (window as unknown as { BarcodeDetector?: new (opts: { formats: string[] }) => NativeDetector })
    .BarcodeDetector;
  if (!Ctor) return null;
  for (const formats of [
    ["qr_code", "pdf417"],
    ["qr_code"],
  ]) {
    try {
      return new Ctor({ formats });
    } catch {
      /* formato no soportado en este motor */
    }
  }
  return null;
}

export function createDniLiveDecoder() {
  let zxing: ZxingBundle | null = null;
  let qrReader: InstanceType<ZxingBundle["QRCodeReader"]> | null = null;
  let pdfReader: InstanceType<ZxingBundle["PDF417Reader"]> | null = null;
  let qrHints: Map<unknown, unknown> | null = null;
  let pdfHints: Map<unknown, unknown> | null = null;
  const detector = typeof window !== "undefined" ? tryNativeDetector() : null;
  const work = document.createElement("canvas");
  const workCtx = work.getContext("2d", { willReadFrequently: true });

  async function loadZxing() {
    if (zxing) return zxing;
    zxing = await import("@zxing/library");
    qrReader = new zxing.QRCodeReader();
    pdfReader = new zxing.PDF417Reader();
    qrHints = new Map();
    qrHints.set(zxing.DecodeHintType.POSSIBLE_FORMATS, [zxing.BarcodeFormat.QR_CODE]);
    qrHints.set(zxing.DecodeHintType.TRY_HARDER, true);
    qrHints.set(zxing.DecodeHintType.CHARACTER_SET, "ISO-8859-1");
    pdfHints = new Map();
    pdfHints.set(zxing.DecodeHintType.POSSIBLE_FORMATS, [zxing.BarcodeFormat.PDF_417]);
    pdfHints.set(zxing.DecodeHintType.TRY_HARDER, true);
    pdfHints.set(zxing.DecodeHintType.CHARACTER_SET, "ISO-8859-1");
    return zxing;
  }

  function decodeGray(
    reader: { decode: (bmp: unknown, hints?: unknown) => { getText: () => string; getBarcodeFormat: () => unknown; getResultPoints: () => { getX: () => number; getY: () => number }[] } },
    hints: Map<unknown, unknown> | null,
    lib: ZxingBundle,
    gray: Uint8ClampedArray,
    w: number,
    h: number,
  ) {
    const source = new lib.RGBLuminanceSource(gray, w, h);
    try {
      const bmp = new lib.BinaryBitmap(new lib.HybridBinarizer(source));
      return reader.decode(bmp, hints);
    } catch {
      try {
        const bmp = new lib.BinaryBitmap(new lib.HybridBinarizer(source.invert()));
        return reader.decode(bmp, hints);
      } catch {
        return null;
      }
    }
  }

  async function decodeFrame(video: HTMLVideoElement): Promise<{ hit: ScanHit | null; hints: ScanHint[] }> {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || !workCtx) return { hit: null, hints: [] };

    let nativeMiss: ScanHit | null = null;
    if (detector) {
      try {
        const codes = await detector.detect(video);
        for (const c of codes) {
          if (!c.rawValue?.trim()) continue;
          const pts = c.cornerPoints || [];
          const hit: ScanHit = {
            text: c.rawValue,
            format: formatOf(c.format),
            box:
              boxFromPoints(pts, vw, vh) ||
              boxFromRect(
                {
                  x: c.boundingBox.x,
                  y: c.boundingBox.y,
                  width: c.boundingBox.width,
                  height: c.boundingBox.height,
                },
                vw,
                vh,
              ),
          };
          if (looksLikeDni(hit.text)) return { hit, hints: [] };
          if (!nativeMiss) nativeMiss = hit;
        }
      } catch {
        /* seguir con ZXing */
      }
    }

    const scale = Math.min(1, 1280 / vw);
    work.width = Math.max(32, Math.round(vw * scale));
    work.height = Math.max(32, Math.round(vh * scale));
    workCtx.drawImage(video, 0, 0, work.width, work.height);
    const image = workCtx.getImageData(0, 0, work.width, work.height);
    const gray = toGray(image.data, work.width, work.height);
    const small = downGray(gray, work.width, work.height, 360);
    const hints: ScanHint[] = [];
    const qrHint = findQrHint(small.gray, small.w, small.h);
    const pdfHint = findPdf417Hint(small.gray, small.w, small.h);
    if (qrHint) hints.push(qrHint);
    if (pdfHint) hints.push(pdfHint);

    const lib = await loadZxing();
    if (!qrReader || !pdfReader) return { hit: null, hints };

    const crops: { box: ScanBox; target: "qr" | "pdf417" }[] = [
      { box: { x: 0.18, y: 0.12, w: 0.64, h: 0.64 }, target: "qr" },
      { box: { x: 0.05, y: 0.55, w: 0.9, h: 0.4 }, target: "pdf417" },
      { box: { x: 0.04, y: 0.28, w: 0.92, h: 0.44 }, target: "pdf417" },
      { box: { x: 0, y: 0, w: 1, h: 1 }, target: "qr" },
      { box: { x: 0, y: 0, w: 1, h: 1 }, target: "pdf417" },
    ];
    if (qrHint) crops.unshift({ box: qrHint, target: "qr" });
    if (pdfHint) crops.unshift({ box: pdfHint, target: "pdf417" });

    for (const crop of crops) {
      const padded = {
        x: clamp(crop.box.x - 0.04, 0, 1),
        y: clamp(crop.box.y - 0.04, 0, 1),
        w: clamp(crop.box.w + 0.08, 0, 1),
        h: clamp(crop.box.h + 0.08, 0, 1),
      };
      const piece = cropGray(gray, work.width, work.height, padded);
      const reader = crop.target === "qr" ? qrReader : pdfReader;
      const hintMap = crop.target === "qr" ? qrHints : pdfHints;
      const result = decodeGray(reader, hintMap, lib, piece.gray, piece.w, piece.h);
      if (!result) continue;
      const pts = (result.getResultPoints() || [])
        .filter((p): p is { getX: () => number; getY: () => number } => Boolean(p))
        .map((p) => ({
          x: (p.getX() + piece.ox) / scale,
          y: (p.getY() + piece.oy) / scale,
        }));
      const hit: ScanHit = {
        text: result.getText(),
        format: crop.target,
        box: boxFromPoints(pts, vw, vh) || padded,
      };
      if (looksLikeDni(hit.text)) return { hit, hints };
      if (!nativeMiss) nativeMiss = hit;
    }

    return { hit: nativeMiss, hints };
  }

  return { decodeFrame, hasNativeDetector: Boolean(detector) };
}
