export type OverlayKind = "polygon" | "line" | "point";

export type OverlayGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "LineString"; coordinates: number[][] }
  | { type: "Point"; coordinates: number[] };

export type OverlayFeature = {
  id: string;
  name: string;
  kind: OverlayKind;
  geometry: OverlayGeometry;
};

export type OverlayLayer = {
  id: string;
  name: string;
  source: string;
  visible: boolean;
  features: OverlayFeature[];
};

function nid() {
  return crypto.randomUUID();
}

function localName(el: Element) {
  return (el.localName || el.tagName).toLowerCase();
}

function childText(el: Element, name: string): string {
  for (const c of el.children) {
    if (localName(c) === name.toLowerCase()) return (c.textContent ?? "").trim();
  }
  return "";
}

function ancestorIs(node: Element, tag: string) {
  let p = node.parentElement;
  while (p) {
    if (localName(p) === tag) return true;
    p = p.parentElement;
  }
  return false;
}

function parseCoords(raw: string): number[][] {
  return raw
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [lng, lat] = pair.split(",").map((n) => Number(n));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return [lng, lat];
    })
    .filter((pt): pt is number[] => Boolean(pt));
}

function closeRing(ring: number[][]): number[][] {
  if (ring.length < 3) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) return [...ring, first];
  return ring;
}

function firstCoordinates(node: Element): string {
  const hit = [...node.getElementsByTagName("*")].find((n) => localName(n) === "coordinates");
  return hit?.textContent ?? "";
}

function geometriesFrom(el: Element, name: string): OverlayFeature[] {
  const out: OverlayFeature[] = [];
  for (const node of [...el.getElementsByTagName("*")]) {
    const tag = localName(node);
    if (tag === "polygon") {
      const ring = closeRing(parseCoords(firstCoordinates(node)));
      if (ring.length >= 4) {
        out.push({ id: nid(), name, kind: "polygon", geometry: { type: "Polygon", coordinates: [ring] } });
      }
    } else if (tag === "linestring") {
      const line = parseCoords(firstCoordinates(node));
      if (line.length >= 2) {
        out.push({ id: nid(), name, kind: "line", geometry: { type: "LineString", coordinates: line } });
      }
    } else if (tag === "point") {
      const pt = parseCoords(firstCoordinates(node))[0];
      if (pt) {
        out.push({ id: nid(), name, kind: "point", geometry: { type: "Point", coordinates: pt } });
      }
    } else if (tag === "linearring" && !ancestorIs(node, "polygon") && !ancestorIs(node, "linestring")) {
      const ring = closeRing(parseCoords(firstCoordinates(node) || node.textContent || ""));
      if (ring.length >= 4) {
        out.push({ id: nid(), name, kind: "polygon", geometry: { type: "Polygon", coordinates: [ring] } });
      }
    } else if (tag === "latlonquad") {
      const ring = closeRing(parseCoords(firstCoordinates(node) || node.textContent || ""));
      if (ring.length >= 4) {
        out.push({ id: nid(), name, kind: "polygon", geometry: { type: "Polygon", coordinates: [ring] } });
      }
    }
  }
  return out;
}

function walk(el: Element, layerName: string, source: string, layers: OverlayLayer[]) {
  for (const child of [...el.children]) {
    const tag = localName(child);
    if (tag === "document" || tag === "folder") {
      walk(child, childText(child, "name") || layerName, source, layers);
    } else if (tag === "placemark") {
      const name = childText(child, "name") || layerName;
      const features = geometriesFrom(child, name);
      if (!features.length) continue;
      let layer = layers.find((l) => l.name === layerName);
      if (!layer) {
        layer = { id: nid(), name: layerName, source, visible: true, features: [] };
        layers.push(layer);
      }
      layer.features.push(...features);
    }
  }
}

export function parseKml(xml: string, source = "archivo.kml"): OverlayLayer[] {
  const doc = new DOMParser().parseFromString(xml.replace(/^\uFEFF/, ""), "text/xml");
  if (doc.querySelector("parsererror")) throw new Error("El KML está mal formado");
  const root = doc.documentElement;
  if (!root) throw new Error("KML vacío");
  const layers: OverlayLayer[] = [];
  const rootName = childText(root, "name") || source.replace(/\.(kml|kmz)$/i, "") || "Capa KML";
  walk(root, rootName, source, layers);
  if (!layers.length) {
    const loose = geometriesFrom(root, rootName);
    if (loose.length) layers.push({ id: nid(), name: rootName, source, visible: true, features: loose });
  }
  if (!layers.length) throw new Error("El archivo no tiene polígonos, líneas ni puntos");
  return layers;
}

export function overlayStats(layers: OverlayLayer[]) {
  let polygons = 0;
  let lines = 0;
  let points = 0;
  for (const layer of layers) {
    for (const f of layer.features) {
      if (f.kind === "polygon") polygons += 1;
      else if (f.kind === "line") lines += 1;
      else points += 1;
    }
  }
  return { layers: layers.length, polygons, lines, points };
}

export function overlayBounds(layers: OverlayLayer[]): { lat: number; lng: number }[] {
  const pts: { lat: number; lng: number }[] = [];
  for (const layer of layers) {
    for (const f of layer.features) {
      if (f.geometry.type === "Point") {
        pts.push({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] });
      } else if (f.geometry.type === "LineString") {
        for (const c of f.geometry.coordinates) pts.push({ lng: c[0], lat: c[1] });
      } else {
        for (const c of f.geometry.coordinates[0] ?? []) pts.push({ lng: c[0], lat: c[1] });
      }
    }
  }
  return pts.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

