import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "./db/client.js";
import {
  driverLicenses,
  personInsurances,
  properties,
  vehicleInsurances,
  vehicles,
  visitorIdentities,
  visitRecords,
  visitPasses,
  visitAuthorizations,
  guardApprovals,
  users,
  events,
} from "./db/schema.js";
import { nid, normalizePlate, scopedSiteWithModule } from "./scope.js";
import { laneCodeOf } from "./accessPoints.js";
import type { AuthUser } from "./auth.js";
import { denyUnlessCapability } from "./grants.js";
import { enrollPersonOnSiteDevicesWait } from "./dahuaSite.js";
import { ASI_CARD_TYPES, ASI_USER_TYPES } from "@accesopro/catalog";
import { processDocumentImage } from "./documentScan.js";
import { mimeOfPath, readVisitorDoc, saveVisitorDoc } from "./visitorDocs.js";
import { upsertCredential } from "./credentials.js";
import { makeVisitToken, parseVisitQrPayload } from "./visitPass.js";
import {
  attachVehicleInsurance,
  attachPersonInsuranceToPass,
  attachLicenseToPass,
  applyPassIdentity,
  decideGuardApproval,
  findVisitPassByDni,
  holdVisitQr,
  isArrivalMode,
  listPendingApprovals,
  replaceCompanions,
  serializePassFicha,
  announceWalkIn,
  attachGoodsAlert,
  requestMinorTransfer,
  notifyMinorsMismatch,
  setApprovalMinorsCount,
  confirmPhoneAuth,
  applyPassKindAndMode,
  switchToPedestrian,
  attachTrunkCheck,
  findTrunkCheck,
  trunkCheckHasPhoto,
  trunkPhotoKey,
  isVisitKind,
  personInsuranceKindFor,
} from "./visitHold.js";
import { parseDniScan } from "./parseDni.js";
import { readEventPhoto } from "./eventPhotos.js";
import { getVisitAuthDefaultHours } from "./retention.js";
import { openAccessQrFromScan } from "./accessQr.js";

function tsMs(v: Date | number | null | undefined) {
  if (v == null) return null;
  return v instanceof Date ? v.getTime() : Number(v);
}

function stayMsOf(inAt: Date | number | null | undefined, outAt: Date | number | null | undefined) {
  const a = tsMs(inAt);
  const b = tsMs(outAt);
  if (a == null || b == null || b < a) return null;
  return b - a;
}

type VisitorsEnv = { Variables: { user: AuthUser } };

export const visitorsApi = new Hono<VisitorsEnv>();

/** Catálogo de aseguradoras automotor supervisadas por la SSN en Argentina */
export const ARGENTINA_INSURANCE_COMPANIES = [
  "Federación Patronal",
  "La Segunda Seguros",
  "San Cristóbal Seguros",
  "Sancor Seguros",
  "Seguros Rivadavia",
  "Zurich Argentina",
  "Allianz Argentina",
  "Mercantil Andina",
  "La Caja Seguros",
  "Mapfre Argentina",
  "Provincia Seguros",
  "Río Uruguay Seguros (RUS)",
  "Berkley Argentina",
  "Chubb Seguros",
  "Experta Seguros",
  "Nación Seguros",
  "Segurcoop",
  "Triunfo Seguros",
  "Paraná Seguros",
  "Orbis Seguros",
];

function normalizeDni(raw: string): string {
  return raw.replace(/\D/g, "").trim();
}

/** Catálogo de aseguradoras */
visitorsApi.get("/visitors/insurances/companies", (c) => {
  return c.json({ companies: ARGENTINA_INSURANCE_COMPANIES });
});

/** Recorte de bordes + JPEG liviano en el mismo server de AccesoPro. */
visitorsApi.post("/visitors/document-scan", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;

  const body = await c.req.json<{
    imageBase64?: string;
    box?: { x: number; y: number; w: number; h: number };
  }>();
  const raw = String(body.imageBase64 || "").replace(/^data:[\w/+.-]+;base64,/, "").trim();
  if (raw.length < 80) return c.json({ error: "No llegó la foto del documento" }, 400);
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    return c.json({ error: "La foto no se pudo decodificar" }, 400);
  }
  if (buf.length < 80) return c.json({ error: "La foto está vacía" }, 400);

  const hint =
    body.box &&
    Number.isFinite(body.box.x) &&
    Number.isFinite(body.box.y) &&
    Number.isFinite(body.box.w) &&
    Number.isFinite(body.box.h)
      ? { x: body.box.x, y: body.box.y, w: body.box.w, h: body.box.h }
      : null;

  try {
    const out = await processDocumentImage(buf, hint);
    return c.json({
      ok: true,
      cropped: out.cropped,
      rotated: out.rotated,
      width: out.width,
      height: out.height,
      bytes: out.jpeg.length,
      mime: "image/jpeg",
      imageBase64: out.jpeg.toString("base64"),
    });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "No se pudo procesar el documento" }, 400);
  }
});

visitorsApi.post("/visitors/parse-dni", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const body = await c.req.json<{ raw?: string }>();
  const parsed = parseDniScan(String(body.raw || ""));
  if (!parsed?.dni) return c.json({ error: "No se reconoció un DNI argentino" }, 400);
  return c.json({ ok: true, ...parsed });
});

