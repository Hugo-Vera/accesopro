/** Lectura en vivo de QR (frente / credencial digital) y PDF417 (dorso). */

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
type FinderHit = { x: number; y: number; unit: number };

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
  if (t.includes("@") && t.split("@").length >= 5) return true;
  if (/^\d{7,8}$/.test(t)) return true;
  if (/\b\d{7,8}\b/.test(t) && /dni|documento|apellido|renaper|idarg|tramite/i.test(t)) return true;
  return false;
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
  const padX = (x1 - x0) * 0.12;
  const padY = (y1 - y0) * 0.12;
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

function toGray(data: Uint8ClampedArray, w: number, h: number, boost = false) {
  const g = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    let v = data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114;
    if (boost) v = (v - 14) * 1.38;
    g[i] = v < 0 ? 0 : v > 255 ? 255 : v;
  }
  return g;
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

function collectFinderHits(gray: Uint8ClampedArray, w: number, h: number): FinderHit[] {
  if (w < 40 || h < 40) return [];
  const hits: FinderHit[] = [];
  const maxModule = Math.max(2, Math.floor(w / 12));
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
        hits.push({ x: start + a + b + c / 2, y, unit });
      }
      x = start + Math.max(1, a);
    }
  }
  return hits;
}

function hintFromCluster(group: FinderHit[], w: number, h: number): ScanHint | null {
  if (group.length < 3) return null;
  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  let unit = 0;
  for (const p of group) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
    unit += p.unit;
  }
  unit /= group.length;
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (bw < unit * 6 || bh < unit * 6) return null;
  const ratio = bw / Math.max(1, bh);
  if (ratio < 0.35 || ratio > 2.8) return null;
  const side = Math.max(bw, bh, unit * 18);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const pad = side * 0.42;
  return {
    kind: "qr",
    x: clamp((cx - pad) / w, 0, 1),
    y: clamp((cy - pad) / h, 0, 1),
    w: clamp((pad * 2) / w, 0, 1),
    h: clamp((pad * 2) / h, 0, 1),
    score: group.length,
  };
}

/** Un recuadro por QR. Si hay dos códigos en el mismo frame no se mezclan. */
export function findQrHints(gray: Uint8ClampedArray, w: number, h: number): ScanHint[] {
  const hits = collectFinderHits(gray, w, h);
  if (hits.length < 3) return [];
  const used = new Uint8Array(hits.length);
  const hints: ScanHint[] = [];
  for (let i = 0; i < hits.length; i++) {
    if (used[i]) continue;
    const seed = hits[i];
    const group = [seed];
    used[i] = 1;
    let grew = true;
    while (grew) {
      grew = false;
      const gx = group.reduce((s, p) => s + p.x, 0) / group.length;
      const gy = group.reduce((s, p) => s + p.y, 0) / group.length;
      const reach = Math.max(
        seed.unit * 24,
        ...group.map((p) => Math.hypot(p.x - gx, p.y - gy) * 1.4),
        Math.min(w, h) * 0.18,
      );
      for (let j = 0; j < hits.length; j++) {
        if (used[j]) continue;
        const other = hits[j];
        if (other.unit > seed.unit * 3 || seed.unit > other.unit * 3) continue;
        if (Math.hypot(other.x - gx, other.y - gy) <= reach) {
          group.push(other);
          used[j] = 1;
          grew = true;
        }
      }
    }
    const hint = hintFromCluster(group, w, h);
    if (hint) hints.push(hint);
  }
  hints.sort((a, b) => b.w * b.h - a.w * a.h);
  return hints.slice(0, 3);
}

