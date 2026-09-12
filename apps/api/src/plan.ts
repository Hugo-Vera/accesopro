import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthUser } from "./auth.js";
import { requireAuth } from "./auth.js";
import { db } from "./db/client.js";
import {
  ownerProfiles,
  properties,
  propertyFamilyMembers,
  propertyServices,
  sites,
  visitAuthorizations,
  visitPasses,
  visitRecords,
} from "./db/schema.js";
import { denyUnlessCapability, userHasCapability } from "./grants.js";
import { nid, scopedSite } from "./scope.js";

type Env = { Variables: { user: AuthUser } };

export const planApi = new Hono<Env>();
planApi.use("*", requireAuth);

const DEFAULT_VIEW = { mapLat: "-34.6037", mapLng: "-58.3816", mapZoom: 16 };

function canEditRole(user: AuthUser) {
  return user.role === "platform_admin" || user.role === "tenant_admin";
}

function parsePolygon(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const coords = (parsed as { coordinates?: unknown })?.coordinates;
  const ring = Array.isArray(coords) ? coords[0] : null;
  if (!Array.isArray(ring) || ring.length < 4) return null;
  const clean = ring
    .map((pt) => {
      if (!Array.isArray(pt) || pt.length < 2) return null;
      const lng = Number(pt[0]);
      const lat = Number(pt[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return [lng, lat];
    })
    .filter((pt): pt is number[] => Boolean(pt));
  if (clean.length < 4) return null;
  return JSON.stringify({ type: "Polygon", coordinates: [clean] });
}

function nextLotNumber(existing: string[]): string {
  const nums = existing.map((n) => Number.parseInt(n, 10)).filter((n) => Number.isFinite(n) && n > 0);
  return String((nums.length ? Math.max(...nums) : 0) + 1);
}

type OverlayIn = {
  id?: string;
  name?: string;
  source?: string;
  visible?: boolean;
  features?: {
    id?: string;
    name?: string;
    kind?: string;
    geometry?: { type?: string; coordinates?: unknown };
  }[];
};

function sanitizeOverlays(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  const layers = raw
    .slice(0, 40)
    .map((layer) => {
      const l = layer as OverlayIn;
      const features = (Array.isArray(l.features) ? l.features : [])
        .slice(0, 400)
        .map((f) => {
          const kind = f.kind === "line" || f.kind === "point" || f.kind === "polygon" ? f.kind : null;
          const type = f.geometry?.type;
          const coords = f.geometry?.coordinates;
          if (!kind || !type || coords == null) return null;
          if (kind === "polygon" && type !== "Polygon") return null;
          if (kind === "line" && type !== "LineString") return null;
          if (kind === "point" && type !== "Point") return null;
          return {
            id: String(f.id || nid()),
            name: String(f.name || "").trim() || "Sin nombre",
            kind,
            geometry: { type, coordinates: coords },
          };
        })
        .filter((f): f is NonNullable<typeof f> => Boolean(f));
      if (!features.length) return null;
      return {
        id: String(l.id || nid()),
        name: String(l.name || "").trim() || "Capa KML",
        source: String(l.source || "").trim() || "kml",
        visible: l.visible !== false,
        features,
      };
    })
    .filter((l): l is NonNullable<typeof l> => Boolean(l));
  return JSON.stringify(layers);
}

function readOverlays(raw: string | null | undefined) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    const json = sanitizeOverlays(parsed);
    return json ? (JSON.parse(json) as unknown[]) : [];
  } catch {
    return [];
  }
}

planApi.get("/plan", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "ops.plano");
  if (denied) return denied;
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const user = c.get("user");
  const canEdit = canEditRole(user) || (await userHasCapability(user, "core.config"));
  const rows = await db.select().from(properties).where(eq(properties.siteId, scoped.site.id));
  return c.json({
    canEdit,
    view: {
      mapLat: scoped.site.mapLat || DEFAULT_VIEW.mapLat,
      mapLng: scoped.site.mapLng || DEFAULT_VIEW.mapLng,
      mapZoom: scoped.site.mapZoom || DEFAULT_VIEW.mapZoom,
      saved: Boolean(scoped.site.mapLat && scoped.site.mapLng),
    },
    overlays: readOverlays(scoped.site.mapOverlays),
    lots: rows.map((r) => ({
      id: r.id,
      lotNumber: r.lotNumber,
      label: r.label,
      address: r.address,
      mapLat: r.mapLat,
      mapLng: r.mapLng,
      lotPolygon: r.lotPolygon,
    })),
  });
});