visitorsApi.post("/visitors/approvals/scan-qr", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const body = await c.req.json<{ cardRaw?: string; sentido?: string; scanChannel?: string }>();
  const cardRaw = String(body.cardRaw || "").trim();
  if (!cardRaw) return c.json({ error: "Acercá el QR de la visita" }, 400);
  const user = c.get("user");
  const scanChannel = body.scanChannel === "app" ? "app" : "web";
  const parsed = parseDniScan(cardRaw);
  const holdOpts = {
    siteId: scoped.site.id,
    tenantId: scoped.site.tenantId,
    scanChannel,
    scannedByUserId: user.id,
  };
  if (parsed?.dni) {
    const pass = await findVisitPassByDni(scoped.site.id, parsed.dni);
    if (!pass) {
      return c.json({ error: "DNI leído. Escaneá el QR de la visita para abrir la ficha.", parsed }, 404);
    }
    const hold = await holdVisitQr({ ...holdOpts, cardRaw: pass.token });
    if (hold.reason === "closed") {
      return c.json({ error: "Ese pase ya se cerró. No se puede entrar ni salir.", parsed }, 409);
    }
    const pending = (await listPendingApprovals(scoped.site.id)).find((x) => x.passId === pass.id);
    const item = pending || (await serializePassFicha(pass.id));
    return c.json({ ok: true, passId: pass.id, item, parsed, dniMatch: true, sentido: hold.sentido });
  }
  const hold = await holdVisitQr({ ...holdOpts, cardRaw });
  if (!hold.held) {
    // Backup: QR de acceso own_/fam_ (abre solo, sin cola de visita).
    const opened = await openAccessQrFromScan({
      site: scoped.site,
      cardRaw,
      scanChannel,
      guardUserId: user.id,
    });
    if (opened.ok) return c.json(opened);
    return c.json({ error: opened.error || "QR no autorizado" }, 404);
  }
  if (hold.reason === "closed") return c.json({ error: "Ese pase ya se cerró. No se puede entrar ni salir." }, 409);
  if (hold.denied || hold.reason === "expired" || hold.reason === "too_early") {
    return c.json(
      {
        ok: false,
        denied: true,
        reason: hold.reason,
        guestName: hold.guestName,
        passId: hold.passId,
        validFrom: hold.validFrom,
        validUntil: hold.validUntil,
        horaDesde: hold.horaDesde,
        horaHasta: hold.horaHasta,
        error:
          hold.reason === "too_early"
            ? "El pase todavía no vale."
            : "QR vencido. Quedó en historial y se liberó del lector.",
      },
      409,
    );
  }
  const pending = (await listPendingApprovals(scoped.site.id)).find((x) => x.passId === hold.passId);
  const item = pending || (hold.passId ? await serializePassFicha(hold.passId) : null);
  return c.json({ ok: true, ...hold, item });
});

type FichaBody = {
  guestDni?: string;
  guestName?: string;
  firstName?: string;
  lastName?: string;
  tramite?: string;
  gender?: string;
  birthDate?: string;
  patente?: string;
  arrivalMode?: string;
  visitKind?: string;
  companions?: { name?: string; dni?: string }[];
  insurance?: {
    plate?: string;
    company?: string;
    policyNumber?: string;
    validUntil?: string;
    cardPhotoBase64?: string;
    reuseId?: string;
  };
  personInsurance?: {
    kind?: "life" | "art";
    company?: string;
    validUntil?: string;
    documentBase64?: string;
    documentMime?: string;
    source?: "scan" | "upload";
    reuseId?: string;
  };
  driverLicense?: { licenseNumber?: string; validUntil?: string; photoBase64?: string; reuseId?: string };
  minorsCount?: number;
};

async function applyFichaBody(
  scoped: { tenantId: string; site: { id: string } },
  pending: { id: string; passId: string },
  body: FichaBody,
): Promise<string | null> {
  if (body.guestDni?.trim() || body.guestName?.trim() || body.firstName?.trim() || body.lastName?.trim()) {
    await applyPassIdentity(pending.passId, {
      guestDni: body.guestDni,
      guestName: body.guestName,
      firstName: body.firstName,
      lastName: body.lastName,
      tramite: body.tramite,
      gender: body.gender,
      birthDate: body.birthDate,
    });
  }
  await applyPassKindAndMode(pending.passId, {
    visitKind: body.visitKind,
    arrivalMode: body.arrivalMode,
    patente: body.patente,
  });
  if (body.companions) await replaceCompanions(pending.passId, body.companions);
  if (body.insurance) {
    const r = await attachVehicleInsurance(scoped.tenantId, pending.passId, body.insurance);
    if (!r.ok) return r.error;
  }
  if (body.personInsurance) {
    const r = await attachPersonInsuranceToPass(scoped.tenantId, pending.passId, body.personInsurance);
    if (!r.ok) return r.error;
  }
  if (body.driverLicense) {
    const r = await attachLicenseToPass(scoped.tenantId, pending.passId, body.driverLicense);
    if (!r.ok) return r.error;
  }
  if (typeof body.minorsCount === "number") {
    await setApprovalMinorsCount({ siteId: scoped.site.id, approvalId: pending.id, count: body.minorsCount });
  }
  return null;
}

visitorsApi.post("/visitors/approvals/:id/ficha", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const pending = (await listPendingApprovals(scoped.site.id)).find((x) => x.id === c.req.param("id"));
  if (!pending) return c.json({ error: "No hay una solicitud pendiente" }, 404);
  const body = await c.req.json<FichaBody>();
  const error = await applyFichaBody(scoped, pending, body);
  const fresh = (await listPendingApprovals(scoped.site.id)).find((x) => x.id === pending.id);
  if (error) return c.json({ error, item: fresh || pending }, 400);
  return c.json({ ok: true, item: fresh || pending });
});

visitorsApi.post("/visitors/approvals/:id/pedestrian", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const result = await switchToPedestrian({ site: scoped.site, approvalId: c.req.param("id") });
  if (!result.ok) return c.json({ error: result.error }, 400);
  const item = (await listPendingApprovals(scoped.site.id)).find((x) => x.id === c.req.param("id"));
  return c.json({ ok: true, item: item || null });
});

visitorsApi.post("/visitors/approvals/:id/trunk", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const body = await c.req.json<{ description?: string; addPhotosBase64?: string[]; removePhotoIds?: string[] }>();
  const result = await attachTrunkCheck({
    site: scoped.site,
    approvalId: c.req.param("id"),
    guardUserId: c.get("user").id,
    description: body.description,
    addPhotosBase64: Array.isArray(body.addPhotosBase64) ? body.addPhotosBase64 : [],
    removePhotoIds: Array.isArray(body.removePhotoIds) ? body.removePhotoIds : [],
  });
  if (!result.ok) return c.json({ error: result.error }, 400);
  const item = (await listPendingApprovals(scoped.site.id)).find((x) => x.id === c.req.param("id"));
  return c.json({ ok: true, trunk: result.trunk, item: item || null });
});

visitorsApi.get("/visitors/trunk/:checkId/photos/:photoId", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const check = await findTrunkCheck(scoped.site.id, c.req.param("checkId"));
  const photoId = c.req.param("photoId");
  if (!check || !trunkCheckHasPhoto(check, photoId)) return c.json({ error: "No hay foto" }, 404);
  const buf = readEventPhoto(scoped.site.id, trunkPhotoKey(photoId));
  if (!buf) return c.json({ error: "Archivo no encontrado" }, 404);
  return c.body(new Uint8Array(buf), 200, { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300" });
});

visitorsApi.post("/visitors/approvals/:id/expired-exception", async (c) => {
  return c.json({ error: "Documento vencido: no puede ingresar. Si es el seguro o la licencia, puede pasar a pie." }, 410);
});

visitorsApi.get("/visitors/documents/:id", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;

  const row = await db
    .select()
    .from(personInsurances)
    .where(and(eq(personInsurances.id, c.req.param("id")), eq(personInsurances.tenantId, scoped.site.tenantId)))
    .get();
  if (!row?.documentPath) return c.json({ error: "No hay constancia" }, 404);
  const buf = readVisitorDoc(row.documentPath);
  if (!buf) return c.json({ error: "Archivo no encontrado" }, 404);
  const mime = row.documentMime || mimeOfPath(row.documentPath);
  return c.body(new Uint8Array(buf), 200, {
    "Content-Type": mime,
    "Cache-Control": "private, max-age=120",
  });
});

