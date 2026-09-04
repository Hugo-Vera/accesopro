import { engineBridgePost } from "./siteEngine.js";

type AuthRow = {
  id: string;
  guestName: string;
  guestDni: string | null;
  patente: string | null;
  fechaDesde: Date;
  fechaHasta: Date;
  active: boolean;
};

type PropertyRow = {
  lotNumber: string;
};

export async function syncAuthorizationToEngine(property: PropertyRow, auth: AuthRow) {
  if (!auth.active) return;
  try {
    await engineBridgePost("/api/accesopro/pre-autorizaciones", {
      accesopro_id: auth.id,
      lote: property.lotNumber,
      patente: auth.patente,
      dni: auth.guestDni,
      nombre: auth.guestName.split(" ")[0] ?? auth.guestName,
      apellido: auth.guestName.split(" ").slice(1).join(" ") || null,
      fecha_desde: auth.fechaDesde.toISOString(),
      fecha_hasta: auth.fechaHasta.toISOString(),
      activo: true,
    });
  } catch {
    /* motor offline o módulo ALPR apagado */
  }
}

export async function revokeAuthorizationOnEngine(authId: string) {
  try {
    await engineBridgePost("/api/accesopro/pre-autorizaciones/revoke", { accesopro_id: authId });
  } catch {
    /* motor offline */
  }
}

export async function syncOwnerDniToEngine(lotNumber: string, dni: string, nombre: string) {
  if (!dni) return;
  try {
    await engineBridgePost("/api/accesopro/residentes", {
      lote: lotNumber,
      dni,
      nombre,
      categoria: "propietario",
    });
  } catch {
    /* motor offline */
  }
}
