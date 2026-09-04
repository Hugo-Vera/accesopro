"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

type Property = {
  id: string;
  lotNumber: string;
  label: string;
  address: string | null;
  mapLat: string | null;
  mapLng: string | null;
  notes: string | null;
};

type Profile = {
  dni: string | null;
  phone: string | null;
  phoneAlt: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
};

type Service = {
  id: string;
  role: string;
  name: string;
  dni: string | null;
  patente: string | null;
  phone: string | null;
  horaDesde: string | null;
  horaHasta: string | null;
  diasSemana: string | null;
  notes: string | null;
  active: boolean;
};

type Auth = {
  id: string;
  kind: string;
  guestName: string;
  guestDni: string | null;
  patente: string | null;
  fechaDesde: string | number;
  fechaHasta: string | number;
  horaDesde: string | null;
  horaHasta: string | null;
  diasSemana: number[] | null;
  notes: string | null;
  active: boolean;
};

type Pass = {
  id: string;
  guestName: string;
  guestDni: string | null;
  patente: string | null;
  validFrom: string | number;
  validUntil: string | number;
  horaDesde: string | null;
  horaHasta: string | null;
  status: string;
  scannedInAt: string | number | null;
  scannedOutAt: string | number | null;
  qrPayload?: string;
};

const TABS = ["propiedad", "servicios", "autorizaciones", "qr", "historial"] as const;
const DAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function fmtDays(raw: string | number[] | null) {
  if (!raw) return "Todos los días";
  const arr = typeof raw === "string" ? (JSON.parse(raw) as number[]) : raw;
  return arr.map((d) => DAY_LABELS[d] ?? d).join(", ");
}