/** Búsqueda de identidad por DNI argentino */
visitorsApi.get("/visitors/search-identity", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;

  const dni = normalizeDni(c.req.query("dni") ?? "");
  if (!dni) return c.json({ found: false, identity: null, license: null, personInsurance: null, lastVisit: null });

  const identity = await db
    .select()
    .from(visitorIdentities)
    .where(
      and(
        eq(visitorIdentities.tenantId, scoped.site.tenantId),
        eq(visitorIdentities.dniNumber, dni)
      )
    )
    .get();

  if (!identity) return c.json({ found: false, identity: null, license: null, personInsurance: null, lastVisit: null });

  // Buscar licencia asociada más reciente
  const license = await db
    .select()
    .from(driverLicenses)
    .where(
      and(
        eq(driverLicenses.tenantId, scoped.site.tenantId),
        eq(driverLicenses.personId, identity.id)
      )
    )
    .orderBy(desc(driverLicenses.validUntil))
    .limit(1)
    .get();

  const personInsurance = await db
    .select()
    .from(personInsurances)
    .where(
      and(eq(personInsurances.tenantId, scoped.site.tenantId), eq(personInsurances.personId, identity.id))
    )
    .orderBy(desc(personInsurances.validUntil))
    .limit(1)
    .get();

  const lastRecord = await db
    .select()
    .from(visitRecords)
    .where(and(eq(visitRecords.tenantId, scoped.site.tenantId), eq(visitRecords.personId, identity.id)))
    .orderBy(desc(visitRecords.createdAt))
    .get();
  const lastPass = await db
    .select()
    .from(visitPasses)
    .where(and(eq(visitPasses.siteId, scoped.site.id), eq(visitPasses.guestDni, dni)))
    .orderBy(desc(visitPasses.createdAt))
    .get();
  const lastPropertyId = lastPass?.propertyId ?? lastRecord?.propertyId ?? null;
  const lastProperty = lastPropertyId
    ? await db.select().from(properties).where(eq(properties.id, lastPropertyId)).get()
    : null;
  const lastAt = lastPass?.createdAt ?? lastRecord?.createdAt ?? null;
  const nowMs = Date.now();
  const isExpired = (v: Date | number | null | undefined) => {
    const t = tsMs(v);
    return t != null && t > 0 && t < nowMs;
  };

  return c.json({
    found: true,
    identity,
    blacklisted: Boolean(identity.blacklisted),
    lastVisit: lastAt
      ? {
          visitType: lastPass?.visitKind ?? lastRecord?.visitType ?? "social",
          arrivalMode: lastPass?.arrivalMode ?? null,
          patente: lastPass?.patente ?? null,
          propertyId: lastPropertyId,
          lotNumber: lastProperty?.lotNumber ?? null,
          at: lastAt,
        }
      : null,
    license: license
      ? {
          ...license,
          hasPhoto: Boolean(license.photoUrl),
          expired: isExpired(license.validUntil),
        }
      : null,
    personInsurance: personInsurance
      ? {
          id: personInsurance.id,
          kind: personInsurance.kind,
          company: personInsurance.company,
          validUntil: personInsurance.validUntil,
          documentMime: personInsurance.documentMime,
          hasDocument: Boolean(personInsurance.documentPath),
          expired: isExpired(personInsurance.validUntil),
        }
      : null,
  });
});

/** Búsqueda de vehículo por Patente */
visitorsApi.get("/visitors/search-vehicle", async (c) => {
  const deniedCap = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (deniedCap) return deniedCap;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;

  const plate = normalizePlate(c.req.query("plate") ?? "");
  if (!plate) return c.json({ found: false, vehicle: null, insurance: null });

  const vehicle = await db
    .select()
    .from(vehicles)
    .where(
      and(
        eq(vehicles.tenantId, scoped.site.tenantId),
        eq(vehicles.plate, plate)
      )
    )
    .get();

  if (!vehicle) return c.json({ found: false, vehicle: null, insurance: null });

  // Buscar última póliza de seguro cargada para este vehículo
  const insurance = await db
    .select()
    .from(vehicleInsurances)
    .where(
      and(
        eq(vehicleInsurances.tenantId, scoped.site.tenantId),
        eq(vehicleInsurances.vehicleId, vehicle.id)
      )
    )
    .orderBy(desc(vehicleInsurances.validUntil))
    .limit(1)
    .get();

  const insExpired = insurance ? (tsMs(insurance.validUntil) ?? 0) < Date.now() : false;
  return c.json({
    found: true,
    vehicle,
    insurance: insurance ? { ...insurance, hasPhoto: Boolean(insurance.cardPhotoUrl), expired: insExpired } : null,
  });
});

/** Lotes del barrio para el check-in de visitas (portería y admin). */
visitorsApi.get("/visitors/properties", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const rows = await db
    .select({
      id: properties.id,
      lotNumber: properties.lotNumber,
      label: properties.label,
    })
    .from(properties)
    .where(eq(properties.siteId, scoped.site.id));
  return c.json({
    properties: rows.sort((a, b) => a.lotNumber.localeCompare(b.lotNumber, "es", { numeric: true })),
  });
});