export function lotNumberFromName(name: string, used: Set<string>, fallback: string) {
  const m = name.match(/(\d+[A-Za-z]?)\s*$/) || name.match(/(\d+[A-Za-z]?)/);
  const raw = (m?.[1] || "").trim();
  const candidate = raw && !used.has(raw.toLowerCase()) ? raw : fallback;
  used.add(candidate.toLowerCase());
  return candidate;
}

function readU32(buf: Uint8Array, off: number) {
  return (buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16) | (buf[off + 3]! << 24)) >>> 0;
}

function readU16(buf: Uint8Array, off: number) {
  return buf[off]! | (buf[off + 1]! << 8);
}

async function inflateBytes(data: Uint8Array, format: "deflate-raw" | "deflate") {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Este navegador no puede abrir KMZ. Exportá el archivo como KML.");
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateZip(data: Uint8Array) {
  try {
    return await inflateBytes(data, "deflate-raw");
  } catch {
    return await inflateBytes(data, "deflate");
  }
}

function decodeXmlBytes(buf: Uint8Array) {
  const head = new TextDecoder("utf-8").decode(buf.subarray(0, 240));
  const enc = /encoding=["']([^"']+)/i.exec(head)?.[1]?.toLowerCase();
  if (enc && enc !== "utf-8" && enc !== "utf8") {
    try {
      return new TextDecoder(enc).decode(buf);
    } catch {
      /* latin1 / windows-1252 suelen fallar en TextDecoder */
    }
  }
  return new TextDecoder("utf-8").decode(buf);
}

function findEocd(buf: Uint8Array) {
  const min = 22;
  const maxScan = Math.min(buf.length, 22 + 65535);
  for (let i = buf.length - min; i >= buf.length - maxScan; i--) {
    if (readU32(buf, i) === 0x06054b50) return i;
  }
  return -1;
}

async function unzipEntries(buf: Uint8Array): Promise<{ name: string; data: Uint8Array }[]> {
  const files: { name: string; data: Uint8Array }[] = [];
  const eocd = findEocd(buf);
  if (eocd >= 0) {
    const cdEntries = readU16(buf, eocd + 10);
    const cdOff = readU32(buf, eocd + 16);
    if (cdOff === 0xffffffff || cdEntries === 0xffff) {
      throw new Error("El KMZ es ZIP64; exportalo como KML.");
    }
    let off = cdOff;
    for (let i = 0; i < cdEntries && off + 46 <= buf.length; i++) {
      if (readU32(buf, off) !== 0x02014b50) break;
      const method = readU16(buf, off + 10);
      const comp = readU32(buf, off + 20);
      const nameLen = readU16(buf, off + 28);
      const extraLen = readU16(buf, off + 30);
      const commentLen = readU16(buf, off + 32);
      const localOff = readU32(buf, off + 42);
      const name = new TextDecoder("utf-8").decode(buf.subarray(off + 46, off + 46 + nameLen));
      off += 46 + nameLen + extraLen + commentLen;
      if (readU32(buf, localOff) !== 0x04034b50) continue;
      const locNameLen = readU16(buf, localOff + 26);
      const locExtraLen = readU16(buf, localOff + 28);
      const localComp = readU32(buf, localOff + 18);
      const size = comp || localComp;
      const start = localOff + 30 + locNameLen + locExtraLen;
      const blob = buf.subarray(start, start + size);
      try {
        const data = method === 8 ? await inflateZip(blob) : method === 0 ? blob : null;
        if (data) files.push({ name, data });
      } catch {
        /* archivo interno dañado: seguir con el resto */
      }
    }
    if (files.length) return files;
  }

  let off = 0;
  while (off + 30 <= buf.length && readU32(buf, off) === 0x04034b50) {
    const method = readU16(buf, off + 8);
    const flags = readU16(buf, off + 6);
    const comp = readU32(buf, off + 18);
    const nameLen = readU16(buf, off + 26);
    const extraLen = readU16(buf, off + 28);
    const name = new TextDecoder("utf-8").decode(buf.subarray(off + 30, off + 30 + nameLen));
    const start = off + 30 + nameLen + extraLen;
    if ((flags & 0x8) !== 0 && !comp) break;
    const blob = buf.subarray(start, start + comp);
    off = start + comp;
    try {
      const data = method === 8 ? await inflateZip(blob) : method === 0 ? blob : null;
      if (data) files.push({ name, data });
    } catch {
      /* seguir */
    }
  }
  return files;
}

async function extractKmlFromKmz(buf: Uint8Array): Promise<string> {
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("El KMZ no es un ZIP válido");
  const files = await unzipEntries(buf);
  const kml =
    files.find((f) => /(?:^|\/)doc\.kml$/i.test(f.name)) || files.find((f) => /\.kml$/i.test(f.name));
  if (!kml) throw new Error("El KMZ no incluye un archivo KML");
  return decodeXmlBytes(kml.data);
}

export async function readKmlFile(file: File): Promise<OverlayLayer[]> {
  if (file.size > 32 * 1024 * 1024) throw new Error("El archivo supera 32 MB");
  const buf = new Uint8Array(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  const xml =
    name.endsWith(".kmz") || (buf[0] === 0x50 && buf[1] === 0x4b)
      ? await extractKmlFromKmz(buf)
      : decodeXmlBytes(buf);
  return parseKml(xml, file.name);
}
