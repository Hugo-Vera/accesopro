"use client";

import { FormEvent, useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { LocalQr, downloadQrPng } from "@/components/LocalQr";
import { PortalPush } from "@/components/owner/PortalPush";
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
  Copy,
  Check,
  Download,
  ChevronDown,
  Shield,
  Phone,
  Car,
  FileText,
  MapPin,
  LogOut,
  X,
  Mail,
  ScanFace,
  Siren,
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

type AccessQr = {
  active: boolean;
  credentialId: string | null;
  payload: string | null;
  qrHint: string | null;
  validFrom: string | number | null;
  validUntil: string | number | null;
  label: string | null;
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
  userId?: string | null;
  birthDate?: string | null;
  accessQr?: AccessQr | null;
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

const OPEN_PASS = new Set(["active", "preauthorized", "awaiting_entry", "in_site", "awaiting_exit", "temp_out"]);

function isOpenPass(status: string) {
  return OPEN_PASS.has(status);
}

function passStatusLabel(status: string) {
  if (status === "preauthorized" || status === "active") return "Autorizado";
  if (status === "awaiting_entry") return "Esperando entrada";
  if (status === "in_site") return "En predio";
  if (status === "awaiting_exit") return "Esperando salida";
  if (status === "temp_out") return "Salió, vuelve";
  if (status === "completed") return "Completado";
  if (status === "denied") return "Denegado";
  if (status === "expired") return "Vencido";
  return "Revocado";
}

type PortalFeatures = {
  face: boolean;
  qr: boolean;
  fingerprint: boolean;
  card: boolean;
  password: boolean;
};

const ALL_TABS = [
  { key: "ficha", label: "Mi Ficha (Titular)", icon: User },
  { key: "familia", label: "Grupo Familiar", icon: Users },
  { key: "servicios", label: "Personal y Servicios", icon: Briefcase },
  { key: "visitas", label: "Visitas y QR", icon: QrCode, needQr: true },
  { key: "historial", label: "Historial", icon: History },
] as const;

type TabKey = (typeof ALL_TABS)[number]["key"];

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

function visitShareText(guestName: string, barrio: string, lote: string, from: string | number, until: string | number) {
  const name = barrio.trim() || "el barrio";
  return `Hola ${guestName}\nQR ${name} · Lote ${lote}\nVigente ${fmtDate(from)} – ${fmtDate(until)}. Mostralo en portería; no abre solo.`;
}

function qrFileSlug(name: string) {
  const s = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return s || "visita";
}

type VisitSection = "validez" | "documento" | "llegada" | "acompanantes" | "notas" | null;

function VisitAccordion({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left text-xs font-bold text-slate-800 dark:text-slate-100"
      >
        {title}
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <div
        className={
          open
            ? "space-y-3 border-t border-slate-100 px-3 py-3 dark:border-slate-800"
            : "hidden"
        }
      >
        {children}
      </div>
    </div>
  );
}

function formatStay(inAt: string | number | null, outAt: string | number | null) {
  if (inAt == null || outAt == null) return "—";
  const a = new Date(inAt).getTime();
  const b = new Date(outAt).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return "—";
  const mins = Math.round((b - a) / 60000);
  if (mins < 1) return "menos de 1 min";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
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
  const [accessQr, setAccessQr] = useState<AccessQr | null>(null);
  const [accessQrBusy, setAccessQrBusy] = useState(false);

  // Modales
  const [showFamilyModal, setShowFamilyModal] = useState(false);
  const [inviteFamily, setInviteFamily] = useState<FamilyMember | null>(null);
  const [inviteShare, setInviteShare] = useState<{ waUrl: string; shareText: string; activateUrl: string } | null>(null);
  const [canManageFamily, setCanManageFamily] = useState(true);
  const [canManageStaff, setCanManageStaff] = useState(true);
  const [canManageSchedules, setCanManageSchedules] = useState(true);
  const [isTitular, setIsTitular] = useState(true);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [showVisitModal, setShowVisitModal] = useState(false);
  const [visitSection, setVisitSection] = useState<VisitSection>(null);
  const [visitArrival, setVisitArrival] = useState("peatonal");
  const [visitUseDefault, setVisitUseDefault] = useState(true);
  const [visitAuthDefaultHours, setVisitAuthDefaultHours] = useState(24);
  const [tenantName, setTenantName] = useState("");
  const [panicEnabled, setPanicEnabled] = useState(false);
  const [features, setFeatures] = useState<PortalFeatures>({
    face: true,
    qr: false,
    fingerprint: false,
    card: false,
    password: false,
  });
  const [sosBusy, setSosBusy] = useState(false);
  const [sosMsg, setSosMsg] = useState<string | null>(null);
  const [notices, setNotices] = useState<
    {
      id: string;
      kind: string;
      status: string;
      title: string;
      message: string;
      expiresAt: string | number | null;
      decidedByName?: string | null;
    }[]
  >([]);
  useEscapeKey(() => {
    if (inviteShare) setInviteShare(null);
    else if (inviteFamily) setInviteFamily(null);
    else if (showFamilyModal) setShowFamilyModal(false);
    else if (showServiceModal) setShowServiceModal(false);
    else if (showVisitModal) setShowVisitModal(false);
  }, showFamilyModal || showServiceModal || showVisitModal || Boolean(inviteFamily) || Boolean(inviteShare));

  const load = useCallback(async () => {
    try {
      const me = await api<{
        user: { name: string; role: string };
        property: Property;
        profile: Profile;
        services: Service[];
        familyMembers?: FamilyMember[];
        panicEnabled?: boolean;
        features?: PortalFeatures;
        isTitular?: boolean;
        canManageFamily?: boolean;
        canManageStaff?: boolean;
        canManageSchedules?: boolean;
        visitAuthDefaultHours?: number;
        tenantName?: string | null;
        accessQr?: AccessQr | null;
      }>("/api/residents/me");

      setUserName(me.profile?.fullName || me.user.name);
      setProperty(me.property);
      setProfile(me.profile);
      setServices(me.services);
      setFamily(me.familyMembers || []);
      setAccessQr(me.accessQr || null);
      setPanicEnabled(Boolean(me.panicEnabled));
      setIsTitular(me.isTitular !== false);
      setCanManageFamily(me.canManageFamily !== false);
      setCanManageStaff(me.canManageStaff === true);
      setCanManageSchedules(me.canManageSchedules === true);
      if (me.visitAuthDefaultHours) setVisitAuthDefaultHours(me.visitAuthDefaultHours);
      setTenantName(me.tenantName || "");
      if (me.features) setFeatures(me.features);

      if (me.features?.qr !== false) {
        const p = await api<{ passes: Pass[] }>("/api/residents/me/visit-passes");
        setPasses(p.passes);
      } else {
        setPasses([]);
      }
      const n = await api<{
        notices: { id: string; kind: string; status: string; title: string; message: string; expiresAt: string | number | null }[];
      }>("/api/residents/me/notices").catch(() => ({ notices: [] }));
      setNotices(n.notices || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar portal");
    }
  }, [router]);

  useEffect(() => {
    load();
    const id = window.setInterval(() => {
      api<{
        notices: { id: string; kind: string; status: string; title: string; message: string; expiresAt: string | number | null }[];
      }>("/api/residents/me/notices")
        .then((n) => setNotices(n.notices || []))
        .catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (tab === "visitas" && !features.qr) setTab("ficha");
  }, [tab, features.qr]);

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

  async function handleIssueAccessQr(opts?: { useDefaultHours?: boolean }) {
    try {
      setAccessQrBusy(true);
      const res = await api<{ accessQr: AccessQr }>("/api/residents/me/access-qr", {
        method: "POST",
        body: JSON.stringify(opts?.useDefaultHours ? { useDefaultHours: true } : {}),
      });
      setAccessQr(res.accessQr);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo generar el QR");
    } finally {
      setAccessQrBusy(false);
    }
  }

  async function handleRevokeAccessQr() {
    if (!confirm("¿Revocar tu QR de acceso? La cara sigue valiendo si la tenés enrolada.")) return;
    try {
      setAccessQrBusy(true);
      await api("/api/residents/me/access-qr/revoke", { method: "POST" });
      setAccessQr(null);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo revocar");
    } finally {
      setAccessQrBusy(false);
    }
  }

  async function handleFamilyQr(memberId: string, mode: "temp" | "permanent") {
    try {
      setAccessQrBusy(true);
      await api(`/api/residents/me/family/${memberId}/qr`, {
        method: "POST",
        body: JSON.stringify(mode === "permanent" ? { permanent: true } : { useDefaultHours: true }),
      });
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "No se pudo emitir el QR");
    } finally {
      setAccessQrBusy(false);
    }
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
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2500);
    }).catch(() => {
      alert("No se pudo copiar el texto");
    });
  }

  async function handleDownloadQr(payload: string, guestName: string) {
    try {
      await downloadQrPng(payload, `qr-${qrFileSlug(guestName)}.png`);
    } catch {
      alert("No se pudo descargar el QR");
    }
  }

  function openVisitModal() {
    setVisitSection(null);
    setVisitArrival("peatonal");
    setVisitUseDefault(true);
    setShowVisitModal(true);
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
      <PortalPush />
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
                Lote {property.lotNumber} · {isTitular ? "Titular" : "Familiar"}
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

          {panicEnabled ? (
            <button
              type="button"
              disabled={sosBusy}
              onClick={async () => {
                setSosBusy(true);
                setSosMsg(null);
                try {
                  await api("/api/alarms/panic", {
                    method: "POST",
                    body: JSON.stringify({ message: "SOS desde portal vecino", source: "portal" }),
                  });
                  setSosMsg("SOS enviado a portería");
                } catch (err) {
                  setSosMsg(err instanceof Error ? err.message : "No se pudo enviar");
                } finally {
                  setSosBusy(false);
                }
              }}
              className="flex items-center gap-1.5 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
            >
              <Siren className="h-4 w-4" />
              {sosBusy ? "Enviando…" : "SOS"}
            </button>
          ) : null}
          {sosMsg ? <span className="text-[11px] text-slate-500">{sosMsg}</span> : null}

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

      {notices.filter((n) => n.status === "pending").length ? (
        <div className="space-y-2">
          {notices
            .filter((n) => n.status === "pending")
            .map((n) => (
              <article
                key={n.id}
                className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/40"
              >
                <p className="text-sm font-bold text-amber-900 dark:text-amber-200">{n.title}</p>
                <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">{n.message}</p>
                {n.kind === "visit_qr" || n.kind === "visit_info" ? (
                  <p className="mt-2 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                    {n.kind === "visit_info"
                      ? "Aviso informativo. No hace falta hacer nada."
                      : "Aviso informativo. Portería abre; no hace falta autorizar."}
                  </p>
                ) : (
                <div className="mt-3 space-y-2">
                  {n.kind === "minors_mismatch" ? (
                    <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                      Portería marcó una diferencia de menores al salir de tu lote. Autorizá si corresponde.
                    </p>
                  ) : null}
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white"
                    onClick={() =>
                      api(`/api/residents/me/notices/${n.id}/decide`, {
                        method: "POST",
                        body: JSON.stringify({ decision: "approved" }),
                      }).then(load)
                    }
                  >
                    Autorizar
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white"
                    onClick={() =>
                      api(`/api/residents/me/notices/${n.id}/decide`, {
                        method: "POST",
                        body: JSON.stringify({ decision: "denied" }),
                      }).then(load)
                    }
                  >
                    Rechazar
                  </button>
                </div>
                </div>
                )}
              </article>
            ))}
          {notices
            .filter((n) => n.status !== "pending" && n.decidedByName)
            .slice(0, 3)
            .map((n) => (
              <p key={n.id} className="text-[11px] text-slate-500">
                {n.status === "approved" ? "Autorizó" : "Denegó"} {n.decidedByName}: {n.title}
              </p>
            ))}
        </div>
      ) : null}

      {/* Navegación por Solapas */}
      <nav className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {ALL_TABS.filter((t) => {
          if ("needQr" in t && t.needQr && !features.qr) return false;
          if (t.key === "familia" && !canManageFamily) return false;
          if (t.key === "servicios" && !canManageStaff) return false;
          return true;
        }).map((t) => {
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
              {t.key === "visitas" && passes.filter((p) => isOpenPass(p.status)).length > 0 && (
                <span className={`rounded-full px-1.5 py-0.2 text-[10px] ${active ? "bg-white/25 text-white" : "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 font-bold"}`}>
                  {passes.filter((p) => isOpenPass(p.status)).length}
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
            {features.face ? (
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
            ) : null}

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

          {features.qr ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Mi QR de acceso</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Si la cara falla, mostrá este QR en el lector o a portería. Abre solo; no es el QR de visitas.
              </p>
              <div className="mt-4 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
                {accessQr?.active && accessQr.payload ? (
                  <>
                    <LocalQr payload={accessQr.payload} size={200} alt="Mi QR de acceso" />
                    <div className="flex flex-1 flex-col gap-2 text-xs">
                      <p className="font-semibold text-slate-700 dark:text-slate-200">
                        {accessQr.validUntil
                          ? `Vence ${fmtDate(accessQr.validUntil)}`
                          : "Sin vencimiento (permanente)"}
                      </p>
                      <p className="text-slate-500">Pista: {accessQr.qrHint || "—"}</p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={accessQrBusy}
                          onClick={() => void handleIssueAccessQr()}
                          className="rounded-xl border border-slate-300 px-3 py-1.5 font-bold dark:border-slate-600"
                        >
                          Renovar
                        </button>
                        <button
                          type="button"
                          disabled={accessQrBusy}
                          onClick={() => void handleDownloadQr(accessQr.payload!, userName || "acceso")}
                          className="rounded-xl border border-slate-300 px-3 py-1.5 font-bold dark:border-slate-600"
                        >
                          Descargar PNG
                        </button>
                        <button
                          type="button"
                          disabled={accessQrBusy}
                          onClick={() => void handleRevokeAccessQr()}
                          className="rounded-xl bg-rose-600 px-3 py-1.5 font-bold text-white"
                        >
                          Revocar
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={accessQrBusy}
                      onClick={() => void handleIssueAccessQr()}
                      className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white dark:bg-white dark:text-slate-900"
                    >
                      Generar QR permanente
                    </button>
                    <button
                      type="button"
                      disabled={accessQrBusy}
                      onClick={() => void handleIssueAccessQr({ useDefaultHours: true })}
                      className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold dark:border-slate-600"
                    >
                      Generar por {visitAuthDefaultHours} h
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : null}
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
            {canManageFamily ? (
              <button
                type="button"
                onClick={() => setShowFamilyModal(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-colors shadow-sm"
              >
                <Plus className="h-4 w-4" />
                <span>Agregar Familiar</span>
              </button>
            ) : null}
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

                    {canManageFamily ? (
                      <div className="flex items-center gap-1">
                        {!f.userId ? (
                          <button
                            type="button"
                            onClick={() => {
                              setInviteFamily(f);
                              setInviteShare(null);
                            }}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-sky-50 hover:text-sky-700 dark:hover:bg-sky-950/40 dark:hover:text-sky-300"
                            title="Invitar a la app"
                          >
                            <Mail className="h-4 w-4" />
                          </button>
                        ) : (
                          <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">Con cuenta</span>
                        )}
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
                    ) : null}
                  </div>

                  {features.qr && canManageFamily ? (
                    <div className="mt-3 space-y-2 rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">QR de acceso</p>
                      {f.accessQr?.active && f.accessQr.payload ? (
                        <div className="flex flex-col items-center gap-2">
                          <LocalQr payload={f.accessQr.payload} size={120} alt={`QR ${f.name}`} />
                          <p className="text-[11px] text-slate-600 dark:text-slate-300">
                            {f.accessQr.validUntil
                              ? `Vence ${fmtDate(f.accessQr.validUntil)}`
                              : "Permanente"}
                          </p>
                          <div className="flex flex-wrap justify-center gap-1.5">
                            <button
                              type="button"
                              disabled={accessQrBusy}
                              onClick={() => void handleDownloadQr(f.accessQr!.payload!, f.name)}
                              className="rounded-lg border border-slate-300 px-2 py-1 text-[10px] font-bold dark:border-slate-600"
                            >
                              PNG
                            </button>
                            <button
                              type="button"
                              disabled={accessQrBusy}
                              onClick={() => void handleFamilyQr(f.id, f.userId ? "permanent" : "temp")}
                              className="rounded-lg border border-slate-300 px-2 py-1 text-[10px] font-bold dark:border-slate-600"
                            >
                              Renovar
                            </button>
                            <button
                              type="button"
                              disabled={accessQrBusy}
                              onClick={async () => {
                                if (!confirm(`¿Revocar QR de ${f.name}?`)) return;
                                try {
                                  setAccessQrBusy(true);
                                  await api(`/api/residents/me/family/${f.id}/qr/revoke`, { method: "POST" });
                                  await load();
                                } catch (err) {
                                  alert(err instanceof Error ? err.message : "No se pudo revocar");
                                } finally {
                                  setAccessQrBusy(false);
                                }
                              }}
                              className="rounded-lg bg-rose-600 px-2 py-1 text-[10px] font-bold text-white"
                            >
                              Revocar
                            </button>
                          </div>
                          {f.userId ? (
                            <p className="text-center text-[10px] text-slate-500">
                              También lo ve en su portal / app
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            disabled={accessQrBusy}
                            onClick={() => void handleFamilyQr(f.id, "temp")}
                            className="rounded-lg bg-slate-900 px-2.5 py-1.5 text-[10px] font-bold text-white dark:bg-white dark:text-slate-900"
                          >
                            QR {visitAuthDefaultHours} h
                          </button>
                          {f.userId || f.dahuaSynced ? (
                            <button
                              type="button"
                              disabled={accessQrBusy}
                              onClick={() => void handleFamilyQr(f.id, "permanent")}
                              className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-[10px] font-bold dark:border-slate-600"
                            >
                              QR permanente
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ) : null}
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
                Autorizá visitas con QR. Tu invitado no entra hasta que portería apruebe.
              </p>
            </div>
            <button
              type="button"
              onClick={openVisitModal}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-colors shadow-sm"
            >
              <Plus className="h-4 w-4" />
              <span>Autorizar Visita (QR)</span>
            </button>
          </div>

          {passes.filter((p) => isOpenPass(p.status)).length === 0 ? (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 p-10 text-center dark:border-slate-800">
              <QrCode className="mx-auto h-10 w-10 text-slate-400 dark:text-slate-600 mb-2" />
              <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                No tenés visitas autorizadas
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Generá el QR, copiá el texto y descargá la imagen para pegar en WhatsApp. El invitado no entra hasta que portería apruebe.
              </p>
              <button
                type="button"
                onClick={openVisitModal}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 dark:bg-blue-500 transition-colors"
              >
                <Plus className="h-4 w-4" />
                <span>Generar Pase QR</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {passes
                .filter((p) => isOpenPass(p.status))
                .map((p) => {
                  const shareText = visitShareText(
                    p.guestName,
                    tenantName,
                    property.lotNumber,
                    p.validFrom,
                    p.validUntil,
                  );
                  const payload = p.qrPayload || p.id;

                  return (
                    <div
                      key={p.id}
                      className="flex items-stretch gap-3 rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="flex shrink-0 items-center justify-center rounded-lg bg-white p-1 dark:bg-slate-950">
                        <LocalQr
                          payload={payload}
                          size={208}
                          alt={`QR de acceso de ${p.guestName}`}
                        />
                      </div>
                      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
                        <div>
                          <div className="flex items-start justify-between gap-1">
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold uppercase text-amber-800 dark:bg-amber-950/80 dark:text-amber-300">
                              {passStatusLabel(p.status)}
                            </span>
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
                              className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                              title="Revocar pase"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                          <h3 className="mt-1 truncate text-sm font-bold text-slate-900 dark:text-white">
                            {p.guestName}
                          </h3>
                          <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                            <Calendar className="h-3 w-3 shrink-0" />
                            <span className="truncate">
                              {fmtDate(p.validFrom)} – {fmtDate(p.validUntil)}
                            </span>
                          </p>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleCopy(shareText, p.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            {copiedId === p.id ? (
                              <>
                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                                Copiado
                              </>
                            ) : (
                              <>
                                <Copy className="h-3.5 w-3.5" />
                                Copiar texto
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDownloadQr(payload, p.guestName)}
                            className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Descargar QR
                          </button>
                        </div>
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
                    <th className="px-4 py-3">Ingreso / salida</th>
                    <th className="px-4 py-3">Permanencia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                  {passes.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
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
                              isOpenPass(p.status)
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300"
                                : p.status === "completed"
                                ? "bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300"
                                : "bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300"
                            }`}
                          >
                            {passStatusLabel(p.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                          {p.scannedInAt ? fmtDate(p.scannedInAt) : "Sin marcar"}
                          {p.scannedOutAt ? ` → ${fmtDate(p.scannedOutAt)}` : ""}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-500">
                          {formatStay(p.scannedInAt, p.scannedOutAt)}
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
      {inviteFamily ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Invitar a {inviteFamily.name}</h3>
              <button
                type="button"
                onClick={() => {
                  setInviteFamily(null);
                  setInviteShare(null);
                }}
                className="rounded-lg p-1 text-slate-400"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {inviteShare ? (
              <div className="mt-4 space-y-3">
                <p className="text-xs text-slate-600 dark:text-slate-300">{inviteShare.shareText}</p>
                <a
                  href={inviteShare.waUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white"
                >
                  Abrir WhatsApp
                </a>
              </div>
            ) : (
              <form
                className="mt-4 space-y-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  try {
                    const d = await api<{ waUrl: string; shareText: string; activateUrl: string }>(
                      `/api/residents/me/family/${inviteFamily.id}/invite`,
                      {
                        method: "POST",
                        body: JSON.stringify({
                          email: String(fd.get("email") || "").trim(),
                          whatsapp: String(fd.get("whatsapp") || "").trim(),
                        }),
                      },
                    );
                    setInviteShare(d);
                    load();
                  } catch (err) {
                    alert(err instanceof Error ? err.message : "No se pudo invitar");
                  }
                }}
              >
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Email
                  <input name="email" type="email" required className="cfg-input mt-1" />
                </label>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  WhatsApp
                  <input name="whatsapp" type="tel" defaultValue={inviteFamily.phone || ""} required className="cfg-input mt-1" />
                </label>
                <button type="submit" className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white">
                  Generar enlace
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}
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
                const birthDate = String(fd.get("birthDate") || "").trim();
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
                    body: JSON.stringify({ name, dni, relationship, phone, photoBase64, birthDate }),
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
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>

                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Fecha de nacimiento
                  </label>
                  <input
                    type="date"
                    name="birthDate"
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
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Foto Facial para Reconocimiento en Lector ASI
                </label>
                <p className="mt-1 text-[11px] text-slate-500">
                  Si es menor de 18 años no subas foto: no se enrola la cara en el lector.
                </p>
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

                const fechaDesde = String(fd.get("fechaDesde") || "").trim();
                const fechaHasta = String(fd.get("fechaHasta") || "").trim();
                let photoBase64: string | undefined;
                const file = (fd.get("photo") as File | null);
                if (file && file.size > 0) {
                  photoBase64 = await new Promise((resolve) => {
                    const r = new FileReader();
                    r.onload = () => resolve(String(r.result || ""));
                    r.readAsDataURL(file);
                  });
                }

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
                      fechaDesde: fechaDesde || undefined,
                      fechaHasta: fechaHasta || undefined,
                      diasSemana: days.length > 0 ? days : undefined,
                      photoBase64,
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
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono text-slate-900 uppercase focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>

              {canManageSchedules ? (
              <>
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
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Vigente desde</label>
                  <input type="date" name="fechaDesde" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Vigente hasta</label>
                  <input type="date" name="fechaHasta" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
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
              </>
              ) : null}

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

      {/* MODAL 3: AUTORIZAR VISITA QR */}
      {showVisitModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowVisitModal(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
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
                aria-label="Cerrar"
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
                const arrivalMode = visitArrival;
                const visitKind = String(fd.get("visitKind") || "social");
                const patente = String(fd.get("patente") || "").trim();
                const validFrom = String(fd.get("validFrom") || "").trim();
                const validUntil = String(fd.get("validUntil") || "").trim();
                const horaDesde = String(fd.get("horaDesde") || "").trim();
                const horaHasta = String(fd.get("horaHasta") || "").trim();
                const notes = String(fd.get("notes") || "").trim();
                const companions: { name: string; dni: string }[] = [];
                const names = fd.getAll("companionName");
                const dnis = fd.getAll("companionDni");
                names.forEach((n, i) => {
                  const name = String(n || "").trim();
                  if (name) companions.push({ name, dni: String(dnis[i] || "").trim() });
                });
                const insuranceCompany = String(fd.get("insuranceCompany") || "").trim();
                const policyNumber = String(fd.get("policyNumber") || "").trim();
                const insuranceValidUntil = String(fd.get("insuranceValidUntil") || "").trim();
                const hasInsurance = Boolean(insuranceCompany && policyNumber);

                try {
                  await api("/api/residents/me/visit-passes", {
                    method: "POST",
                    body: JSON.stringify({
                      guestName,
                      guestDni,
                      patente: arrivalMode === "vehiculo" ? patente : undefined,
                      arrivalMode,
                      visitKind,
                      completeness: hasInsurance ? "full" : "basic",
                      notes: notes || undefined,
                      useDefaultHours: visitUseDefault,
                      validFrom: visitUseDefault ? undefined : validFrom || undefined,
                      validUntil: visitUseDefault ? undefined : validUntil || undefined,
                      horaDesde: horaDesde || undefined,
                      horaHasta: horaHasta || undefined,
                      companions,
                      insurance:
                        hasInsurance && arrivalMode === "vehiculo"
                          ? { company: insuranceCompany, policyNumber, validUntil: insuranceValidUntil }
                          : undefined,
                    }),
                  });
                  setShowVisitModal(false);
                  load();
                  setTab("visitas");
                } catch (err) {
                  alert(err instanceof Error ? err.message : "Error");
                }
              }}
              className="mt-4 space-y-3"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Nombre del visitante
                </label>
                <input
                  type="text"
                  name="guestName"
                  required
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-blue-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
                <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  Si no definís fechas, el pase vale {visitAuthDefaultHours} h. Portería completa lo que falte; el QR no abre.
                </p>
              </div>

              <VisitAccordion
                title="Validez"
                open={visitSection === "validez"}
                onToggle={() => setVisitSection(visitSection === "validez" ? null : "validez")}
              >
                <label className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={visitUseDefault}
                    onChange={(e) => setVisitUseDefault(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>Usar validez del barrio ({visitAuthDefaultHours} h)</span>
                </label>
                {!visitUseDefault ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Válido desde</label>
                      <input type="datetime-local" name="validFrom" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Válido hasta</label>
                      <input type="datetime-local" name="validUntil" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                    </div>
                  </div>
                ) : null}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Hora desde</label>
                    <input type="time" name="horaDesde" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Hora hasta</label>
                    <input type="time" name="horaHasta" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                  </div>
                </div>
              </VisitAccordion>

              <VisitAccordion
                title="Documento y categoría"
                open={visitSection === "documento"}
                onToggle={() => setVisitSection(visitSection === "documento" ? null : "documento")}
              >
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">DNI</label>
                    <input type="text" name="guestDni" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Categoría</label>
                    <select name="visitKind" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                      <option value="social">Social / familiar</option>
                      <option value="service">Obra / servicio</option>
                      <option value="delivery">Delivery / paquete</option>
                    </select>
                  </div>
                </div>
              </VisitAccordion>

              <VisitAccordion
                title="Cómo llega"
                open={visitSection === "llegada"}
                onToggle={() => setVisitSection(visitSection === "llegada" ? null : "llegada")}
              >
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <label className="rounded-lg border border-slate-200 px-2 py-2 dark:border-slate-700">
                    <input type="radio" name="arrivalMode" value="peatonal" checked={visitArrival === "peatonal"} onChange={() => setVisitArrival("peatonal")} className="mr-1" />
                    A pie
                  </label>
                  <label className="rounded-lg border border-slate-200 px-2 py-2 dark:border-slate-700">
                    <input type="radio" name="arrivalMode" value="vehiculo" checked={visitArrival === "vehiculo"} onChange={() => setVisitArrival("vehiculo")} className="mr-1" />
                    Vehículo
                  </label>
                </div>
                {visitArrival === "vehiculo" ? (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Patente</label>
                      <input type="text" name="patente" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono uppercase dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100" />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        Compañía
                        <input name="insuranceCompany" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-normal dark:border-slate-700 dark:bg-slate-800" />
                      </label>
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        Póliza
                        <input name="policyNumber" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-normal dark:border-slate-700 dark:bg-slate-800" />
                      </label>
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        Vence
                        <input type="date" name="insuranceValidUntil" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] font-normal dark:border-slate-700 dark:bg-slate-800" />
                      </label>
                    </div>
                  </>
                ) : null}
              </VisitAccordion>

              <VisitAccordion
                title="Acompañantes"
                open={visitSection === "acompanantes"}
                onToggle={() => setVisitSection(visitSection === "acompanantes" ? null : "acompanantes")}
              >
                <div className="mb-1 grid grid-cols-2 gap-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  <span>Nombre</span>
                  <span>DNI</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input name="companionName" aria-label="Nombre acompañante 1" className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800" />
                  <input name="companionDni" aria-label="DNI acompañante 1" className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800" />
                  <input name="companionName" aria-label="Nombre acompañante 2" className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800" />
                  <input name="companionDni" aria-label="DNI acompañante 2" className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800" />
                </div>
              </VisitAccordion>

              <VisitAccordion
                title="Notas para portería"
                open={visitSection === "notas"}
                onToggle={() => setVisitSection(visitSection === "notas" ? null : "notas")}
              >
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Notas
                  <textarea name="notes" rows={2} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-normal dark:border-slate-700 dark:bg-slate-800" />
                </label>
              </VisitAccordion>

              <div className="flex justify-end gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowVisitModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white hover:bg-blue-700 dark:bg-blue-500"
                >
                  Generar pase QR
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