/** Autorizaciones y pases de todos los propietarios del barrio (portería). */
visitorsApi.get("/visitors/owner-passes", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;

  const limit = Math.min(Number(c.req.query("limit") ?? 60), 120);
  const now = Date.now();

  const [passRows, authRows] = await Promise.all([
    db
      .select({
        id: visitPasses.id,
        guestName: visitPasses.guestName,
        guestDni: visitPasses.guestDni,
        patente: visitPasses.patente,
        status: visitPasses.status,
        arrivalMode: visitPasses.arrivalMode,
        visitKind: visitPasses.visitKind,
        completeness: visitPasses.completeness,
        validFrom: visitPasses.validFrom,
        validUntil: visitPasses.validUntil,
        createdAt: visitPasses.createdAt,
        scannedInAt: visitPasses.scannedInAt,
        scannedOutAt: visitPasses.scannedOutAt,
        dahuaSynced: visitPasses.dahuaSynced,
        propertyId: visitPasses.propertyId,
        lotNumber: properties.lotNumber,
        propertyLabel: properties.label,
        mapLat: properties.mapLat,
        mapLng: properties.mapLng,
        lotPolygon: properties.lotPolygon,
        ownerName: users.name,
      })
      .from(visitPasses)
      .leftJoin(properties, eq(properties.id, visitPasses.propertyId))
      .leftJoin(users, eq(users.id, visitPasses.createdByUserId))
      .where(eq(visitPasses.siteId, scoped.site.id))
      .orderBy(desc(visitPasses.createdAt))
      .limit(limit),
    db
      .select({
        id: visitAuthorizations.id,
        guestName: visitAuthorizations.guestName,
        guestDni: visitAuthorizations.guestDni,
        patente: visitAuthorizations.patente,
        kind: visitAuthorizations.kind,
        active: visitAuthorizations.active,
        validFrom: visitAuthorizations.fechaDesde,
        validUntil: visitAuthorizations.fechaHasta,
        createdAt: visitAuthorizations.createdAt,
        lotNumber: properties.lotNumber,
        propertyLabel: properties.label,
        ownerName: users.name,
      })
      .from(visitAuthorizations)
      .leftJoin(properties, eq(properties.id, visitAuthorizations.propertyId))
      .leftJoin(users, eq(users.id, visitAuthorizations.createdByUserId))
      .where(eq(visitAuthorizations.siteId, scoped.site.id))
      .orderBy(desc(visitAuthorizations.createdAt))
      .limit(limit),
  ]);

  type Notice = {
    id: string;
    passId?: string;
    source: "pass" | "auth";
    guestName: string;
    guestDni: string | null;
    patente: string | null;
    status: string;
    bucket: "pending" | "closed";
    validFrom: Date | number | null;
    validUntil: Date | number | null;
    createdAt: Date | number;
    scannedInAt: Date | number | null;
    scannedOutAt: Date | number | null;
    stayMs: number | null;
    dahuaSynced: boolean;
    lot: string;
    ownerName: string;
    ownerPhone?: string | null;
    ownerWhatsapp?: string | null;
    emergencyPhone?: string | null;
    kind?: string;
    arrivalMode?: string | null;
    visitKind?: string | null;
    completeness?: string | null;
    propertyId?: string | null;
    mapLat?: string | null;
    mapLng?: string | null;
    lotPolygon?: string | null;
    missing?: string[];
    companions?: { name: string; dni: string | null }[];
  };

  const ms = tsMs;

  const { listCompanions, missingVisitFields, ownerContactForProperty } = await import("./visitHold.js");

  const notices: Notice[] = [];

  for (const r of passRows) {
    const until = ms(r.validUntil);
    const revoked = r.status === "revoked" || r.status === "cancelled" || r.status === "denied";
    const expired = until != null && until < now || r.status === "expired";
    const closed = Boolean(r.scannedOutAt) || revoked || expired || r.status === "completed";
    const awaiting = r.status === "awaiting_entry" || r.status === "awaiting_exit";
    const inSite = r.status === "in_site" || Boolean(r.scannedInAt && !r.scannedOutAt && !closed);
    const contact = r.propertyId ? await ownerContactForProperty(r.propertyId) : null;
    const companions = await listCompanions(r.id);
    const missing = closed || inSite ? [] : await missingVisitFields(r.id);
    notices.push({
      id: `pass:${r.id}`,
      passId: r.id,
      source: "pass",
      guestName: r.guestName,
      guestDni: r.guestDni,
      patente: r.patente,
      status: closed
        ? r.scannedOutAt || r.status === "completed"
          ? "completed"
          : revoked
            ? r.status === "denied"
              ? "denied"
              : "revoked"
            : expired
              ? "expired"
              : r.status
        : awaiting
          ? r.status
          : inSite
            ? "in_site"
            : "pending",
      bucket: closed ? "closed" : "pending",
      validFrom: r.validFrom,
      validUntil: r.validUntil,
      createdAt: r.createdAt,
      scannedInAt: r.scannedInAt,
      scannedOutAt: r.scannedOutAt,
      stayMs: stayMsOf(r.scannedInAt, r.scannedOutAt),
      dahuaSynced: Boolean(r.dahuaSynced),
      lot: r.lotNumber ? `Lote ${r.lotNumber}` : r.propertyLabel || "Propiedad",
      ownerName: contact?.ownerName || r.ownerName || "Propietario",
      ownerPhone: contact?.ownerPhone ?? null,
      ownerWhatsapp: contact?.ownerWhatsapp ?? null,
      emergencyPhone: contact?.emergencyPhone ?? null,
      arrivalMode: r.arrivalMode,
      visitKind: r.visitKind,
      completeness: r.completeness,
      propertyId: r.propertyId,
      mapLat: r.mapLat,
      mapLng: r.mapLng,
      lotPolygon: r.lotPolygon,
      missing,
      companions: companions.map((x) => ({ name: x.name, dni: x.dni })),
    });
  }

  for (const r of authRows) {
    const until = ms(r.validUntil);
    const expired = until != null && until < now;
    const inactive = r.active === false;
    const closed = inactive || expired;
    notices.push({
      id: `auth:${r.id}`,
      source: "auth",
      guestName: r.guestName,
      guestDni: r.guestDni,
      patente: r.patente,
      status: closed ? (inactive && !expired ? "revoked" : "expired") : "pending",
      bucket: closed ? "closed" : "pending",
      validFrom: r.validFrom,
      validUntil: r.validUntil,
      createdAt: r.createdAt,
      scannedInAt: null,
      scannedOutAt: null,
      stayMs: null,
      dahuaSynced: false,
      lot: r.lotNumber ? `Lote ${r.lotNumber}` : r.propertyLabel || "Propiedad",
      ownerName: r.ownerName || "Propietario",
      kind: r.kind,
    });
  }

  notices.sort((a, b) => ms(b.createdAt)! - ms(a.createdAt)!);

  const pending = notices.filter((n) => n.bucket === "pending").slice(0, 40);
  const closed = notices.filter((n) => n.bucket === "closed").slice(0, 40);

  return c.json({
    pending,
    closed,
    /** Compat: lista plana (pendientes primero). */
    passes: [...pending, ...closed],
  });
});

visitorsApi.get("/visitors/approvals", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const items = await listPendingApprovals(scoped.site.id);
  return c.json({ items });
});