function fmtDate(v: string | number) {
  return new Date(v).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

export function OwnerPortal() {
  const router = useRouter();
  const [tab, setTab] = useState<typeof TABS[number]>("propiedad");
  const [property, setProperty] = useState<Property | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [auths, setAuths] = useState<Auth[]>([]);
  const [passes, setPasses] = useState<Pass[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [userName, setUserName] = useState("");

  const load = useCallback(async () => {
    const me = await api<{
      user: { name: string; role: string };
      property: Property;
      profile: Profile;
      services: Service[];
    }>("/api/residents/me");
    if (me.user.role !== "resident") {
      router.replace("/dashboard");
      return;
    }
    setUserName(me.user.name);
    setProperty(me.property);
    setProfile(me.profile);
    setServices(me.services);
    const a = await api<{ authorizations: Auth[] }>("/api/residents/me/authorizations");
    setAuths(a.authorizations.filter((x) => x.active));
    const p = await api<{ passes: Pass[] }>("/api/residents/me/visit-passes");
    setPasses(p.passes);
  }, [router]);

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Error"));
  }, [load]);

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    router.replace("/");
  }

  if (!property) {
    return error ? <p className="text-danger">{error}</p> : <p className="text-muted">Cargando…</p>;
  }

  const lat = property.mapLat ? Number(property.mapLat) : null;
  const lng = property.mapLng ? Number(property.mapLng) : null;
  const mapUrl =
    lat && lng
      ? `https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.002},${lat - 0.002},${lng + 0.002},${lat + 0.002}&layer=mapnik&marker=${lat},${lng}`
      : null;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div>
          <h1 className="text-xl font-bold">Mi propiedad</h1>
          <p className="text-sm text-muted">{userName} · Lote {property.lotNumber}</p>
        </div>
        <button type="button" className="btn-ghost" onClick={logout}>Salir</button>
      </header>

      <nav className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            className={`rounded-lg px-3 py-1.5 text-sm ${tab === t ? "bg-accent text-white" : "bg-panel2 text-muted"}`}
            onClick={() => setTab(t)}
          >
            {t === "propiedad" ? "Propiedad" : t === "servicios" ? "Servicios" : t === "autorizaciones" ? "Autorizaciones" : t === "qr" ? "QR visitas" : "Historial"}
          </button>
        ))}
      </nav>

      {tab === "propiedad" && (
        <section className="card space-y-4 p-4">
          <div>
            <h2 className="font-semibold">{property.label}</h2>
            <p className="text-sm text-muted">{property.address ?? "Sin dirección cargada"}</p>
            <p className="mt-2 text-sm">DNI {profile?.dni ?? "—"} · Tel. {profile?.phone ?? "—"}</p>
          </div>
          {mapUrl ? (
            <div className="overflow-hidden rounded-xl border border-line">
              <iframe title="Mapa del lote" src={mapUrl} className="h-64 w-full" />
              <p className="px-3 py-2 text-xs text-muted">Pin GPS: {lat}, {lng}</p>
            </div>
          ) : (
            <p className="text-sm text-muted">El administración puede cargar el pin en el mapa.</p>
          )}
        </section>
      )}

      {tab === "servicios" && (
        <section className="space-y-3">
          <ServiceForm onDone={load} />
          {services.map((s) => (
            <div key={s.id} className="card flex flex-wrap justify-between gap-2 p-3 text-sm">
              <div>
                <span className="font-medium">{s.name}</span>
                <span className="ml-2 text-muted">({s.role})</span>
                <p className="text-muted">
                  {s.horaDesde && s.horaHasta ? `${s.horaDesde}–${s.horaHasta}` : "Sin horario"} · {fmtDays(s.diasSemana)}
                </p>
              </div>
              <button
                type="button"
                className="text-xs text-danger"
                onClick={async () => {
                  await api(`/api/residents/me/services/${s.id}`, { method: "DELETE" });
                  load();
                }}
              >
                Quitar
              </button>
            </div>
          ))}
        </section>
      )}

      {tab === "autorizaciones" && (
        <section className="space-y-3">
          <AuthForm onDone={load} />
          {auths.map((a) => (
            <div key={a.id} className="card p-3 text-sm">
              <p className="font-medium">{a.guestName} <span className="text-muted">({a.kind})</span></p>
              <p className="text-muted">
                {fmtDate(a.fechaDesde)} → {fmtDate(a.fechaHasta)}
                {a.horaDesde && a.horaHasta ? ` · ${a.horaDesde}–${a.horaHasta}` : ""}
              </p>
              <p className="text-muted">{fmtDays(a.diasSemana)}</p>
              <button
                type="button"
                className="mt-1 text-xs text-danger"
                onClick={async () => {
                  await api(`/api/residents/me/authorizations/${a.id}`, { method: "DELETE" });
                  load();
                }}
              >
                Revocar
              </button>
            </div>
          ))}
        </section>
      )}

      {tab === "qr" && (
        <section className="space-y-3">
          <QrForm onDone={load} />
          {passes.map((p) => (
            <div key={p.id} className="card flex flex-wrap gap-4 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{p.guestName}</p>
                <p className="text-muted">{fmtDate(p.validFrom)} → {fmtDate(p.validUntil)} · {p.status}</p>
                {p.qrPayload ? (
                  <p className="mt-1 break-all font-mono text-xs">{p.qrPayload}</p>
                ) : null}
              </div>
              {p.qrPayload && p.status === "active" ? (
                <img
                  alt="QR visita"
                  className="h-24 w-24 rounded border border-line bg-white p-1"
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(p.qrPayload)}`}
                />
              ) : null}
              {p.status === "active" ? (
                <button
                  type="button"
                  className="text-xs text-danger"
                  onClick={async () => {
                    await api(`/api/residents/me/visit-passes/${p.id}/revoke`, { method: "POST" });
                    load();
                  }}
                >
                  Revocar
                </button>
              ) : null}
            </div>
          ))}
        </section>
      )}

      {tab === "historial" && (
        <section className="card space-y-3 p-4 text-sm">
          <h2 className="font-semibold">Visitas y autorizaciones</h2>
          {passes.map((p) => (
            <div key={p.id} className="border-b border-line py-2">
              <span className="font-medium">{p.guestName}</span>
              <span className="text-muted"> · QR {p.status}</span>
              {p.scannedInAt ? <span className="text-muted"> · IN {fmtDate(p.scannedInAt)}</span> : null}
              {p.scannedOutAt ? <span className="text-muted"> · OUT {fmtDate(p.scannedOutAt)}</span> : null}
            </div>
          ))}
          {auths.map((a) => (
            <div key={a.id} className="border-b border-line py-2 text-muted">
              Auth: {a.guestName} ({a.kind}) {fmtDate(a.fechaDesde)}–{fmtDate(a.fechaHasta)}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function ServiceForm({ onDone }: { onDone: () => void }) {
  const [role, setRole] = useState("jardinero");
  const [name, setName] = useState("");
  const [horaDesde, setHoraDesde] = useState("08:00");
  const [horaHasta, setHoraHasta] = useState("17:00");

  async function submit(e: FormEvent) {
    e.preventDefault();
    await api("/api/residents/me/services", {
      method: "POST",
      body: JSON.stringify({ role, name, horaDesde, horaHasta, diasSemana: [1, 2, 3, 4, 5] }),
    });
    setName("");
    onDone();
  }

  return (
    <form onSubmit={submit} className="card grid gap-2 p-3 sm:grid-cols-2">
      <select className="cfg-input" value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="jardinero">Jardinero</option>
        <option value="empleada">Empleada</option>
        <option value="mantenimiento">Mantenimiento</option>
        <option value="otro">Otro</option>
      </select>
      <input className="cfg-input" placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} required />
      <input className="cfg-input" type="time" value={horaDesde} onChange={(e) => setHoraDesde(e.target.value)} />
      <input className="cfg-input" type="time" value={horaHasta} onChange={(e) => setHoraHasta(e.target.value)} />
      <button type="submit" className="btn-primary sm:col-span-2">Agregar servicio</button>
    </form>
  );
}

function AuthForm({ onDone }: { onDone: () => void }) {
  const [kind, setKind] = useState("empleada");
  const [guestName, setGuestName] = useState("");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [horaDesde, setHoraDesde] = useState("09:00");
  const [horaHasta, setHoraHasta] = useState("18:00");

  async function submit(e: FormEvent) {
    e.preventDefault();
    await api("/api/residents/me/authorizations", {
      method: "POST",
      body: JSON.stringify({ kind, guestName, fechaDesde, fechaHasta, horaDesde, horaHasta, diasSemana: [1, 2, 3, 4, 5] }),
    });
    setGuestName("");
    onDone();
  }

  return (
    <form onSubmit={submit} className="card grid gap-2 p-3 sm:grid-cols-2">
      <select className="cfg-input" value={kind} onChange={(e) => setKind(e.target.value)}>
        <option value="empleada">Empleada</option>
        <option value="jardinero">Jardinero</option>
        <option value="proveedor">Proveedor</option>
        <option value="visita">Visita general</option>
      </select>
      <input className="cfg-input" placeholder="Nombre" value={guestName} onChange={(e) => setGuestName(e.target.value)} required />
      <input className="cfg-input" type="datetime-local" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} required />
      <input className="cfg-input" type="datetime-local" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} required />
      <input className="cfg-input" type="time" value={horaDesde} onChange={(e) => setHoraDesde(e.target.value)} />
      <input className="cfg-input" type="time" value={horaHasta} onChange={(e) => setHoraHasta(e.target.value)} />
      <button type="submit" className="btn-primary sm:col-span-2">Crear autorización</button>
    </form>
  );
}

function QrForm({ onDone }: { onDone: () => void }) {
  const [guestName, setGuestName] = useState("");
  const [validUntil, setValidUntil] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    await api("/api/residents/me/visit-passes", {
      method: "POST",
      body: JSON.stringify({
        guestName,
        validFrom: new Date().toISOString(),
        validUntil: validUntil || new Date(Date.now() + 8 * 3600000).toISOString(),
      }),
    });
    setGuestName("");
    onDone();
  }

  return (
    <form onSubmit={submit} className="card grid gap-2 p-3 sm:grid-cols-2">
      <input className="cfg-input" placeholder="Nombre del visitante" value={guestName} onChange={(e) => setGuestName(e.target.value)} required />
      <input className="cfg-input" type="datetime-local" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
      <button type="submit" className="btn-primary sm:col-span-2">Generar QR de visita</button>
    </form>
  );
}
