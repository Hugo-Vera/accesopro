import { and, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "./db/client.js";
import {
  ownerProfiles,
  properties,
  users,
  visitCompanions,
  visitPasses,
} from "./db/schema.js";
import type { AuthUser } from "./auth.js";
import { denyUnlessCapability } from "./grants.js";
import { scopedSiteWithModule } from "./scope.js";
import { companionIsMinor } from "./age.js";
import { tenantFeatureEnabled } from "./features.js";

type Env = { Variables: { user: AuthUser } };

export const censusApi = new Hono<Env>();

const ONSITE = ["in_site", "awaiting_exit"] as const;

export async function siteCensus(siteId: string) {
  const lots = await db.select().from(properties).where(eq(properties.siteId, siteId));
  const passes = await db
    .select()
    .from(visitPasses)
    .where(and(eq(visitPasses.siteId, siteId), inArray(visitPasses.status, [...ONSITE])));

  const companions = passes.length
    ? await db
        .select()
        .from(visitCompanions)
        .where(inArray(visitCompanions.passId, passes.map((p) => p.id)))
    : [];
  const companionsByPass = new Map<string, typeof companions>();
  for (const c of companions) {
    const list = companionsByPass.get(c.passId) ?? [];
    list.push(c);
    companionsByPass.set(c.passId, list);
  }

  const profiles = await db.select().from(ownerProfiles);
  const userRows = await db.select().from(users);
  const userById = new Map(userRows.map((u) => [u.id, u]));

  const byLot = lots
    .map((lot) => {
      const lotPasses = passes.filter((p) => p.propertyId === lot.id);
      let adults = 0;
      let minors = 0;
      const guests: {
        passId: string;
        name: string;
        dni: string | null;
        patente: string | null;
        adults: number;
        minors: number;
        companions: { name: string; dni: string | null; minor: boolean }[];
      }[] = [];
      for (const p of lotPasses) {
        // Solo cuenta quien está adentro: los que salieron (definitiva o sale y vuelve) no.
        const comps = (companionsByPass.get(p.id) ?? []).filter((x) => (x.presence ?? "in") === "in");
        const minorComps = comps.filter((x) => companionIsMinor(x));
        const adultComps = comps.filter((x) => !companionIsMinor(x));
        const guestIn = (p.guestPresence ?? "in") === "in";
        const a = (guestIn ? 1 : 0) + adultComps.length;
        const m = Math.max(p.minorsInCount ?? 0, minorComps.length);
        if (!a && !m) continue;
        adults += a;
        minors += m;
        guests.push({
          passId: p.id,
          name: p.guestName,
          dni: p.guestDni,
          patente: p.patente,
          adults: a,
          minors: m,
          companions: comps.map((x) => ({
            name: x.name,
            dni: x.dni,
            minor: companionIsMinor(x),
          })),
        });
      }
      const owners = profiles.filter((o) => o.propertyId === lot.id);
      const phones = owners.flatMap((o) => {
        const u = userById.get(o.userId);
        return [
          o.phone || o.whatsapp || null,
          o.emergencyPhone || null,
          u?.email || null,
        ].filter(Boolean) as string[];
      });
      return {
        propertyId: lot.id,
        lotNumber: lot.lotNumber,
        label: lot.label,
        occupants: adults + minors,
        adults,
        minors,
        guests,
        ownerName: owners[0]?.fullName || userById.get(owners[0]?.userId || "")?.name || null,
        phone: owners[0]?.phone || owners[0]?.whatsapp || null,
        emergencyPhone: owners[0]?.emergencyPhone || null,
        emergencyName: owners[0]?.emergencyName || null,
        phones: [...new Set(phones)],
      };
    })
    .filter((row) => row.occupants > 0)
    .sort((a, b) => a.lotNumber.localeCompare(b.lotNumber, "es", { numeric: true }));

  const adults = byLot.reduce((n, r) => n + r.adults, 0);
  const minors = byLot.reduce((n, r) => n + r.minors, 0);
  return {
    generatedAt: Date.now(),
    lotsWithPeople: byLot.length,
    adults,
    minors,
    total: adults + minors,
    lots: byLot,
  };
}

censusApi.get("/census", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "ops.census");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  if (!(await tenantFeatureEnabled(scoped.site.tenantId, "visitors.census"))) {
    return c.json({ error: "El censo no está habilitado en este barrio" }, 403);
  }
  return c.json({ ok: true, ...(await siteCensus(scoped.site.id)) });
});

censusApi.get("/census/export", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "ops.census");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  if (!(await tenantFeatureEnabled(scoped.site.tenantId, "visitors.census"))) {
    return c.json({ error: "El censo no está habilitado en este barrio" }, 403);
  }
  const data = await siteCensus(scoped.site.id);
  const when = new Date(data.generatedAt).toLocaleString("es-AR");
  const rows = data.lots
    .map((lot) => {
      const guests = lot.guests
        .map(
          (g) =>
            `${esc(g.name)}${g.dni ? ` (DNI ${esc(g.dni)})` : ""}${g.patente ? ` · ${esc(g.patente)}` : ""} — ${g.adults} adulto(s), ${g.minors} menor(es)`,
        )
        .join("<br/>");
      return `<tr>
        <td>${esc(lot.lotNumber)}</td>
        <td>${esc(lot.label)}</td>
        <td>${lot.adults}</td>
        <td>${lot.minors}</td>
        <td>${esc(lot.ownerName || "—")}</td>
        <td>${esc(lot.phone || "—")}</td>
        <td>${esc(lot.emergencyPhone || "—")}</td>
        <td>${guests || "—"}</td>
      </tr>`;
    })
    .join("");
  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"/><title>Censo de evacuación</title>
<style>
body{font-family:Segoe UI,sans-serif;color:#0f172a;margin:24px}
h1{font-size:20px;margin:0 0 4px}
p{margin:0 0 16px;color:#475569}
table{border-collapse:collapse;width:100%;font-size:12px}
th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#0f172a;color:#fff}
.totals{margin:12px 0;font-weight:700}
@media print{button{display:none}}
</style></head><body>
<h1>Censo de evacuación — AccesoPro</h1>
<p>Generado ${esc(when)}. Solo visitas en predio (el vecino con cara no lleva reloj de permanencia).</p>
<p class="totals">Total: ${data.total} vidas · ${data.adults} adultas · ${data.minors} menores · ${data.lotsWithPeople} lotes</p>
<button onclick="window.print()">Imprimir / guardar PDF</button>
<table>
<thead><tr><th>Lote</th><th>Nombre</th><th>Adultos</th><th>Menores</th><th>Titular</th><th>Teléfono</th><th>Emergencia</th><th>Visitas</th></tr></thead>
<tbody>${rows || `<tr><td colspan="8">Nadie en predio por visitas abiertas.</td></tr>`}</tbody>
</table>
</body></html>`;
  return c.html(html);
});

function esc(v: string) {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