visitorsApi.get("/visitors/passes/:id", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const passId = c.req.param("id");
  const pass = await db
    .select()
    .from(visitPasses)
    .where(and(eq(visitPasses.id, passId), eq(visitPasses.siteId, scoped.site.id)))
    .get();
  if (!pass) return c.json({ error: "Pase no encontrado" }, 404);
  const pending = (await listPendingApprovals(scoped.site.id)).find((x) => x.passId === pass.id);
  if (pending) return c.json({ item: { ...pending, pending: true } });
  const item = await serializePassFicha(pass.id);
  if (!item) return c.json({ error: "Pase no encontrado" }, 404);
  return c.json({ item: { ...item, pending: false } });
});

visitorsApi.post("/visitors/approvals/:id/decide", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const body = await c.req.json<FichaBody & { decision?: "approved" | "denied"; comment?: string; trunkChecked?: boolean }>();
  const decision = body.decision === "denied" ? "denied" : body.decision === "approved" ? "approved" : null;
  if (!decision) return c.json({ error: "Indicá aprobar o denegar" }, 400);

  const approvalId = c.req.param("id");
  const pending = (await listPendingApprovals(scoped.site.id)).find((x) => x.id === approvalId);
  if (pending && decision === "approved") {
    const error = await applyFichaBody(scoped, pending, body);
    if (error) return c.json({ error }, 400);
  }

  const result = await decideGuardApproval({
    site: scoped.site,
    approvalId,
    guardUserId: c.get("user").id,
    decision,
    comment: body.comment,
    trunkChecked: Boolean(body.trunkChecked),
  });
  if (!result.ok) {
    const fresh = (await listPendingApprovals(scoped.site.id)).find((x) => x.id === approvalId);
    return c.json({ error: result.error, missing: result.missing, item: fresh || null }, 400);
  }
  return c.json({ ok: true, actuatorsFired: result.actuatorsFired || [] });
});

visitorsApi.post("/visitors/announce", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const body = await c.req.json<{
    propertyId?: string;
    guestName?: string;
    guestDni?: string;
    visitKind?: string;
    arrivalMode?: string;
    patente?: string;
  }>();
  if (!body.propertyId) return c.json({ error: "Falta el lote" }, 400);
  const result = await announceWalkIn({
    site: scoped.site,
    propertyId: body.propertyId,
    guardUserId: c.get("user").id,
    guestName: body.guestName,
    guestDni: body.guestDni,
    visitKind: body.visitKind,
    arrivalMode: body.arrivalMode,
    patente: body.patente,
  });
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json(result);
});

visitorsApi.post("/visitors/approvals/:id/phone-auth", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const body = await c.req.json<{ guardCode?: string }>();
  const result = await confirmPhoneAuth({
    site: scoped.site,
    approvalId: c.req.param("id"),
    guardUserId: c.get("user").id,
    guardCode: body.guardCode || "",
  });
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json({ ok: true });
});

visitorsApi.post("/visitors/approvals/:id/goods", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const body = await c.req.json<{ description?: string; photoBase64?: string }>();
  const result = await attachGoodsAlert({
    site: scoped.site,
    approvalId: c.req.param("id"),
    description: body.description || "",
    photoBase64: body.photoBase64,
  });
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json({ ok: true });
});

visitorsApi.get("/visitors/approvals/:id/goods-photo", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const buf = readEventPhoto(scoped.site.id, `goods-${c.req.param("id")}`);
  if (!buf) return c.json({ error: "No hay foto" }, 404);
  return c.body(new Uint8Array(buf), 200, { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=60" });
});

visitorsApi.post("/visitors/approvals/:id/minors-count", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const body = await c.req.json<{ count?: number }>();
  const result = await setApprovalMinorsCount({
    siteId: scoped.site.id,
    approvalId: c.req.param("id"),
    count: Number(body.count),
  });
  if (!result.ok) return c.json({ error: result.error }, 400);
  const item = (await listPendingApprovals(scoped.site.id)).find((x) => x.id === c.req.param("id"));
  return c.json({ ...result, item });
});

visitorsApi.post("/visitors/approvals/:id/minors-mismatch", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const result = await notifyMinorsMismatch({
    site: scoped.site,
    approvalId: c.req.param("id"),
  });
  if (!result.ok) return c.json({ error: result.error }, 400);
  const item = (await listPendingApprovals(scoped.site.id)).find((x) => x.id === c.req.param("id"));
  return c.json({ ok: true, item });
});

visitorsApi.post("/visitors/approvals/:id/minors", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const body = await c.req.json<{
    originPropertyId?: string;
    exitAdultsCount?: number;
    exitMinorsCount?: number;
    extraName?: string;
    extraDni?: string;
  }>();
  if (!body.originPropertyId) return c.json({ error: "Falta el lote de procedencia del menor" }, 400);
  const result = await requestMinorTransfer({
    site: scoped.site,
    approvalId: c.req.param("id"),
    originPropertyId: body.originPropertyId,
    exitAdultsCount: body.exitAdultsCount,
    exitMinorsCount: body.exitMinorsCount,
    extraName: body.extraName,
    extraDni: body.extraDni,
  });
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json({ ok: true });
});

visitorsApi.get("/visit-passes/verify/:token", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const token = c.req.param("token");
  const pass = await db
    .select()
    .from(visitPasses)
    .where(and(eq(visitPasses.token, token), eq(visitPasses.siteId, scoped.site.id)))
    .get();
  if (!pass) return c.json({ valid: false, error: "QR no encontrado" }, 404);
  const property = await db.select().from(properties).where(eq(properties.id, pass.propertyId)).get();
  const now = Date.now();
  const { isOpenVisitStatus } = await import("./visitHold.js");
  const valid =
    isOpenVisitStatus(pass.status) && now >= new Date(pass.validFrom).getTime() && now <= new Date(pass.validUntil).getTime();
  return c.json({
    valid,
    status: pass.status,
    guestName: pass.guestName,
    patente: pass.patente,
    guestDni: pass.guestDni,
    lotNumber: property?.lotNumber,
    validFrom: pass.validFrom,
    validUntil: pass.validUntil,
    horaDesde: pass.horaDesde,
    horaHasta: pass.horaHasta,
    scannedInAt: pass.scannedInAt,
    scannedOutAt: pass.scannedOutAt,
  });
});