planApi.patch("/plan/view", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "ops.plano");
  if (denied) return denied;
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const user = c.get("user");
  if (!canEditRole(user) && !(await userHasCapability(user, "core.config"))) {
    return c.json({ error: "Solo administración puede guardar la vista del plano" }, 403);
  }
  const body = await c.req.json<{ mapLat?: string; mapLng?: string; mapZoom?: number }>();
  const mapLat = String(body.mapLat ?? "").trim();
  const mapLng = String(body.mapLng ?? "").trim();
  const mapZoom = Number(body.mapZoom);
  if (!mapLat || !mapLng || !Number.isFinite(Number(mapLat)) || !Number.isFinite(Number(mapLng))) {
    return c.json({ error: "Coordenadas inválidas" }, 400);
  }
  await db
    .update(sites)
    .set({
      mapLat,
      mapLng,
      mapZoom: Number.isFinite(mapZoom) ? Math.max(3, Math.min(20, Math.round(mapZoom))) : scoped.site.mapZoom,
    })
    .where(eq(sites.id, scoped.site.id));
  return c.json({ ok: true });
});

planApi.get("/plan/search", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "ops.plano");
  if (denied) return denied;
  const q = String(c.req.query("q") || "").trim();
  if (q.length < 3) return c.json({ results: [] });
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("q", q);
  url.searchParams.set("countrycodes", "ar");
  url.searchParams.set("limit", "6");
  url.searchParams.set("addressdetails", "0");
  const res = await fetch(url, {
    headers: {
      "User-Agent": "AccesoPro/0.2 (plano del predio; https://github.com/Hugo-Vera/accesopro)",
      "Accept-Language": "es-AR,es",
    },
  });
  if (!res.ok) return c.json({ error: "No se pudo buscar en OpenStreetMap" }, 502);
  const rows = (await res.json()) as { display_name?: string; lat?: string; lon?: string }[];
  return c.json({
    results: rows
      .filter((r) => r.lat && r.lon)
      .map((r) => ({
        label: r.display_name || `${r.lat}, ${r.lon}`,
        lat: r.lat,
        lng: r.lon,
      })),
  });
});

planApi.post("/plan/lots", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "ops.plano");
  if (denied) return denied;
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const user = c.get("user");
  if (!canEditRole(user) && !(await userHasCapability(user, "core.config"))) {
    return c.json({ error: "Solo administración puede dibujar lotes" }, 403);
  }
  const body = await c.req.json<{
    lotNumber?: string;
    label?: string;
    address?: string;
    mapLat?: string | null;
    mapLng?: string | null;
    lotPolygon?: unknown;
  }>();
  const existing = await db.select().from(properties).where(eq(properties.siteId, scoped.site.id));
  const lotNumber = String(body.lotNumber ?? "").trim() || nextLotNumber(existing.map((r) => r.lotNumber));
  const label = String(body.label ?? "").trim() || `Lote ${lotNumber}`;
  if (existing.some((r) => r.lotNumber.toLowerCase() === lotNumber.toLowerCase())) {
    return c.json({ error: `Ya existe el lote ${lotNumber}` }, 409);
  }
  const id = nid();
  await db.insert(properties).values({
    id,
    tenantId: scoped.tenantId,
    siteId: scoped.site.id,
    lotNumber,
    label,
    address: body.address?.trim() || null,
    mapLat: body.mapLat?.toString().trim() || null,
    mapLng: body.mapLng?.toString().trim() || null,
    lotPolygon: parsePolygon(body.lotPolygon),
    createdAt: new Date(),
  });
  return c.json({ ok: true, id, lotNumber });
});

planApi.patch("/plan/lots/:id", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "ops.plano");
  if (denied) return denied;
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const user = c.get("user");
  if (!canEditRole(user) && !(await userHasCapability(user, "core.config"))) {
    return c.json({ error: "Solo administración puede editar el plano" }, 403);
  }
  const row = await db
    .select()
    .from(properties)
    .where(and(eq(properties.id, c.req.param("id")), eq(properties.siteId, scoped.site.id)))
    .get();
  if (!row) return c.json({ error: "Lote no encontrado" }, 404);
  const body = await c.req.json<Record<string, unknown>>();
  await db
    .update(properties)
    .set({
      lotNumber: body.lotNumber !== undefined ? String(body.lotNumber).trim() || row.lotNumber : row.lotNumber,
      label: body.label !== undefined ? String(body.label).trim() || row.label : row.label,
      address: body.address !== undefined ? String(body.address || "").trim() || null : row.address,
      mapLat: body.mapLat !== undefined ? String(body.mapLat || "").trim() || null : row.mapLat,
      mapLng: body.mapLng !== undefined ? String(body.mapLng || "").trim() || null : row.mapLng,
      lotPolygon: body.lotPolygon !== undefined ? parsePolygon(body.lotPolygon) : row.lotPolygon,
    })
    .where(eq(properties.id, row.id));
  return c.json({ ok: true });
});