export function findQrHint(gray: Uint8ClampedArray, w: number, h: number): ScanHint | null {
  return findQrHints(gray, w, h)[0] || null;
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
  let qrPureHints: Map<unknown, unknown> | null = null;
  let pdfHints: Map<unknown, unknown> | null = null;
  const detector = typeof window !== "undefined" ? tryNativeDetector() : null;
  const work = document.createElement("canvas");
  const workCtx = work.getContext("2d", { willReadFrequently: true });
  const crop = document.createElement("canvas");
  const cropCtx = crop.getContext("2d", { willReadFrequently: true, alpha: false });
  const pdfCanvas = document.createElement("canvas");
  const pdfCtx = pdfCanvas.getContext("2d", { willReadFrequently: true, alpha: false });

  async function loadZxing() {
    if (zxing) return zxing;
    zxing = await import("@zxing/library");
    qrReader = new zxing.QRCodeReader();
    pdfReader = new zxing.PDF417Reader();
    qrHints = new Map();
    qrHints.set(zxing.DecodeHintType.POSSIBLE_FORMATS, [zxing.BarcodeFormat.QR_CODE]);
    qrHints.set(zxing.DecodeHintType.CHARACTER_SET, "ISO-8859-1");
    qrPureHints = new Map(qrHints);
    qrPureHints.set(zxing.DecodeHintType.PURE_BARCODE, true);
    pdfHints = new Map();
    pdfHints.set(zxing.DecodeHintType.POSSIBLE_FORMATS, [zxing.BarcodeFormat.PDF_417]);
    pdfHints.set(zxing.DecodeHintType.CHARACTER_SET, "ISO-8859-1");
    pdfHints.set(zxing.DecodeHintType.TRY_HARDER, true);
    return zxing;
  }

  let pass = 0;

  type ZxingResult = {
    getText: () => string;
    getResultPoints: () => { getX: () => number; getY: () => number }[] | null;
  };
  type LuminanceSourceLike = ConstructorParameters<ZxingBundle["HybridBinarizer"]>[0];

  function decodeQrSource(lib: ZxingBundle, source: LuminanceSourceLike, extra?: Map<unknown, unknown> | null) {
    if (!qrReader) return null;
    const bins = [lib.HybridBinarizer, lib.GlobalHistogramBinarizer];
    const hintSets = extra ? [extra, qrHints] : [qrHints, qrPureHints];
    for (const hints of hintSets) {
      for (const Binarizer of bins) {
        try {
          return qrReader.decode(new lib.BinaryBitmap(new Binarizer(source)), hints as never);
        } catch {
          try {
            return qrReader.decode(new lib.BinaryBitmap(new Binarizer(source.invert())), hints as never);
          } catch {
            /* siguiente */
          }
        }
      }
    }
    return null;
  }

  function paintCrop(video: HTMLVideoElement, box: ScanBox) {
    if (!cropCtx) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const sx = box.x * vw;
    const sy = box.y * vh;
    const sw = Math.max(16, box.w * vw);
    const sh = Math.max(16, box.h * vh);
    const maxSide = 720;
    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    const dw = Math.max(24, Math.round(sw * scale));
    const dh = Math.max(24, Math.round(sh * scale));
    const pad = Math.max(28, Math.round(Math.min(dw, dh) * 0.18));
    crop.width = dw + pad * 2;
    crop.height = dh + pad * 2;
    cropCtx.fillStyle = "#ffffff";
    cropCtx.fillRect(0, 0, crop.width, crop.height);
    cropCtx.imageSmoothingEnabled = true;
    cropCtx.imageSmoothingQuality = "high";
    cropCtx.drawImage(video, sx, sy, sw, sh, pad, pad, dw, dh);
    return crop;
  }

  function collectNative(codes: Awaited<ReturnType<NativeDetector["detect"]>>, vw: number, vh: number) {
    const hits: ScanHit[] = [];
    for (const c of codes) {
      if (!c.rawValue?.trim()) continue;
      const pts = c.cornerPoints || [];
      hits.push({
        text: c.rawValue,
        format: formatOf(c.format),
        box:
          boxFromPoints(pts, vw, vh) ||
          boxFromRect(
            { x: c.boundingBox.x, y: c.boundingBox.y, width: c.boundingBox.width, height: c.boundingBox.height },
            vw,
            vh,
          ),
      });
    }
    return hits;
  }

  async function decodeFrame(video: HTMLVideoElement): Promise<{ hit: ScanHit | null; hints: ScanHint[] }> {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || !workCtx || !cropCtx) return { hit: null, hints: [] };
    pass += 1;

    const scale = Math.min(1, 720 / vw);
    work.width = Math.max(32, Math.round(vw * scale));
    work.height = Math.max(32, Math.round(vh * scale));
    workCtx.drawImage(video, 0, 0, work.width, work.height);
    const image = workCtx.getImageData(0, 0, work.width, work.height);
    const gray = toGray(image.data, work.width, work.height, false);
    const small = downGray(gray, work.width, work.height, 320);
    const qrBoxes = findQrHints(small.gray, small.w, small.h);
    const pdfHint = qrBoxes.length ? null : findPdf417Hint(small.gray, small.w, small.h);
    const hints: ScanHint[] = [...qrBoxes];
    if (pdfHint) hints.push(pdfHint);

    let leftover: ScanHit | null = null;
    const take = (hit: ScanHit) => {
      if (looksLikeDni(hit.text)) return true;
      leftover = leftover || hit;
      return false;
    };

    if (detector) {
      try {
        for (const hit of collectNative(await detector.detect(video), vw, vh)) {
          if (take(hit)) return { hit, hints };
        }
      } catch {
        /* ZXing */
      }
    }

    const lib = await loadZxing();
    if (!qrReader || !pdfReader) return { hit: leftover, hints };

    // El PDF417 del DNI necesita el recorte a resolución nativa: a 720 px de frame no quedan módulos legibles.
    if (!qrBoxes.length && pdfHint) {
      const hit = tryPdf(lib, video, [pdfHint, grow(pdfHint, 0.08, 0.12)]);
      if (hit && take(hit)) return { hit, hints };
    }

    const crops: ScanBox[] = qrBoxes.length
      ? [...qrBoxes, { x: 0, y: 0, w: 1, h: 1 }]
      : pdfHint || pass % 2 === 0
        ? []
        : [
            { x: 0.08, y: 0.02, w: 0.84, h: 0.7 },
            { x: 0, y: 0, w: 1, h: 1 },
          ];

    for (const box of crops) {
      const canvas = paintCrop(video, box);
      if (!canvas) continue;
      if (detector) {
        try {
          for (const hit of collectNative(await detector.detect(canvas), canvas.width, canvas.height)) {
            const mapped = { ...hit, box };
            if (take(mapped)) return { hit: mapped, hints };
          }
        } catch {
          /* ZXing */
        }
      }
      try {
        const CanvasSource = lib.HTMLCanvasElementLuminanceSource;
        const source = CanvasSource
          ? new CanvasSource(canvas)
          : new lib.RGBLuminanceSource(
              toGray(cropCtx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height),
              canvas.width,
              canvas.height,
            );
        const result = decodeQrSource(lib, source) as ZxingResult | null;
        if (result?.getText()) {
          const hit: ScanHit = { text: result.getText(), format: "qr", box };
          if (take(hit)) return { hit, hints };
        }
      } catch {
        /* recorte siguiente */
      }
    }

    if (!qrBoxes.length && !pdfHint && pass % 2 === 0) {
      const hit = tryPdf(lib, video, [
        { x: 0.04, y: 0.22, w: 0.92, h: 0.56 },
        { x: 0.04, y: 0.5, w: 0.92, h: 0.46 },
        { x: 0, y: 0, w: 1, h: 1 },
      ]);
      if (hit && take(hit)) return { hit, hints };
    }

    return { hit: leftover, hints };
  }

  function grow(box: ScanBox, px: number, py: number): ScanBox {
    const x = clamp(box.x - px, 0, 1);
    const y = clamp(box.y - py, 0, 1);
    return { x, y, w: clamp(box.w + px * 2, 0, 1 - x), h: clamp(box.h + py * 2, 0, 1 - y) };
  }

  /** Recorte a resolución nativa del video (hasta 1400 px de ancho, sube chicos x2). */
  function grayFromVideo(video: HTMLVideoElement, box: ScanBox, boost: boolean) {
    if (!pdfCtx) return null;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const sx = box.x * vw;
    const sy = box.y * vh;
    const sw = Math.max(24, box.w * vw);
    const sh = Math.max(16, box.h * vh);
    const scale = clamp(1400 / sw, 0.5, 2);
    const dw = Math.max(48, Math.round(sw * scale));
    const dh = Math.max(24, Math.round(sh * scale));
    pdfCanvas.width = dw;
    pdfCanvas.height = dh;
    pdfCtx.imageSmoothingEnabled = true;
    pdfCtx.imageSmoothingQuality = "high";
    pdfCtx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
    const data = pdfCtx.getImageData(0, 0, dw, dh).data;
    return { gray: toGray(data, dw, dh, boost), w: dw, h: dh };
  }

  function tryPdf(lib: ZxingBundle, video: HTMLVideoElement, boxes: ScanBox[]): ScanHit | null {
    if (!pdfReader) return null;
    for (const box of boxes) {
      for (const boost of [false, true]) {
        const piece = grayFromVideo(video, box, boost);
        if (!piece) continue;
        const source = new lib.RGBLuminanceSource(piece.gray, piece.w, piece.h);
        for (const Binarizer of [lib.HybridBinarizer, lib.GlobalHistogramBinarizer]) {
          try {
            const result = pdfReader.decode(new lib.BinaryBitmap(new Binarizer(source)), pdfHints as never);
            if (result?.getText()) return { text: result.getText(), format: "pdf417", box };
          } catch {
            /* siguiente intento */
          }
        }
      }
    }
    return null;
  }

  return { decodeFrame, hasNativeDetector: Boolean(detector) };
}