visitorsApi.post("/visit-passes/scan", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const body = await c.req.json<{ raw?: string; token?: string; sentido?: string }>();
  let token = body.token?.trim() ?? "";
  if (body.raw) token = parseVisitQrPayload(body.raw) ?? token;
  if (!token) return c.json({ ok: false, error: "QR inválido" }, 400);
  const sentido = body.sentido === "out" ? "out" : "in";
  const { scanVisitPass } = await import("./visitPass.js");
  const result = await scanVisitPass(scoped.site, token, sentido);
  return c.json(result, result.ok ? 200 : 403);
});

visitorsApi.post("/visitors/passes/:id/complete", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const passId = c.req.param("id");
  const pass = await db
    .select()
    .from(visitPasses)
    .where(and(eq(visitPasses.id, passId), eq(visitPasses.siteId, scoped.site.id)))
    .get();
  if (!pass) return c.json({ error: "Pase no encontrado" }, 404);
  const body = await c.req.json<{
    guestDni?: string;
    arrivalMode?: string;
    patente?: string;
    notes?: string;
    companions?: { name?: string; dni?: string }[];
    insurance?: { plate?: string; company?: string; policyNumber?: string; validUntil?: string };
  }>();
  const patch: Record<string, unknown> = { completeness: "full" };
  if (body.guestDni?.trim()) patch.guestDni = body.guestDni.replace(/\D/g, "");
  if (isArrivalMode(body.arrivalMode)) patch.arrivalMode = body.arrivalMode;
  if (body.patente?.trim()) patch.patente = normalizePlate(body.patente);
  if (body.notes !== undefined) patch.notes = body.notes.trim() || null;
  await db.update(visitPasses).set(patch as typeof visitPasses.$inferInsert).where(eq(visitPasses.id, passId));
  if (body.companions) await replaceCompanions(passId, body.companions);
  if (body.insurance) await attachVehicleInsurance(scoped.tenantId, passId, body.insurance);
  return c.json({ ok: true });
});

/** Listado de registros de visitas */
visitorsApi.get("/visitors/records", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;

  const limit = Math.min(Number(c.req.query("limit") ?? 100), 200);

  const records = await db
    .select()
    .from(visitRecords)
    .where(eq(visitRecords.siteId, scoped.site.id))
    .orderBy(desc(visitRecords.createdAt))
    .limit(limit);

  // Enriquecer con los datos de las tablas separadas
  const enriched = await Promise.all(
    records.map(async (r) => {
      const person = await db
        .select()
        .from(visitorIdentities)
        .where(eq(visitorIdentities.id, r.personId))
        .get();

      const property = await db
        .select()
        .from(properties)
        .where(eq(properties.id, r.propertyId))
        .get();

      let vehicle = null;
      let insurance = null;
      let license = null;

      if (r.vehicleId) {
        vehicle = await db.select().from(vehicles).where(eq(vehicles.id, r.vehicleId)).get();
      }
      if (r.insuranceId) {
        insurance = await db.select().from(vehicleInsurances).where(eq(vehicleInsurances.id, r.insuranceId)).get();
      }
      if (r.licenseId) {
        license = await db.select().from(driverLicenses).where(eq(driverLicenses.id, r.licenseId)).get();
      }

      return {
        ...r,
        person: person ?? null,
        property: property ?? null,
        vehicle: vehicle ?? null,
        insurance: insurance ?? null,
        license: license ?? null,
      };
    })
  );

  return c.json({ records: enriched });
});

/** Payload para registro manual / checkin en varios pasos */
export type VisitorCheckinPayload = {
  // Paso 1: DNI Argentino
  identity: {
    dniNumber: string;
    tramiteNumber?: string;
    lastName: string;
    firstName: string;
    gender?: string;
    birthDate?: string;
    issueDate?: string;
    address?: string;
    phone?: string;
    rawPdf417?: string;
  };
  // Paso 2: Destino
  destination: {
    propertyId: string;
    authorizedBy: string;
    visitType?: "social" | "service" | "contractor" | "delivery" | "event";
    notes?: string;
  };
  // Paso 3 & 4: Modalidad Vehicular & Seguro
  isVehicular: boolean;
  vehicle?: {
    plate: string;
    brand?: string;
    model?: string;
    color?: string;
    vehicleType?: "car" | "pickup" | "suv" | "motorcycle" | "van" | "truck";
  };
  insurance?: {
    company?: string;
    policyNumber?: string;
    validFrom?: number | string;
    validUntil?: number | string;
    coverageType?: "responsabilidad_civil" | "terceros" | "todo_riesgo";
    cardPhotoBase64?: string;
    reuseId?: string;
  };
  // Paso 5: Licencia de Conducir
  driverLicense?: {
    licenseNumber?: string;
    classes?: string;
    jurisdiction?: string;
    validUntil?: number | string;
    photoBase64?: string;
    reuseId?: string;
  };
  arrivalMode?: "peatonal" | "plataforma" | "vehiculo";
  companions?: { name?: string; dni?: string; birthDate?: string; isMinor?: boolean; situation?: string }[];
  /** Visita = QR + guardia. Cara de invitado no se enrola en el ASI. */
  accessMethod?: "qr";
  /** Seguro de vida / ART de la persona (no el del auto). */
    personInsurance?: {
    reuseId?: string;
    kind?: "life" | "art";
    company?: string;
    validUntil?: number | string;
    documentBase64?: string;
    documentMime?: string;
    source?: "scan" | "upload";
  };
};

