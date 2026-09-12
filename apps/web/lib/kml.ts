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

function deepText(el: Element, name: string): string {
  const hit = [...el.getElementsByTagName("*")].find((n) => localName(n) === name.toLowerCase());
  return (hit?.textContent ?? "").trim();
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

function geometriesFrom(el: Element, name: string): OverlayFeature[] {
  const out: OverlayFeature[] = [];
  for (const node of [...el.getElementsByTagName("*")]) {
    const tag = localName(node);
    if (tag === "polygon") {
      const coordEl = [...node.getElementsByTagName("*")].find((n) => localName(n) === "coordinates");
      const ring = closeRing(parseCoords(coordEl?.textContent ?? ""));
      if (ring.length >= 4) {
        out.push({ id: nid(), name, kind: "polygon", geometry: { type: "Polygon", coordinates: [ring] } });
      }
    } else if (tag === "linestring") {
      const coordEl = [...node.getElementsByTagName("*")].find((n) => localName(n) === "coordinates");
      const line = parseCoords(coordEl?.textContent ?? "");
      if (line.length >= 2) {
        out.push({ id: nid(), name, kind: "line", geometry: { type: "LineString", coordinates: line } });
      }
    } else if (tag === "point") {
      const coordEl = [...node.getElementsByTagName("*")].find((n) => localName(n) === "coordinates");
      const pt = parseCoords(coordEl?.textContent ?? "")[0];
      if (pt) {
        out.push({ id: nid(), name, kind: "point", geometry: { type: "Point", coordinates: pt } });
      }
    }
  }
  return out;
}

function walk(el: Element, layerName: string, source: string, layers: OverlayLayer[]) {
  for (const child of [...el.children]) {
    const tag = localName(child);
    if (tag === "document" || tag === "folder") {
      walk(child, deepText(child, "name") || layerName, source, layers);
    } else if (tag === "placemark") {
      const name = deepText(child, "name") || layerName;
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
  const rootName = deepText(root, "name") || source.replace(/\.(kml|kmz)$/i, "") || "Capa KML";
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
  return buf[off]! | (buf[off + 1]! << 8) | (buf[off + 2]! << 16) | (buf[off + 3]! << 24);
}

function readU16(buf: Uint8Array, off: number) {
  return buf[off]! | (buf[off + 1]! << 8);
}

async function inflateRaw(data: Uint8Array) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("Este navegador no puede abrir KMZ. Exportá el archivo como KML.");
  }
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  return out;
}

async function extractKmlFromKmz(buf: Uint8Array): Promise<string> {
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("El KMZ no es un ZIP válido");
  let off = 0;
  const files: { name: string; data: Uint8Array }[] = [];
  while (off + 30 <= buf.length && readU32(buf, off) === 0x04034b50) {
    const method = readU16(buf, off + 8);
    const comp = readU32(buf, off + 18) >>> 0;
    const nameLen = readU16(buf, off + 26);
    const extraLen = readU16(buf, off + 28);
    const name = new TextDecoder("utf-8").decode(buf.subarray(off + 30, off + 30 + nameLen));
    const start = off + 30 + nameLen + extraLen;
    const blob = buf.subarray(start, start + comp);
    off = start + comp;
    let data = blob;
    if (method === 8) data = await inflateRaw(blob);
    else if (method !== 0) continue;
    files.push({ name, data });
  }
  const kml =
    files.find((f) => /doc\.kml$/i.test(f.name)) ||
    files.find((f) => /\.kml$/i.test(f.name));
  if (!kml) throw new Error("El KMZ no incluye un archivo KML");
  return new TextDecoder("utf-8").decode(kml.data);
}

export async function readKmlFile(file: File): Promise<OverlayLayer[]> {
  if (file.size > 8 * 1024 * 1024) throw new Error("El archivo supera 8 MB");
  const buf = new Uint8Array(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  const xml =
    name.endsWith(".kmz") || (buf[0] === 0x50 && buf[1] === 0x4b)
      ? await extractKmlFromKmz(buf)
      : new TextDecoder("utf-8").decode(buf);
  return parseKml(xml, file.name);
}
