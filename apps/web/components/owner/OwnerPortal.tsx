"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import {
  User,
  Users,
  Briefcase,
  QrCode,
  History,
  Plus,
  Trash2,
  Camera,
  CheckCircle2,
  Clock,
  Calendar,
  Share2,
  Copy,
  Check,
  Shield,
  Phone,
  Car,
  FileText,
  MapPin,
  LogOut,
  X,
  ScanFace,
  AlertTriangle,
} from "lucide-react";

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
  fullName: string | null;
  dni: string | null;
  phone: string | null;
  phoneAlt: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  photoBase64: string | null;
  dahuaUserId: string | null;
  dahuaSynced: boolean;
};

type FamilyMember = {
  id: string;
  name: string;
  dni: string | null;
  relationship: string;
  phone: string | null;
  photoBase64: string | null;
  dahuaSynced: boolean;
  active: boolean;
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
  dahuaSynced?: boolean;
  scannedInAt: string | number | null;
  scannedOutAt: string | number | null;
  qrPayload?: string;
};

const TABS = [
  { key: "ficha", label: "Mi Ficha (Titular)", icon: User },
  { key: "familia", label: "Grupo Familiar", icon: Users },
  { key: "servicios", label: "Personal y Servicios", icon: Briefcase },
  { key: "visitas", label: "Visitas y QR", icon: QrCode },
  { key: "historial", label: "Historial", icon: History },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const DAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function fmtDays(raw: string | number[] | null) {
  if (!raw) return "Todos los días";
  try {
    const arr = typeof raw === "string" ? (JSON.parse(raw) as number[]) : raw;
    return arr.map((d) => DAY_LABELS[d] ?? d).join(", ");
  } catch {
    return "Todos los días";
  }
}

function fmtDate(v: string | number) {
  return new Date(v).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

export function OwnerPortal() {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("ficha");
  const [property, setProperty] = useState<Property | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [family, setFamily] = useState<FamilyMember[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [passes, setPasses] = useState<Pass[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [userName, setUserName] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [syncingFace, setSyncingFace] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);

  // Modales
  const [showFamilyModal, setShowFamilyModal] = useState(false);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [showVisitModal, setShowVisitModal] = useState(false);

  const load = useCallback(async () => {
    try {
      const me = await api<{
        user: { name: string; role: string };
        property: Property;
        profile: Profile;
        services: Service[];
        familyMembers?: FamilyMember[];
      }>("/api/residents/me");

      setUserName(me.profile?.fullName || me.user.name);
      setProperty(me.property);
      setProfile(me.profile);
      setServices(me.services);
      setFamily(me.familyMembers || []);

      const p = await api<{ passes: Pass[] }>("/api/residents/me/visit-passes");
      setPasses(p.passes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar portal");
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  async function logout() {
    await api("/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  // Guardar ficha del titular y foto facial
  async function handleSaveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);

    const fullName = String(fd.get("fullName") || "").trim();
    const dni = String(fd.get("dni") || "").trim();
    const phone = String(fd.get("phone") || "").trim();
    const emergencyName = String(fd.get("emergencyName") || "").trim();
    const emergencyPhone = String(fd.get("emergencyPhone") || "").trim();

    try {
      await api("/api/residents/me", {
        method: "PATCH",
        body: JSON.stringify({
          fullName,
          dni,
          phone,
          emergencyName,
          emergencyPhone,
        }),
      });
      await load();
      alert("Datos del titular guardados correctamente");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al guardar");
    }
  }

  // Carga de foto facial del titular
  async function handleUploadOwnerPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const b64 = reader.result as string;
      try {
        setSyncingFace(true);
        await api("/api/residents/me", {
          method: "PATCH",
          body: JSON.stringify({ photoBase64: b64 }),
        });
        await load();
        setSyncSuccess(true);
        setTimeout(() => setSyncSuccess(false), 4000);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Error al subir foto");
      } finally {
        setSyncingFace(false);
      }
    };
    reader.readAsDataURL(file);
  }

  // Forzar sincronización del rostro con Dahua ASI
  async function handleSyncFaceDahua() {
    try {
      setSyncingFace(true);
      await api("/api/residents/me/sync-face", { method: "POST" });
      await load();
      setSyncSuccess(true);
      setTimeout(() => setSyncSuccess(false), 4000);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al sincronizar rostro");
    } finally {
      setSyncingFace(false);
    }
  }

  function handleCopy(text: string, id: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  }

  if (!property) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        {error ? (
          <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            {error}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-slate-500">
            <ScanFace className="h-5 w-5 animate-pulse text-blue-500" />
            <span>Cargando portal del propietario...</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-16">
      {/* Cabecera Principal de la App del Propietario */}
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-4">
          <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-2xl border-2 border-blue-500/30 bg-blue-50 dark:bg-slate-800">
            {profile?.photoBase64 ? (
              <img src={profile.photoBase64} alt={userName} className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center text-blue-600 dark:text-blue-400">
                <User className="h-7 w-7" />
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                {profile?.fullName || userName}
              </h1>
              <span className="rounded-md bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-800 dark:bg-blue-950/80 dark:text-blue-300">
                Lote {property.lotNumber}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {property.label} {property.address ? `· ${property.address}` : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {profile?.dahuaSynced ? (
            <div className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <span>Rostro Sincronizado en Lector ASI</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <span>Rostro no sincronizado</span>
            </div>
          )}

          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            <span>Salir</span>
          </button>
        </div>
      </header>

      {/* Navegación por Solapas */}
      <nav className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-xs font-bold transition-all ${
                active
                  ? "bg-blue-600 text-white shadow-md shadow-blue-600/20 dark:bg-blue-500"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{t.label}</span>
              {t.key === "familia" && family.length > 0 && (
                <span className={`rounded-full px-1.5 py-0.2 text-[10px] ${active ? "bg-white/25 text-white" : "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300"}`}>
                  {family.length}
                </span>
              )}
              {t.key === "servicios" && services.length > 0 && (
                <span className={`rounded-full px-1.5 py-0.2 text-[10px] ${active ? "bg-white/25 text-white" : "bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300"}`}>
                  {services.length}
                </span>
              )}
              {t.key === "visitas" && passes.filter((p) => p.status === "active").length > 0 && (
                <span className={`rounded-full px-1.5 py-0.2 text-[10px] ${active ? "bg-white/25 text-white" : "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-bold"}`}>
                  {passes.filter((p) => p.status === "active").length}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* PESTAÑA 1: FICHA DEL TITULAR */}
      {tab === "ficha" && (
        <section className="space-y-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {/* Tarjeta de Reconocimiento Facial Titular */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:col-span-1">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Reconocimiento Facial
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Foto para validación en lectores del barrio
              </p>

              <div className="mt-4 flex flex-col items-center">
                <div className="relative h-40 w-40 overflow-hidden rounded-2xl border-2 border-slate-300 bg-slate-50 shadow-inner dark:border-slate-700 dark:bg-slate-800">
                  {profile?.photoBase64 ? (
                    <img
                      src={profile.photoBase64}
                      alt={userName}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="grid h-full place-items-center text-slate-400">
                      <ScanFace className="h-12 w-12 opacity-50" />
                      <span className="text-[11px] font-semibold">Sin foto cargada</span>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex flex-col gap-2 w-full">
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition-colors">
                    <Camera className="h-4 w-4" />
                    <span>Cambiar / Subir Foto</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleUploadOwnerPhoto}
                      className="hidden"
                    />
                  </label>

                  {profile?.photoBase64 && (
                    <button
                      type="button"
                      onClick={handleSyncFaceDahua}
                      disabled={syncingFace}
                      className="flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-colors disabled:opacity-50 shadow-sm"
                    >
                      <ScanFace className="h-4 w-4" />
                      <span>
                        {syncingFace ? "Sincronizando..." : "Sincronizar con Dahua ASI"}
                      </span>
                    </button>
                  )}

                  {syncSuccess && (
                    <div className="flex items-center justify-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Rostro actualizado en terminales</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Formulario de Datos del Titular */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:col-span-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Datos del Responsable de la Casa
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Titular responsable del lote y autorizaciones
              </p>

              <form onSubmit={handleSaveProfile} className="mt-4 space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Nombre Completo
                    </label>
                    <input
                      type="text"
                      name="fullName"
                      defaultValue={profile?.fullName || userName}
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      DNI Argentino
                    </label>
                    <input
                      type="text"
                      name="dni"
                      defaultValue={profile?.dni || ""}
                      placeholder="Ej: 35123456"
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Teléfono de Contacto
                    </label>
                    <input
                      type="tel"
                      name="phone"
                      defaultValue={profile?.phone || ""}
                      placeholder="Ej: +54 9 11 5555-1234"
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Contacto de Emergencia
                    </label>
                    <input
                      type="text"
                      name="emergencyName"
                      defaultValue={profile?.emergencyName || ""}
                      placeholder="Nombre del contacto"
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Teléfono de Emergencia
                    </label>
                    <input
                      type="tel"
                      name="emergencyPhone"
                      defaultValue={profile?.emergencyPhone || ""}
                      placeholder="Teléfono de emergencia"
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Lote / Parcela
                    </label>
                    <input
                      type="text"
                      value={`Lote ${property.lotNumber} (${property.label})`}
                      disabled
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-500 cursor-not-allowed"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-colors shadow-sm"
                  >
                    Guardar Ficha
                  </button>
                </div>
              </form>
            </div>
          </div>
        </section>
      )}

      {/* PESTAÑA 2: GRUPO FAMILIAR */}
      {tab === "familia" && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Grupo Familiar del Lote
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Empadroná a los miembros de tu familia para habilitarles reconocimiento facial automático
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowFamilyModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-colors shadow-sm"
            >
              <Plus className="h-4 w-4" />
              <span>Agregar Familiar</span>
            </button>
          </div>

          {family.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center dark:border-slate-800">
              <Users className="mx-auto h-10 w-10 text-slate-400 dark:text-slate-600 mb-2" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                No hay familiares registrados
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Podés agregar a tu cónyuge, hijos o convivientes con su foto facial para que el lector del barrio los reconozca.
              </p>
              <button
                type="button"
                onClick={() => setShowFamilyModal(true)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 dark:bg-blue-500 transition-colors"
              >
                <Plus className="h-4 w-4" />
                <span>Registrar Primer Familiar</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {family.map((f) => (
                <div
                  key={f.id}
                  className="relative flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex items-start gap-3">
                    <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800">
                      {f.photoBase64 ? (
                        <img src={f.photoBase64} alt={f.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="grid h-full place-items-center text-slate-400">
                          <User className="h-6 w-6" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-bold text-slate-900 dark:text-white">
                        {f.name}
                      </h3>
                      <p className="text-xs font-semibold text-blue-600 dark:text-blue-400 capitalize">
                        {f.relationship}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        DNI: {f.dni || "—"}
                      </p>
                      {f.phone && (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Tel: {f.phone}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        f.dahuaSynced
                          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                          : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                      }`}
                    >
                      {f.dahuaSynced ? (
                        <>
                          <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                          Facial Activo
                        </>
                      ) : (
                        "Pendiente Facial"
                      )}
                    </span>

                    <button
                      type="button"
                      onClick={async () => {
                        if (confirm(`¿Quitar a ${f.name} del grupo familiar?`)) {
                          await api(`/api/residents/me/family/${f.id}`, { method: "DELETE" });
                          load();
                        }
                      }}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 transition-colors"
                      title="Quitar familiar"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* PESTAÑA 3: PERSONAL Y SERVICIOS */}
      {tab === "servicios" && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Personal y Servicios Autorizados
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Empleadas domésticas, jardineros, pileteros y cuidadores con rangos de días y horarios
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowServiceModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-colors shadow-sm"
            >
              <Plus className="h-4 w-4" />
              <span>Nuevo Servicio</span>
            </button>
          </div>

          {services.length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center dark:border-slate-800">
              <Briefcase className="mx-auto h-10 w-10 text-slate-400 dark:text-slate-600 mb-2" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                Sin personal de servicio cargado
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Registrá a tu personal habitual para que guardia agilice su ingreso según sus días y horarios.
              </p>
              <button
                type="button"
                onClick={() => setShowServiceModal(true)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 dark:bg-blue-500 transition-colors"
              >
                <Plus className="h-4 w-4" />
                <span>Agregar Primer Servicio</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {services.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white">{s.name}</h3>
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300 capitalize">
                          {s.role}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={async () => {
                          if (confirm(`¿Quitar autorización para ${s.name}?`)) {
                            await api(`/api/residents/me/services/${s.id}`, { method: "DELETE" });
                            load();
                          }
                        }}
                        className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="mt-3 space-y-1 text-xs text-slate-600 dark:text-slate-400">
                      <p className="flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5 text-slate-400" />
                        <span>
                          {s.horaDesde && s.horaHasta ? `${s.horaDesde} a ${s.horaHasta} hs` : "Sin restricción de horario"}
                        </span>
                      </p>
                      <p className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5 text-slate-400" />
                        <span>{fmtDays(s.diasSemana)}</span>
                      </p>
                      {s.dni && <p>DNI: {s.dni}</p>}
                      {s.patente && (
                        <p className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                          Patente: {s.patente}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* PESTAÑA 4: VISITAS Y GENERACIÓN DE QR */}
      {tab === "visitas" && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Pases de Visitas & Invitaciones QR
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Generá pases que se sincronizan de inmediato con el terminal Dahua ASI de la entrada
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowVisitModal(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-colors shadow-sm"
            >
              <Plus className="h-4 w-4" />
              <span>Autorizar Visita (QR)</span>
            </button>
          </div>

          {passes.filter((p) => p.status === "active").length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center dark:border-slate-800">
              <QrCode className="mx-auto h-10 w-10 text-slate-400 dark:text-slate-600 mb-2" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                No tenés visitas activas generadas
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Creá una invitación con QR para compartir por WhatsApp. Tu invitado solo acerca el celular a la cámara del ASI y entra sin demoras.
              </p>
              <button
                type="button"
                onClick={() => setShowVisitModal(true)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 dark:bg-blue-500 transition-colors"
              >
                <Plus className="h-4 w-4" />
                <span>Generar Pase QR</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {passes
                .filter((p) => p.status === "active")
                .map((p) => {
                  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
                    p.qrPayload || p.id
                  )}`;
                  const shareText = `Hola ${p.guestName}! Te comparto tu código QR de acceso para ingresar a Barrio Las Acacias (Lote ${property.lotNumber}). Validez: ${fmtDate(p.validFrom)} hasta ${fmtDate(p.validUntil)}. Al llegar, mostralo frente a la cámara del lector.`;
                  const waUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;

                  return (
                    <div
                      key={p.id}
                      className="flex flex-col justify-between rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-extrabold text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 uppercase">
                            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                            Pase Activo · Dahua ASI OK
                          </span>
                          <h3 className="mt-1 text-base font-bold text-slate-900 dark:text-white">
                            {p.guestName}
                          </h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            DNI: {p.guestDni || "No especificado"}
                            {p.patente ? ` · Patente: ${p.patente}` : ""}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={async () => {
                            if (confirm(`¿Revocar pase para ${p.guestName}?`)) {
                              await api(`/api/residents/me/visit-passes/${p.id}/revoke`, {
                                method: "POST",
                              });
                              load();
                            }
                          }}
                          className="rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 transition-colors"
                          title="Revocar pase"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="mt-4 flex flex-col items-center justify-center rounded-xl bg-slate-50 p-4 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800">
                        <img
                          src={qrUrl}
                          alt="QR de Acceso"
                          className="h-36 w-36 rounded-lg border border-slate-200 bg-white p-1 shadow-sm"
                        />
                        <p className="mt-2 text-center font-mono text-[10px] text-slate-500 dark:text-slate-400">
                          {p.qrPayload || p.id}
                        </p>
                      </div>

                      <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
                        <p className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5" />
                          <span>
                            Vigencia: {fmtDate(p.validFrom)} → {fmtDate(p.validUntil)}
                          </span>
                        </p>
                      </div>

                      <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                        <a
                          href={waUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700 transition-colors shadow-sm"
                        >
                          <Share2 className="h-3.5 w-3.5" />
                          <span>WhatsApp</span>
                        </a>

                        <button
                          type="button"
                          onClick={() => handleCopy(p.qrPayload || p.id, p.id)}
                          className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
                        >
                          {copiedId === p.id ? (
                            <>
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                              <span>Copiado</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3.5 w-3.5" />
                              <span>Copiar</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </section>
      )}

      {/* PESTAÑA 5: HISTORIAL */}
      {tab === "historial" && (
        <section className="space-y-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Historial de Pases y Visitas Anteriores
          </h2>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-300">
                  <tr>
                    <th className="px-4 py-3">Invitado</th>
                    <th className="px-4 py-3">DNI / Patente</th>
                    <th className="px-4 py-3">Vigencia</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3">Ingreso Real</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                  {passes.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">
                        No hay registros en el historial
                      </td>
                    </tr>
                  ) : (
                    passes.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/50">
                        <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                          {p.guestName}
                        </td>
                        <td className="px-4 py-3">
                          {p.guestDni || "—"} {p.patente ? `(${p.patente})` : ""}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px]">
                          {fmtDate(p.validFrom)} → {fmtDate(p.validUntil)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                              p.status === "active"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300"
                                : p.status === "completed"
                                ? "bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300"
                                : "bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300"
                            }`}
                          >
                            {p.status === "active"
                              ? "Activo"
                              : p.status === "completed"
                              ? "Completado"
                              : "Revocado"}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                          {p.scannedInAt ? fmtDate(p.scannedInAt) : "Sin marcar"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* MODAL 1: AGREGAR FAMILIAR (CENTRADOS LIMPIOS) */}
      {showFamilyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Agregar Familiar al Lote
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowFamilyModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const name = String(fd.get("name") || "").trim();
                const dni = String(fd.get("dni") || "").trim();
                const relationship = String(fd.get("relationship") || "familiar");
                const phone = String(fd.get("phone") || "").trim();
                const fileInput = e.currentTarget.elements.namedItem("photo") as HTMLInputElement;
                const file = fileInput?.files?.[0];

                let photoBase64: string | undefined = undefined;
                if (file) {
                  photoBase64 = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result as string);
                    reader.readAsDataURL(file);
                  });
                }

                try {
                  await api("/api/residents/me/family", {
                    method: "POST",
                    body: JSON.stringify({ name, dni, relationship, phone, photoBase64 }),
                  });
                  setShowFamilyModal(false);
                  load();
                } catch (err) {
                  alert(err instanceof Error ? err.message : "Error");
                }
              }}
              className="mt-4 space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Nombre Completo *
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="Ej: Lucía Gusman"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Parentesco *
                  </label>
                  <select
                    name="relationship"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="cónyuge">Cónyuge / Pareja</option>
                    <option value="hijo/a">Hijo / Hija</option>
                    <option value="padre/madre">Padre / Madre</option>
                    <option value="familiar">Otro Familiar</option>
                    <option value="conviviente">Conviviente</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    DNI
                  </label>
                  <input
                    type="text"
                    name="dni"
                    placeholder="Ej: 42123456"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Teléfono
                </label>
                <input
                  type="tel"
                  name="phone"
                  placeholder="Ej: +54 9 11 4444-5555"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Foto Facial para Reconocimiento en Lector ASI
                </label>
                <input
                  type="file"
                  name="photo"
                  accept="image/*"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 file:mr-2 file:rounded-md file:border-0 file:bg-blue-50 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-blue-700 hover:file:bg-blue-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Subí una foto nítida de frente para habilitar el acceso automático por cámara.
                </p>
              </div>

              <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowFamilyModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 dark:bg-blue-500 transition-colors shadow-sm"
                >
                  Guardar y Sincronizar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: NUEVO SERVICIO / PERSONAL */}
      {showServiceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Briefcase className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Autorizar Personal de Servicio
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowServiceModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const name = String(fd.get("name") || "").trim();
                const role = String(fd.get("role") || "empleada");
                const dni = String(fd.get("dni") || "").trim();
                const patente = String(fd.get("patente") || "").trim();
                const horaDesde = String(fd.get("horaDesde") || "").trim();
                const horaHasta = String(fd.get("horaHasta") || "").trim();

                const days: number[] = [];
                [0, 1, 2, 3, 4, 5, 6].forEach((d) => {
                  if (fd.get(`day_${d}`) === "on") days.push(d);
                });

                try {
                  await api("/api/residents/me/services", {
                    method: "POST",
                    body: JSON.stringify({
                      name,
                      role,
                      dni,
                      patente,
                      horaDesde,
                      horaHasta,
                      diasSemana: days.length > 0 ? days : undefined,
                    }),
                  });
                  setShowServiceModal(false);
                  load();
                } catch (err) {
                  alert(err instanceof Error ? err.message : "Error");
                }
              }}
              className="mt-4 space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Nombre Completo *
                </label>
                <input
                  type="text"
                  name="name"
                  required
                  placeholder="Ej: Rosa Benítez"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Función / Rol *
                  </label>
                  <select
                    name="role"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  >
                    <option value="empleada">Empleada Doméstica</option>
                    <option value="jardinero">Jardinero / Parquista</option>
                    <option value="piletero">Piletero</option>
                    <option value="cuidador">Cuidador / Niñera</option>
                    <option value="chofer">Chofer</option>
                    <option value="mantenimiento">Mantenimiento</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    DNI
                  </label>
                  <input
                    type="text"
                    name="dni"
                    placeholder="Ej: 28123456"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Patente de Rodado (Opcional)
                </label>
                <input
                  type="text"
                  name="patente"
                  placeholder="Ej: AF123ZZ"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono text-slate-900 uppercase focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Horario Desde
                  </label>
                  <input
                    type="time"
                    name="horaDesde"
                    defaultValue="08:00"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Horario Hasta
                  </label>
                  <input
                    type="time"
                    name="horaHasta"
                    defaultValue="17:00"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Días Permitidos
                </label>
                <div className="flex flex-wrap gap-2">
                  {DAY_LABELS.map((label, idx) => (
                    <label
                      key={label}
                      className="flex items-center gap-1 text-xs text-slate-700 dark:text-slate-300 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        name={`day_${idx}`}
                        defaultChecked={idx >= 1 && idx <= 5}
                        className="rounded text-blue-600 focus:ring-0"
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowServiceModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 dark:bg-blue-500 transition-colors shadow-sm"
                >
                  Autorizar Servicio
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: AUTORIZAR VISITA & QR SINCRONIZADO DAHUA */}
      {showVisitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <QrCode className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Generar Invitación QR
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowVisitModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const guestName = String(fd.get("guestName") || "").trim();
                const guestDni = String(fd.get("guestDni") || "").trim();
                const patente = String(fd.get("patente") || "").trim();
                const validFrom = String(fd.get("validFrom") || "").trim();
                const validUntil = String(fd.get("validUntil") || "").trim();

                try {
                  await api("/api/residents/me/visit-passes", {
                    method: "POST",
                    body: JSON.stringify({
                      guestName,
                      guestDni,
                      patente,
                      validFrom: validFrom || new Date().toISOString(),
                      validUntil:
                        validUntil ||
                        new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
                    }),
                  });
                  setShowVisitModal(false);
                  load();
                  setTab("visitas");
                } catch (err) {
                  alert(err instanceof Error ? err.message : "Error");
                }
              }}
              className="mt-4 space-y-4"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Nombre del Visitante *
                </label>
                <input
                  type="text"
                  name="guestName"
                  required
                  placeholder="Ej: Marcelo Gallardo"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    DNI Visitante
                  </label>
                  <input
                    type="text"
                    name="guestDni"
                    placeholder="Ej: 30123456"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Patente (Si ingresa en auto)
                  </label>
                  <input
                    type="text"
                    name="patente"
                    placeholder="Ej: AF123ZZ"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono text-slate-900 uppercase focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Válido Desde
                  </label>
                  <input
                    type="datetime-local"
                    name="validFrom"
                    defaultValue={new Date().toISOString().slice(0, 16)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Válido Hasta
                  </label>
                  <input
                    type="datetime-local"
                    name="validUntil"
                    defaultValue={new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 16)}
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300">
                <p className="font-semibold">Sincronización Automática con Dahua ASI:</p>
                <p className="mt-0.5 text-[11px] opacity-80">
                  Al confirmar, el código QR se habilita en el lector de portería. Tu invitado podrá escanearlo directo desde su celular.
                </p>
              </div>

              <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowVisitModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 dark:bg-blue-500 transition-colors shadow-sm"
                >
                  Generar Pase y Sincronizar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