/** Endpoint transaccional de Check-in en varios pasos */
visitorsApi.post("/visitors/checkin", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;

  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;

  const body = await c.req.json<VisitorCheckinPayload>();
  if (!body.identity?.dniNumber || !body.identity?.lastName || !body.identity?.firstName) {
    return c.json({ error: "Faltan datos obligatorios de identidad (DNI, Apellido y Nombre)" }, 400);
  }
  if (!body.destination?.propertyId || !body.destination?.authorizedBy) {
    return c.json({ error: "Faltan datos de destino (Lote y Persona que autoriza)" }, 400);
  }

  const tenantId = scoped.site.tenantId;
  const siteId = scoped.site.id;
  const now = new Date();
  const defaultHours = await getVisitAuthDefaultHours(tenantId);
  const defaultUntil = new Date(now.getTime() + defaultHours * 60 * 60 * 1000);
  const dniClean = normalizeDni(body.identity.dniNumber);
  const accessMethod = "qr";

  // 1. Resolver o Crear Persona en `visitor_identities`
  let person = await db
    .select()
    .from(visitorIdentities)
    .where(and(eq(visitorIdentities.tenantId, tenantId), eq(visitorIdentities.dniNumber, dniClean)))
    .get();

  if (person) {
    // Actualizar datos de contacto / trámite si cambiaron
    await db
      .update(visitorIdentities)
      .set({
        lastName: body.identity.lastName.trim(),
        firstName: body.identity.firstName.trim(),
        tramiteNumber: body.identity.tramiteNumber?.trim() || person.tramiteNumber,
        gender: body.identity.gender || person.gender,
        birthDate: body.identity.birthDate || person.birthDate,
        address: body.identity.address || person.address,
        phone: body.identity.phone || person.phone,
        rawPdf417: body.identity.rawPdf417 || person.rawPdf417,
        updatedAt: now,
      })
      .where(eq(visitorIdentities.id, person.id));
  } else {
    const newPersonId = nid();
    await db.insert(visitorIdentities).values({
      id: newPersonId,
      tenantId,
      dniNumber: dniClean,
      tramiteNumber: body.identity.tramiteNumber?.trim() || null,
      lastName: body.identity.lastName.trim(),
      firstName: body.identity.firstName.trim(),
      gender: body.identity.gender || null,
      birthDate: body.identity.birthDate || null,
      issueDate: body.identity.issueDate || null,
      address: body.identity.address || null,
      phone: body.identity.phone || null,
      rawPdf417: body.identity.rawPdf417 || null,
      blacklisted: false,
      createdAt: now,
      updatedAt: now,
    });
    person = await db.select().from(visitorIdentities).where(eq(visitorIdentities.id, newPersonId)).get();
  }

  if (person?.blacklisted) {
    return c.json(
      {
        error: `Acceso restringido: Esta persona posee impedimento de ingreso (${person.blacklistReason || "Sin motivo especificado"})`,
      },
      403
    );
  }

  // 2. Vehículo (marca/modelo). Seguro, licencia y ART se vinculan al pase con los mismos helpers que la cola.
  let vehicleId: string | null = null;
  const arrivalMode = isArrivalMode(body.arrivalMode)
    ? body.arrivalMode
    : body.isVehicular
      ? "vehiculo"
      : "peatonal";
  const isVehicular = arrivalMode === "vehiculo";
  const visitKindRaw = body.destination.visitType === "event" ? "social" : body.destination.visitType;
  const visitKind = isVisitKind(visitKindRaw) ? visitKindRaw : "social";

  if (isVehicular && body.vehicle?.plate) {
    const plateClean = normalizePlate(body.vehicle.plate);

    const vehicle = await db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.tenantId, tenantId), eq(vehicles.plate, plateClean)))
      .get();

    if (vehicle) {
      await db
        .update(vehicles)
        .set({
          brand: body.vehicle.brand || vehicle.brand,
          model: body.vehicle.model || vehicle.model,
          color: body.vehicle.color || vehicle.color,
          vehicleType: body.vehicle.vehicleType || vehicle.vehicleType,
        })
        .where(eq(vehicles.id, vehicle.id));
      vehicleId = vehicle.id;
    } else {
      vehicleId = nid();
      await db.insert(vehicles).values({
        id: vehicleId,
        tenantId,
        plate: plateClean,
        brand: body.vehicle.brand || null,
        model: body.vehicle.model || null,
        color: body.vehicle.color || null,
        vehicleType: body.vehicle.vehicleType || "car",
        createdAt: now,
      });
    }
  }

  // 3. Crear el registro consolidado + el mismo pase QR que usa el portal.
  const visitId = nid();
  const passId = nid();
  const token = makeVisitToken(body.destination.propertyId, passId);
  const guestName = `${person!.firstName} ${person!.lastName}`.trim();

  await db.insert(visitRecords).values({
    id: visitId,
    tenantId,
    siteId,
    propertyId: body.destination.propertyId,
    personId: person!.id,
    vehicleId,
    insuranceId: null,
    personInsuranceId: null,
    licenseId: null,
    visitType: body.destination.visitType || "social",
    status: "awaiting_entry",
    authorizedBy: body.destination.authorizedBy.trim(),
    passToken: token,
    scannedInAt: null,
    notes: body.destination.notes || null,
    createdByUserId: c.get("user")?.id,
    createdAt: now,
  });

  await db.insert(visitPasses).values({
    id: passId,
    propertyId: body.destination.propertyId,
    siteId,
    authorizationId: null,
    token,
    guestName,
    guestDni: dniClean,
    patente: isVehicular && body.vehicle?.plate ? normalizePlate(body.vehicle.plate) : null,
    validFrom: now,
    validUntil: defaultUntil,
    horaDesde: null,
    horaHasta: null,
    status: "preauthorized",
    arrivalMode,
    visitKind,
    completeness: isVehicular ? "full" : "basic",
    vehicleId,
    insuranceId: null,
    visitRecordId: visitId,
    notes: body.destination.notes || null,
    dahuaSynced: false,
    dahuaCardNo: token,
    scannedInAt: null,
    scannedOutAt: null,
    createdByUserId: c.get("user").id,
    createdAt: now,
  });
  await replaceCompanions(passId, body.companions);

  const warnings: string[] = [];
  const dateStr = (v: number | string | undefined) => {
    if (v == null || v === "") return undefined;
    const d = new Date(typeof v === "number" ? v : String(v));
    return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
  };
  if (isVehicular && body.insurance && (body.insurance.reuseId || body.insurance.company)) {
    const r = await attachVehicleInsurance(tenantId, passId, {
      plate: body.vehicle?.plate,
      company: body.insurance.company,
      policyNumber: body.insurance.policyNumber,
      validUntil: dateStr(body.insurance.validUntil),
      cardPhotoBase64: body.insurance.cardPhotoBase64,
      reuseId: body.insurance.reuseId,
    });
    if (!r.ok) warnings.push(r.error);
  }
  if (isVehicular && body.driverLicense && (body.driverLicense.reuseId || body.driverLicense.validUntil)) {
    const r = await attachLicenseToPass(tenantId, passId, {
      licenseNumber: body.driverLicense.licenseNumber,
      validUntil: dateStr(body.driverLicense.validUntil),
      photoBase64: body.driverLicense.photoBase64,
      reuseId: body.driverLicense.reuseId,
    });
    if (!r.ok) warnings.push(r.error);
  }
  if (body.personInsurance && (body.personInsurance.reuseId || body.personInsurance.validUntil)) {
    const r = await attachPersonInsuranceToPass(tenantId, passId, {
      kind: personInsuranceKindFor(visitKind, body.personInsurance.kind),
      company: body.personInsurance.company,
      validUntil: dateStr(body.personInsurance.validUntil),
      documentBase64: body.personInsurance.documentBase64,
      documentMime: body.personInsurance.documentMime,
      source: body.personInsurance.source,
      reuseId: body.personInsurance.reuseId,
    });
    if (!r.ok) warnings.push(r.error);
  }
  const linkedPass = await db.select().from(visitPasses).where(eq(visitPasses.id, passId)).get();
  const insuranceId = linkedPass?.insuranceId ?? null;
  const licenseId = linkedPass?.licenseId ?? null;
  const personInsuranceId = linkedPass?.personInsuranceId ?? null;
  if (linkedPass) {
    vehicleId = linkedPass.vehicleId ?? vehicleId;
    await db
      .update(visitRecords)
      .set({ vehicleId, insuranceId, licenseId, personInsuranceId })
      .where(eq(visitRecords.id, visitId));
  }

  const dahuaUserId = `v_${passId.slice(-8)}`;
  await upsertCredential({
    siteId,
    dahuaUserId,
    kind: "qr",
    payload: token,
    label: guestName,
    validFrom: now,
    validUntil: defaultUntil,
    maxUses: 0,
  });

  let dahuaSynced = false;
  try {
    const results = await enrollPersonOnSiteDevicesWait(
      siteId,
      {
        userId: dahuaUserId,
        name: guestName,
        cardNo: token,
        userType: ASI_USER_TYPES.guest,
        cardType: ASI_CARD_TYPES.guest,
        photoBase64: undefined,
        useTime: 0,
      },
      { fechaDesde: now, fechaHasta: defaultUntil },
    );
    dahuaSynced = results.some((r) => r.ok);
    if (dahuaSynced) {
      await db.update(visitPasses).set({ dahuaSynced: true, dahuaCardNo: token }).where(eq(visitPasses.id, passId));
    }
  } catch {
    /* el check-in local no depende del lector */
  }

  const hold = await holdVisitQr({
    siteId,
    tenantId,
    cardRaw: token,
    sentido: "in",
    scanChannel: "web",
    scannedByUserId: c.get("user").id,
    at: now,
    notifyLot: false,
  });

  // Autorización verbal ya registrada en authorizedBy: sin espera al titular (no es walk-in).
  if (hold.approvalId) {
    await db
      .update(guardApprovals)
      .set({
        ownerAuthStatus: "owner_approved",
        comment: `Autorizó verbalmente: ${body.destination.authorizedBy.trim()}`,
      })
      .where(eq(guardApprovals.id, hold.approvalId));
  }

  // 5. Registrar evento en auditoría
  await db.insert(events).values({
    id: nid(),
    siteId,
    type: "visitor_checkin",
    sentido: "in",
    laneCode: laneCodeOf("in"),
    payload: JSON.stringify({
      visitId,
      passId,
      passToken: token,
      qrPayload: token,
      personName: guestName,
      dni: dniClean,
      plate: body.vehicle?.plate || null,
      insuranceCompany: body.insurance?.company || null,
      personInsuranceUntil: body.personInsurance?.validUntil || null,
      authorizedBy: body.destination.authorizedBy,
      propertyId: body.destination.propertyId,
      isVehicular: body.isVehicular,
      accessMethod,
      dahuaSynced,
      timestamp: now.toISOString(),
      sentido: "in",
      laneCode: 1,
    }),
    createdAt: now,
  });

  const pending = (await listPendingApprovals(siteId)).find((x) => x.passId === passId);

  return c.json({
    ok: true,
    visitId,
    passId,
    approvalId: pending?.id || hold.approvalId || null,
    passToken: token,
    qrPayload: token,
    person,
    vehicleId,
    insuranceId,
    licenseId,
    accessMethod,
    dahuaSynced,
    message: "Visita registrada. Completá la ficha y aprobá para abrir; no hace falta esperar al titular.",
  });
});

