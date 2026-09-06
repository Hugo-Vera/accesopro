import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "./db/client.js";
import {
  driverLicenses,
  properties,
  vehicleInsurances,
  vehicles,
  visitorIdentities,
  visitRecords,
  visitPasses,
  visitAuthorizations,
  users,
  events,
} from "./db/schema.js";
import { nid, scopedSiteWithModule } from "./scope.js";
import { fireActuator } from "./actuatorExec.js";
import type { AuthUser } from "./auth.js";
import { denyUnlessCapability } from "./grants.js";

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

function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").trim();
}

/** Catálogo de aseguradoras */
visitorsApi.get("/visitors/insurances/companies", (c) => {
  return c.json({ companies: ARGENTINA_INSURANCE_COMPANIES });
});

/** Búsqueda de identidad por DNI argentino */
visitorsApi.get("/visitors/search-identity", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;

  const dni = normalizeDni(c.req.query("dni") ?? "");
  if (!dni) return c.json({ found: false, identity: null, license: null });

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

  if (!identity) return c.json({ found: false, identity: null, license: null });

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

  return c.json({
    found: true,
    identity,
    license: license ?? null,
  });
});

/** Búsqueda de vehículo por Patente */
visitorsApi.get("/visitors/search-vehicle", async (c) => {
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

  return c.json({
    found: true,
    vehicle,
    insurance: insurance ?? null,
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
        validFrom: visitPasses.validFrom,
        validUntil: visitPasses.validUntil,
        createdAt: visitPasses.createdAt,
        scannedInAt: visitPasses.scannedInAt,
        scannedOutAt: visitPasses.scannedOutAt,
        dahuaSynced: visitPasses.dahuaSynced,
        lotNumber: properties.lotNumber,
        propertyLabel: properties.label,
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
    dahuaSynced: boolean;
    lot: string;
    ownerName: string;
    kind?: string;
  };

  const ms = (v: Date | number | null | undefined) => {
    if (v == null) return null;
    return v instanceof Date ? v.getTime() : Number(v);
  };

  const notices: Notice[] = [];

  for (const r of passRows) {
    const until = ms(r.validUntil);
    const revoked = r.status === "revoked" || r.status === "cancelled";
    const expired = until != null && until < now;
    const closed = Boolean(r.scannedOutAt) || revoked || expired || r.status === "expired" || r.status === "used";
    notices.push({
      id: `pass:${r.id}`,
      source: "pass",
      guestName: r.guestName,
      guestDni: r.guestDni,
      patente: r.patente,
      status: closed
        ? r.scannedOutAt
          ? "completed"
          : revoked
            ? "revoked"
            : expired
              ? "expired"
              : r.status
        : r.scannedInAt
          ? "in_site"
          : "pending",
      bucket: closed ? "closed" : "pending",
      validFrom: r.validFrom,
      validUntil: r.validUntil,
      createdAt: r.createdAt,
      scannedInAt: r.scannedInAt,
      scannedOutAt: r.scannedOutAt,
      dahuaSynced: Boolean(r.dahuaSynced),
      lot: r.lotNumber ? `Lote ${r.lotNumber}` : r.propertyLabel || "Propiedad",
      ownerName: r.ownerName || "Propietario",
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
    company: string;
    policyNumber: string;
    validFrom?: number | string;
    validUntil: number | string;
    coverageType?: "responsabilidad_civil" | "terceros" | "todo_riesgo";
  };
  // Paso 5: Licencia de Conducir
  driverLicense?: {
    licenseNumber?: string;
    classes?: string;
    jurisdiction?: string;
    validUntil: number | string;
  };
  openRelay?: boolean;
  actuatorId?: string;
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
  const dniClean = normalizeDni(body.identity.dniNumber);

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

  // 2. Si es vehicular, resolver Vehículo, Seguro y Licencia
  let vehicleId: string | null = null;
  let insuranceId: string | null = null;
  let licenseId: string | null = null;

  if (body.isVehicular && body.vehicle?.plate) {
    const plateClean = normalizePlate(body.vehicle.plate);

    let vehicle = await db
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

    // Seguro de Vehículo Argentina
    if (body.insurance?.company && body.insurance?.policyNumber && body.insurance?.validUntil) {
      insuranceId = nid();
      const validUntilDate = new Date(body.insurance.validUntil);
      const isExpired = validUntilDate.getTime() < Date.now();

      await db.insert(vehicleInsurances).values({
        id: insuranceId,
        tenantId,
        vehicleId: vehicleId!,
        company: body.insurance.company.trim(),
        policyNumber: body.insurance.policyNumber.trim(),
        validFrom: body.insurance.validFrom ? new Date(body.insurance.validFrom) : null,
        validUntil: validUntilDate,
        coverageType: body.insurance.coverageType || "responsabilidad_civil",
        status: isExpired ? "expired" : "active",
        verifiedBy: c.get("user")?.name || "Guardia",
        createdAt: now,
      });
    }

    // Licencia de Conducir
    if (body.driverLicense?.validUntil) {
      licenseId = nid();
      await db.insert(driverLicenses).values({
        id: licenseId,
        tenantId,
        personId: person!.id,
        licenseNumber: (body.driverLicense.licenseNumber || dniClean).trim(),
        classes: body.driverLicense.classes || "B.1",
        jurisdiction: body.driverLicense.jurisdiction || null,
        validUntil: new Date(body.driverLicense.validUntil),
        createdAt: now,
      });
    }
  }

  // 3. Crear el registro consolidado de visita
  const visitId = nid();
  const passToken = `VIS-${dniClean}-${Math.floor(1000 + Math.random() * 9000)}`;

  await db.insert(visitRecords).values({
    id: visitId,
    tenantId,
    siteId,
    propertyId: body.destination.propertyId,
    personId: person!.id,
    vehicleId,
    insuranceId,
    licenseId,
    visitType: body.destination.visitType || "social",
    status: "in_site",
    authorizedBy: body.destination.authorizedBy.trim(),
    passToken,
    scannedInAt: now,
    notes: body.destination.notes || null,
    createdByUserId: c.get("user")?.id,
    createdAt: now,
  });

  // 4. Apertura física de barrera o puerta si fue solicitada
  if (body.openRelay) {
    try {
      if (body.actuatorId) {
        await fireActuator(scoped.site, body.actuatorId, "open");
      }
    } catch {
      /* Apertura no bloqueante */
    }
  }

  // 5. Registrar evento en auditoría
  await db.insert(events).values({
    id: nid(),
    siteId,
    type: "visitor_checkin",
    payload: JSON.stringify({
      visitId,
      personName: `${person!.firstName} ${person!.lastName}`,
      dni: dniClean,
      plate: body.vehicle?.plate || null,
      insuranceCompany: body.insurance?.company || null,
      authorizedBy: body.destination.authorizedBy,
      propertyId: body.destination.propertyId,
      isVehicular: body.isVehicular,
      timestamp: now.toISOString(),
    }),
    createdAt: now,
  });

  return c.json({
    ok: true,
    visitId,
    passToken,
    person,
    vehicleId,
    insuranceId,
    licenseId,
    message: "Ingreso de visita registrado exitosamente.",
  });
});

/** Registro de egreso / Check-out */
visitorsApi.post("/visitors/records/:id/checkout", async (c) => {
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;

  const id = c.req.param("id");
  const record = await db
    .select()
    .from(visitRecords)
    .where(and(eq(visitRecords.id, id), eq(visitRecords.siteId, scoped.site.id)))
    .get();

  if (!record) return c.json({ error: "Registro de visita no encontrado" }, 404);

  const now = new Date();
  await db
    .update(visitRecords)
    .set({
      status: "completed",
      scannedOutAt: now,
    })
    .where(eq(visitRecords.id, id));

  // Registrar evento de salida
  await db.insert(events).values({
    id: nid(),
    siteId: scoped.site.id,
    type: "visitor_checkout",
    payload: JSON.stringify({
      visitId: id,
      personId: record.personId,
      timestamp: now.toISOString(),
    }),
    createdAt: now,
  });

  return c.json({ ok: true, checkoutTime: now.toISOString() });
});