planApi.delete("/plan/lots/:id", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "ops.plano");
  if (denied) return denied;
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const user = c.get("user");
  if (!canEditRole(user) && !(await userHasCapability(user, "core.config"))) {
    return c.json({ error: "Solo administración puede eliminar lotes del plano" }, 403);
  }
  const row = await db
    .select()
    .from(properties)
    .where(and(eq(properties.id, c.req.param("id")), eq(properties.siteId, scoped.site.id)))
    .get();
  if (!row) return c.json({ error: "Lote no encontrado" }, 404);

  const linked = await Promise.all([
    db.select({ id: ownerProfiles.id }).from(ownerProfiles).where(eq(ownerProfiles.propertyId, row.id)).limit(1),
    db
      .select({ id: propertyFamilyMembers.id })
      .from(propertyFamilyMembers)
      .where(eq(propertyFamilyMembers.propertyId, row.id))
      .limit(1),
    db.select({ id: propertyServices.id }).from(propertyServices).where(eq(propertyServices.propertyId, row.id)).limit(1),
    db
      .select({ id: visitAuthorizations.id })
      .from(visitAuthorizations)
      .where(eq(visitAuthorizations.propertyId, row.id))
      .limit(1),
    db.select({ id: visitPasses.id }).from(visitPasses).where(eq(visitPasses.propertyId, row.id)).limit(1),
    db.select({ id: visitRecords.id }).from(visitRecords).where(eq(visitRecords.propertyId, row.id)).limit(1),
  ]);
  if (linked.some((rows) => rows.length > 0)) {
    return c.json(
      {
        error:
          "No se puede eliminar: el lote tiene propietario, grupo familiar, servicios o visitas. Sacalos primero desde Propiedades.",
      },
      409,
    );
  }

  await db.delete(properties).where(eq(properties.id, row.id));
  return c.json({ ok: true });
});

planApi.put("/plan/overlays", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "ops.plano");
  if (denied) return denied;
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const user = c.get("user");
  if (!canEditRole(user) && !(await userHasCapability(user, "core.config"))) {
    return c.json({ error: "Solo administración puede importar capas al plano" }, 403);
  }
  const body = await c.req.json<{ overlays?: unknown }>();
  const json = sanitizeOverlays(body.overlays);
  if (json && json.length > 2_000_000) return c.json({ error: "Las capas pesan demasiado" }, 413);
  await db.update(sites).set({ mapOverlays: json }).where(eq(sites.id, scoped.site.id));
  return c.json({ ok: true, overlays: json ? JSON.parse(json) : [] });
});

planApi.post("/plan/lots/import", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "ops.plano");
  if (denied) return denied;
  const scoped = await scopedSite(c);
  if ("error" in scoped) return scoped.error;
  const user = c.get("user");
  if (!canEditRole(user) && !(await userHasCapability(user, "core.config"))) {
    return c.json({ error: "Solo administración puede importar lotes" }, 403);
  }
  const body = await c.req.json<{
    lots?: {
      lotNumber?: string;
      label?: string;
      lotPolygon?: unknown;
      mapLat?: string | null;
      mapLng?: string | null;
    }[];
  }>();
  const incoming = Array.isArray(body.lots) ? body.lots.slice(0, 400) : [];
  if (!incoming.length) return c.json({ error: "No hay polígonos para importar" }, 400);
  const existing = await db.select().from(properties).where(eq(properties.siteId, scoped.site.id));
  const used = new Set(existing.map((r) => r.lotNumber.toLowerCase()));
  let created = 0;
  let skipped = 0;
  for (const item of incoming) {
    const polygon = parsePolygon(item.lotPolygon);
    if (!polygon) {
      skipped += 1;
      continue;
    }
    let lotNumber = String(item.lotNumber ?? "").trim();
    if (lotNumber && used.has(lotNumber.toLowerCase())) {
      skipped += 1;
      continue;
    }
    if (!lotNumber) lotNumber = nextLotNumber([...used]);
    used.add(lotNumber.toLowerCase());
    const label = String(item.label ?? "").trim() || `Lote ${lotNumber}`;
    await db.insert(properties).values({
      id: nid(),
      tenantId: scoped.tenantId,
      siteId: scoped.site.id,
      lotNumber,
      label,
      mapLat: item.mapLat?.toString().trim() || null,
      mapLng: item.mapLng?.toString().trim() || null,
      lotPolygon: polygon,
      createdAt: new Date(),
    });
    created += 1;
  }
  return c.json({ ok: true, created, skipped });
});