/** Pedido de egreso: no cierra solo; el guardia aprueba en la cola. */
visitorsApi.post("/visitors/records/:id/checkout", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;

  const id = c.req.param("id");
  const record = await db
    .select()
    .from(visitRecords)
    .where(and(eq(visitRecords.id, id), eq(visitRecords.siteId, scoped.site.id)))
    .get();

  if (!record) return c.json({ error: "Registro de visita no encontrado" }, 404);

  let pass = record.passToken
    ? await db.select().from(visitPasses).where(eq(visitPasses.token, record.passToken)).get()
    : null;
  if (!pass) {
    const rows = await db.select().from(visitPasses).where(eq(visitPasses.siteId, scoped.site.id));
    pass = rows.find((p) => p.visitRecordId === id) ?? null;
  }
  if (pass) {
    const hold = await holdVisitQr({
      siteId: scoped.site.id,
      tenantId: scoped.tenantId,
      cardRaw: pass.token,
      sentido: "out",
      scanChannel: "web",
      scannedByUserId: c.get("user").id,
    });
    return c.json({
      ok: true,
      held: true,
      approvalId: hold.approvalId,
      passId: hold.passId,
      message: "Egreso pedido. El guardia tiene que aprobar la salida (baúl si hay vehículo).",
    });
  }

  return c.json({ error: "Este ingreso no tiene pase QR. Pedí la salida desde la cola cuando acerquen el QR." }, 400);
});

/** Salida desde app/historial sin lector: abre ficha OUT en la cola. */
visitorsApi.post("/visitors/passes/:id/request-exit", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  const pass = await db
    .select()
    .from(visitPasses)
    .where(and(eq(visitPasses.id, c.req.param("id")), eq(visitPasses.siteId, scoped.site.id)))
    .get();
  if (!pass) return c.json({ error: "Pase no encontrado" }, 404);
  if (pass.status !== "in_site" && pass.status !== "awaiting_exit") {
    return c.json({ error: "Esa visita no está adentro del predio" }, 409);
  }
  const hold = await holdVisitQr({
    siteId: scoped.site.id,
    tenantId: scoped.tenantId,
    cardRaw: pass.token,
    sentido: "out",
    scanChannel: "app",
    scannedByUserId: c.get("user").id,
  });
  if (!hold.held || hold.denied) {
    return c.json({ error: hold.reason === "closed" ? "El pase ya se cerró" : "No se pudo pedir la salida" }, 409);
  }
  const pending = (await listPendingApprovals(scoped.site.id)).find((x) => x.id === hold.approvalId || x.passId === pass.id);
  return c.json({
    ok: true,
    approvalId: hold.approvalId,
    passId: pass.id,
    item: pending || null,
    message: "Salida en cola. Completá ficha y aprobá para abrir.",
  });
});
