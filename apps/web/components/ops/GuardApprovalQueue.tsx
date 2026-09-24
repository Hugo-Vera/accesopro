"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Baby, Bell, Check, Phone, Plus, QrCode, Trash2, X } from "lucide-react";
import { api, apiUrl, withTenant } from "@/lib/api";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { LiveVisitHoldToast, type VisitHoldAlert } from "@/components/ops/LiveVisitHoldToast";
import { DniScanPanel } from "@/components/DniScanPanel";
import { DocumentScanPanel, type AcceptedDoc } from "@/components/ops/DocumentScanPanel";
import { parseDniScan, parsedFullName, parsedIdentityMatches } from "@/lib/parseDni";
import { Modal } from "@/components/ui/Modal";

type FichaStep = "identity" | "vehicle" | "art" | "companions" | "exit" | "summary";

const FICHA_LABEL: Record<FichaStep, string> = {
  identity: "Identidad",
  vehicle: "Vehículo",
  art: "ART",
  companions: "Acompañantes",
  exit: "Egreso",
  summary: "Aprobar",
};

function fichaStepsOf(item: GuardApprovalItem): FichaStep[] {
  const steps: FichaStep[] = ["identity"];
  if (item.needsTrunk) steps.push("vehicle");
  if (item.needsArt) steps.push("art");
  steps.push("companions");
  if (item.sentido === "out") steps.push("exit");
  steps.push("summary");
  return steps;
}

export type GuardApprovalItem = {
  id: string;
  passId: string;
  pending?: boolean;
  sentido: "in" | "out" | string;
  reason: string;
  guestName: string;
  guestDni: string | null;
  patente: string | null;
  arrivalMode: string;
  needsTrunk: boolean;
  needsArt?: boolean;
  visitKind?: string;
  missing: string[];
  expiredDocs?: string[];
  companions: { name: string; dni: string | null; isMinor?: boolean }[];
  insurance?: { company?: string; policyNumber?: string; validUntil?: string | number } | null;
  personInsurance?: { id: string; kind: string; company: string | null; validUntil: string | number; hasDocument: boolean } | null;
  license?: { id: string; licenseNumber: string; validUntil: string | number } | null;
  lotNumber: string | null;
  ownerName: string;
  ownerPhone: string | null;
  ownerWhatsapp: string | null;
  emergencyPhone: string | null;
  emergencies: { label: string; phone: string }[];
  validFrom: string | number;
  validUntil: string | number;
  horaDesde?: string | null;
  horaHasta?: string | null;
  windowState?: "ok" | "expired" | "too_early" | "closed";
  passStatus?: string;
  qrHint?: string | null;
  scanChannel?: string | null;
  scanChannelLabel?: string | null;
  scannedByName?: string | null;
  approvedByName?: string | null;
  approvedVia?: string | null;
  phoneAuthVia?: string | null;
  readerSentido?: string | null;
  laneMismatch?: boolean;
  minorsInCount?: number;
  minorsCount?: number;
  minorsMismatchNotified?: boolean;
  scannedInAt?: string | number | null;
  dwellLabel?: string | null;
  ownerAuthStatus?: string;
  ownerAuthorizedByName?: string | null;
  goodsAlert?: boolean;
  goodsDescription?: string | null;
  goodsAuthorized?: boolean;
  goodsCallReady?: boolean;
  minorsIn?: number;
  adultsIn?: number;
  originPropertyId?: string | null;
  minorTransferAuthorized?: boolean;
  needsPhoneAuth?: boolean;
};

type Props = { tenantId: string; enabled: boolean };

function fmtWindow(v: string | number) {
  const d = new Date(typeof v === "number" ? v : v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

function windowCopy(item: GuardApprovalItem) {
  if (item.windowState === "expired") return "Pase vencido o fuera de horario";
  if (item.windowState === "too_early") return "Todavía no vale (temprano)";
  if (item.windowState === "closed") return "Cerrado";
  return "Ventana vigente";
}

export function GuardApprovalQueue({ tenantId, enabled }: Props) {
  const [items, setItems] = useState<GuardApprovalItem[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [preview, setPreview] = useState<GuardApprovalItem | null>(null);
  const [comment, setComment] = useState("");
  const [trunkChecked, setTrunkChecked] = useState(false);
  const [guestDni, setGuestDni] = useState("");
  const [guestName, setGuestName] = useState("");
  const [fichaStep, setFichaStep] = useState(0);
  const [dniMatch, setDniMatch] = useState<"idle" | "ok" | "filled">("idle");
  const [insCompany, setInsCompany] = useState("");
  const [insPolicy, setInsPolicy] = useState("");
  const [insUntil, setInsUntil] = useState("");
  const [plate, setPlate] = useState("");
  const [goodsDesc, setGoodsDesc] = useState("");
  const [goodsPhoto, setGoodsPhoto] = useState<string | null>(null);
  const [exitMinors, setExitMinors] = useState("");
  const [originLot, setOriginLot] = useState("");
  const [guardCode, setGuardCode] = useState("");
  const [companionsDraft, setCompanionsDraft] = useState<{ name: string; dni: string }[]>([]);
  const [lots, setLots] = useState<{ id: string; lotNumber: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visitToast, setVisitToast] = useState<VisitHoldAlert | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [docKind, setDocKind] = useState<"vehicle" | "art" | "license" | null>(null);
  const [vehDoc, setVehDoc] = useState<AcceptedDoc | null>(null);
  const [artDoc, setArtDoc] = useState<AcceptedDoc | null>(null);
  const [licDoc, setLicDoc] = useState<AcceptedDoc | null>(null);
  const [artUntil, setArtUntil] = useState("");
  const [artCompany, setArtCompany] = useState("");
  const [licUntil, setLicUntil] = useState("");
  const [licNumber, setLicNumber] = useState("");
  const [minorsOpen, setMinorsOpen] = useState(false);
  const [minorsDraft, setMinorsDraft] = useState(1);
  const [minorsSnapshot, setMinorsSnapshot] = useState(0);

  const load = useCallback(() => {
    if (!enabled || !tenantId) return;
    api<{ items: GuardApprovalItem[] }>(withTenant("/api/visitors/approvals", tenantId))
      .then((d) => setItems(d.items || []))
      .catch(() => undefined);
    api<{ properties: { id: string; lotNumber: string }[] }>(withTenant("/api/visitors/properties", tenantId))
      .then((d) => setLots(d.properties || []))
      .catch(() => undefined);
  }, [enabled, tenantId]);

  useEffect(() => {
    load();
    if (!enabled) return;
    const id = window.setInterval(load, 3000);
    const es = new EventSource(apiUrl(withTenant("/api/events/stream?type=visit_hold", tenantId)), {
      withCredentials: true,
    });
    const onHold = (raw: string) => {
      load();
      try {
        const ev = JSON.parse(raw) as { id?: string; payload?: Record<string, unknown> };
        const p = ev.payload || {};
        if (p.decided || p.phoneAuth) return;
        const guestName = String(p.guestName || "").trim();
        const passId = String(p.passId || "").trim();
        if (!guestName && !passId) return;
        setVisitToast({
          id: String(ev.id || p.approvalId || Date.now()),
          passId,
          approvalId: p.approvalId != null ? String(p.approvalId) : undefined,
          guestName: guestName || "Visita",
          lotNumber: p.lotNumber != null ? String(p.lotNumber) : null,
          guestDni: p.guestDni != null ? String(p.guestDni) : null,
          qrHint: p.qrHint != null ? String(p.qrHint) : null,
          scanChannelLabel: p.scanChannelLabel != null ? String(p.scanChannelLabel) : null,
          scannedByName: p.scannedByName != null ? String(p.scannedByName) : null,
          sentido: p.sentido === "out" ? "out" : "in",
          photoStored: p.photoStored === true,
          dwellLabel: p.dwellLabel != null ? String(p.dwellLabel) : null,
          reason: p.reason != null ? String(p.reason) : undefined,
        });
      } catch {
        /* ping / connected */
      }
    };
    es.addEventListener("message", (e: MessageEvent) => onHold(e.data));
    es.addEventListener("access_event", (e: MessageEvent) => onHold(e.data));
    return () => {
      window.clearInterval(id);
      es.close();
    };
  }, [enabled, load, tenantId]);

  useEffect(() => {
    if (!enabled) return;
    function onOpen(e: Event) {
      const passId = (e as CustomEvent<{ passId?: string }>).detail?.passId;
      if (!passId) return;
      const match = items.find((x) => x.passId === passId);
      if (match) {
        setPreview(null);
        setOpenId(match.id);
        return;
      }
      api<{ item: GuardApprovalItem }>(withTenant(`/api/visitors/passes/${passId}`, tenantId))
        .then((d) => {
          if (!d.item) return;
          if (d.item.pending) {
            setPreview(null);
            setOpenId(d.item.id);
            load();
            return;
          }
          setOpenId(null);
          setPreview(d.item);
        })
        .catch(() => undefined);
    }
    window.addEventListener("ap:open-visit-approval", onOpen);
    return () => window.removeEventListener("ap:open-visit-approval", onOpen);
  }, [enabled, items, load, tenantId]);

  const current = items.find((x) => x.id === openId) || preview;
  const canDecide = Boolean(current && current.pending !== false && !String(current.id).startsWith("preview:"));
  const fichaSteps = current ? fichaStepsOf(current) : [];
  const stepKey = fichaSteps[Math.min(fichaStep, Math.max(0, fichaSteps.length - 1))] ?? "identity";
  useEscapeKey(() => {
    if (minorsOpen) {
      setMinorsDraft(minorsSnapshot);
      setMinorsOpen(false);
      return;
    }
    if (docKind) {
      setDocKind(null);
      return;
    }
    if (scanOpen) {
      setScanOpen(false);
      return;
    }
    if (fichaStep > 0) {
      setFichaStep((n) => Math.max(0, n - 1));
      return;
    }
    setOpenId(null);
    setPreview(null);
  }, Boolean(current) || scanOpen || Boolean(docKind) || minorsOpen);

  useEffect(() => {
    if (!current) return;
    setComment("");
    setTrunkChecked(false);
    setGuestDni(current.guestDni || "");
    setGuestName(current.guestName || "");
    setFichaStep(0);
    setDniMatch("idle");
    setPlate(current.patente || "");
    setGoodsDesc(current.goodsDescription || "");
    setExitMinors(String(current.minorsCount ?? current.minorsInCount ?? 0));
    setMinorsDraft(
      current.sentido === "out"
        ? current.minorsCount ?? current.minorsInCount ?? 0
        : current.minorsCount ?? 0,
    );
    setGuardCode("");
    setError(null);
    setCompanionsDraft((current.companions || []).map((x) => ({ name: x.name, dni: x.dni || "" })));
    setInsCompany(current.insurance?.company || "");
    setInsPolicy(current.insurance?.policyNumber || "");
    setInsUntil(
      current.insurance?.validUntil
        ? new Date(current.insurance.validUntil).toISOString().slice(0, 10)
        : "",
    );
    setArtUntil(
      current.personInsurance?.validUntil
        ? new Date(current.personInsurance.validUntil).toISOString().slice(0, 10)
        : "",
    );
    setArtCompany(current.personInsurance?.company || "");
    setLicUntil(
      current.license?.validUntil ? new Date(current.license.validUntil).toISOString().slice(0, 10) : "",
    );
    setLicNumber(current.license?.licenseNumber || "");
    setVehDoc(null);
    setArtDoc(null);
    setLicDoc(null);
  }, [current?.id]);

  async function decide(decision: "approved" | "denied") {
    if (!current || !canDecide) return;
    setBusy(true);
    setError(null);
    try {
      await api(withTenant(`/api/visitors/approvals/${current.id}/decide`, tenantId), {
        method: "POST",
        body: JSON.stringify({
          decision,
          comment,
          trunkChecked,
          guestDni,
          guestName,
          patente: plate || undefined,
          minorsCount: minorsDraft,
          companions: companionsDraft.filter((x) => x.name.trim()),
          insurance:
            current.needsTrunk && insCompany && insPolicy
              ? {
                  plate,
                  company: insCompany,
                  policyNumber: insPolicy,
                  validUntil: insUntil,
                  cardPhotoBase64: vehDoc?.base64 || undefined,
                }
              : undefined,
          personInsurance:
            current.needsArt && artUntil
              ? {
                  kind: "art" as const,
                  company: artCompany,
                  validUntil: artUntil,
                  documentBase64: artDoc?.base64 || undefined,
                  documentMime: artDoc?.mime,
                  source: artDoc?.source || "scan",
                }
              : undefined,
          driverLicense: licUntil
            ? { licenseNumber: licNumber, validUntil: licUntil, photoBase64: licDoc?.base64 || undefined }
            : undefined,
        }),
      });
      setOpenId(null);
      setPreview(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo resolver");
    } finally {
      setBusy(false);
    }
  }

  function applyParsedDni(parsed: NonNullable<ReturnType<typeof parseDniScan>>) {
    if (!parsed.dni) return;
    const expectedName = guestName || current?.guestName || "";
    const expectedDni = guestDni || current?.guestDni || "";
    const match = parsedIdentityMatches(parsed, expectedDni, expectedName);
    setGuestDni(parsed.dni);
    if (match) {
      setDniMatch("ok");
    } else {
      const name = parsedFullName(parsed);
      if (name) setGuestName(name);
      setDniMatch("filled");
    }
    void saveFicha({
      guestDni: parsed.dni,
      guestName: match ? expectedName || parsedFullName(parsed) : parsedFullName(parsed) || expectedName,
      firstName: parsed.firstName,
      lastName: parsed.lastName,
      tramite: parsed.tramite,
      gender: parsed.gender,
      birthDate: parsed.birthDate,
    });
  }

  async function consumeCode(raw: string) {
    const dni = parseDniScan(raw);
    if (dni?.dni && current) {
      applyParsedDni(dni);
      setScanOpen(false);
      return true;
    }
    try {
      const res = await api<{ approvalId?: string; passId?: string; item?: GuardApprovalItem }>(
        withTenant("/api/visitors/approvals/scan-qr", tenantId),
        { method: "POST", body: JSON.stringify({ cardRaw: raw, scanChannel: "web" }) },
      );
      setScanOpen(false);
      load();
      if (res.item?.id) {
        setPreview(null);
        setOpenId(res.item.id);
      } else if (res.passId) {
        window.dispatchEvent(new CustomEvent("ap:open-visit-approval", { detail: { passId: res.passId } }));
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "QR no autorizado");
      return false;
    }
  }

  async function saveFicha(extra?: Record<string, unknown>) {
    if (!current || !canDecide) return;
    setBusy(true);
    setError(null);
    try {
      await api(withTenant(`/api/visitors/approvals/${current.id}/ficha`, tenantId), {
        method: "POST",
        body: JSON.stringify({
          guestDni,
          guestName,
          patente: plate || undefined,
          minorsCount: minorsDraft,
          companions: companionsDraft.filter((x) => x.name.trim()),
          insurance:
            current.needsTrunk && insCompany && insPolicy
              ? {
                  plate,
                  company: insCompany,
                  policyNumber: insPolicy,
                  validUntil: insUntil,
                  cardPhotoBase64: vehDoc?.base64 || undefined,
                }
              : undefined,
          personInsurance:
            current.needsArt && artUntil
              ? {
                  kind: "art",
                  company: artCompany,
                  validUntil: artUntil,
                  documentBase64: artDoc?.base64 || undefined,
                  documentMime: artDoc?.mime,
                  source: artDoc?.source || "scan",
                }
              : undefined,
          driverLicense: licUntil
            ? { licenseNumber: licNumber, validUntil: licUntil, photoBase64: licDoc?.base64 || undefined }
            : undefined,
          ...extra,
        }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la ficha");
    } finally {
      setBusy(false);
    }
  }

  async function saveMinors(count: number) {
    if (!current || !canDecide) {
      setMinorsDraft(count);
      setMinorsOpen(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(withTenant(`/api/visitors/approvals/${current.id}/minors-count`, tenantId), {
        method: "POST",
        body: JSON.stringify({ count }),
      });
      setMinorsDraft(count);
      setMinorsOpen(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar los menores");
    } finally {
      setBusy(false);
    }
  }

  async function goNextFicha() {
    setDocKind(null);
    if (canDecide) await saveFicha();
    setFichaStep((n) => Math.min(n + 1, Math.max(0, fichaSteps.length - 1)));
  }

  function goPrevFicha() {
    setDocKind(null);
    setFichaStep((n) => Math.max(0, n - 1));
  }

  if (!enabled) return null;

  return (
    <>
      {items.length ? (
        <button
          type="button"
          onClick={() => {
            setPreview(null);
            setOpenId(items[0].id);
          }}
          className="fixed right-4 z-40 inline-flex max-w-[min(280px,calc(100vw-2rem))] items-center gap-2 rounded-full bg-amber-500 px-3 py-2 text-xs font-bold text-white shadow-lg bottom-[calc(4.5rem+env(safe-area-inset-bottom))] lg:bottom-auto lg:top-20"
        >
          <Bell className="h-4 w-4 shrink-0" />
          <span className="truncate">
            {items[0].guestName}
            {items.length === 1 ? " · 1 aprobación" : ` · ${items.length} aprobaciones`}
          </span>
        </button>
      ) : null}

      <button
        type="button"
        onClick={() => setScanOpen(true)}
        className={`fixed z-40 inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-800 shadow-lg dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] lg:bottom-auto ${
          items.length ? "lg:top-32" : "lg:top-20"
        }`}
      >
        <QrCode className="h-4 w-4 shrink-0" />
        Escanear QR de visita
      </button>

      <LiveVisitHoldToast
        alert={visitToast}
        onDismiss={() => setVisitToast(null)}
        onOpenFicha={(a) => {
          setVisitToast(null);
          const match = items.find((x) => x.id === a.approvalId || x.passId === a.passId);
          if (match) {
            setPreview(null);
            setOpenId(match.id);
            return;
          }
          if (a.passId) {
            window.dispatchEvent(new CustomEvent("ap:open-visit-approval", { detail: { passId: a.passId } }));
          }
        }}
      />

      <Modal open={scanOpen} onClose={() => setScanOpen(false)} size="md" zClass="z-[60]" closeOnEscape={false}>
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">Escanear en portería</h3>
                <p className="text-xs text-slate-500">QR de visita o DNI. El carril (ingreso o salida) sale del estado del pase: no se sale si no se entró.</p>
              </div>
              <button type="button" onClick={() => setScanOpen(false)} className="rounded p-1 text-slate-500" aria-label="Cerrar">
                <X className="h-5 w-5" />
              </button>
            </div>
            <DniScanPanel
              active={scanOpen}
              title="Cámara: QR de visita o DNI"
              onScan={(raw) => {
                void consumeCode(raw);
              }}
              onRaw={(raw) => {
                const dni = parseDniScan(raw);
                if (dni?.dni) {
                  setGuestDni(dni.dni);
                  return false;
                }
                void consumeCode(raw);
                return true;
              }}
            />
            {error ? <p className="mt-2 text-[11px] text-rose-600">{error}</p> : null}
      </Modal>

      {current ? (
      <Modal
        open
        onClose={() => {
          setOpenId(null);
          setPreview(null);
        }}
        size="md"
        closeOnEscape={false}
        labelledBy="ap-guard-ficha-title"
      >
            <div className="mb-3 flex items-start justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                  {current.sentido === "out" ? "Salida" : "Entrada"} · Lote {current.lotNumber || "—"}
                </p>
                <h3 id="ap-guard-ficha-title" className="text-lg font-bold text-slate-900 dark:text-white">{current.guestName}</h3>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {current.guestDni ? `DNI ${current.guestDni}` : "DNI pendiente"}
                  {current.qrHint ? ` · QR ${current.qrHint}` : ""}
                </p>
                {current.scanChannelLabel ? (
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Leído en {current.scanChannelLabel}
                    {current.scannedByName ? ` · ${current.scannedByName}` : ""}
                  </p>
                ) : null}
                {current.laneMismatch ? (
                  <p className="mt-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                    Presentó el QR en el tótem de {current.readerSentido === "out" ? "salida" : "ingreso"}. Se trata como {current.sentido === "out" ? "salida" : "ingreso"} porque {current.sentido === "out" ? "ya había entrado" : "todavía no había entrado"}.
                  </p>
                ) : null}
                <p className="text-xs text-slate-500">
                  {current.reason === "expired"
                    ? "Pase vencido o fuera de horario"
                    : current.reason === "incomplete"
                      ? "Faltan datos"
                      : current.reason === "preview"
                        ? "Todavía no pasó el QR por el lector"
                        : current.reason === "walk_in"
                      ? current.ownerAuthStatus === "owner_approved"
                        ? `Autorizó ${current.ownerAuthorizedByName || "el lote"}. Completá la inspección y abrí.`
                        : current.ownerAuthStatus === "owner_denied"
                          ? `${current.ownerAuthorizedByName || "El lote"} rechazó. Podés denegar o hacer excepción.`
                          : current.ownerAuthStatus === "owner_expired"
                            ? "El lote no contestó a tiempo. Podés excepción."
                            : "Walk-in: avisamos al lote (2 min). La barrera la abrís vos."
                    : current.scanChannelLabel
                      ? `Identificado en ${current.scanChannelLabel}. El QR no abre: completá y aprobá.`
                    : "Identificado. El QR no abre: completá y aprobá."}
                </p>
                <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
                  {windowCopy(current)} · {fmtWindow(current.validFrom)} → {fmtWindow(current.validUntil)}
                  {current.horaDesde && current.horaHasta ? ` · franja ${current.horaDesde}–${current.horaHasta}` : ""}
                </p>
                {current.reason === "walk_in" && current.ownerAuthorizedByName ? (
                  <p className="mt-0.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    Autorizó {current.ownerAuthorizedByName}
                  </p>
                ) : current.reason !== "walk_in" ? (
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Preautorizado por el titular.{current.scanChannelLabel ? ` Lectura: ${current.scanChannelLabel}.` : " El QR solo identificó el pase."}
                  </p>
                ) : null}
                {current.dwellLabel ? (
                  <p className="mt-0.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300">{current.dwellLabel}</p>
                ) : null}
                {canDecide ? (
                  <button
                    type="button"
                    onClick={() => {
                      const next = Math.max(1, current.minorsCount || (current.sentido === "out" ? current.minorsInCount || 0 : 0) || 1);
                      setMinorsSnapshot(minorsDraft);
                      setMinorsDraft(next);
                      setMinorsOpen(true);
                    }}
                    className="mt-2 mr-2 inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold dark:border-slate-600"
                  >
                    <Baby className="h-3 w-3" />
                    {(current.minorsCount || 0) > 0 || (current.sentido === "out" && (current.minorsInCount || 0) > 0)
                      ? `Menores · ${current.sentido === "out" ? `salen ${minorsDraft} / entraron ${current.minorsInCount || 0}` : minorsDraft || current.minorsCount || 0}`
                      : "Menor"}
                  </button>
                ) : null}
                {canDecide ? (
                  <button
                    type="button"
                    onClick={() => setScanOpen(true)}
                    className="mt-2 inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold dark:border-slate-600"
                  >
                    <QrCode className="h-3 w-3" />
                    Escanear QR de visita
                  </button>
                ) : null}
              </div>
              <button type="button" onClick={() => { setOpenId(null); setPreview(null); }} className="rounded p-1 text-slate-500" aria-label="Cerrar">
                <X className="h-5 w-5" />
              </button>
            </div>

            {current.missing.length ? (
              <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                Completar: {current.missing.join(", ")}
              </p>
            ) : null}
            {current.expiredDocs?.length ? (
              <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <p>Vencido: {current.expiredDocs.join(", ")}. Sin autorización del titular no se puede abrir.</p>
                {canDecide && current.ownerAuthStatus !== "owner_approved" ? (
                  <button
                    type="button"
                    disabled={busy}
                    className="mt-2 rounded-lg bg-amber-700 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                    onClick={async () => {
                      setBusy(true);
                      setError(null);
                      try {
                        await api(withTenant(`/api/visitors/approvals/${current.id}/expired-exception`, tenantId), {
                          method: "POST",
                        });
                        load();
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "No se pudo avisar al lote");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Pedir autorización al titular
                  </button>
                ) : current.ownerAuthStatus === "owner_approved" ? (
                  <p className="mt-1">El titular autorizó la excepción.</p>
                ) : current.ownerAuthStatus === "pending_owner" ? (
                  <p className="mt-1">Esperando al lote.</p>
                ) : null}
              </div>
            ) : null}

            {fichaSteps.length ? (
              <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                {fichaSteps.map((k, i) => (
                  <span key={k} className={i === fichaStep ? "text-blue-600 dark:text-blue-400" : ""}>
                    {i + 1}. {FICHA_LABEL[k]}
                    {i < fichaSteps.length - 1 ? " · " : ""}
                  </span>
                ))}
              </p>
            ) : null}

            {stepKey === "identity" ? (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="col-span-2">
                Nombre (precargado)
                <input value={guestName} onChange={(e) => setGuestName(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              </label>
              <label className="col-span-2">
                DNI
                <input value={guestDni} onChange={(e) => setGuestDni(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              </label>
              {current.qrHint ? (
                <p className="col-span-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                  QR que lo acredita: {current.qrHint}
                </p>
              ) : null}
              {dniMatch === "ok" ? (
                <p className="col-span-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">El DNI coincide con el precargado.</p>
              ) : dniMatch === "filled" ? (
                <p className="col-span-2 text-[11px] font-semibold text-amber-800 dark:text-amber-300">Se cargaron nombre y DNI desde el plástico.</p>
              ) : (
                <p className="col-span-2 text-[11px] text-slate-500">Escaneá el DNI para validar el número y el nombre. Si no coinciden, se pisan los datos del plástico.</p>
              )}
              {canDecide ? (
                <div className="col-span-2">
                  <DniScanPanel
                    active={Boolean(current) && !scanOpen && !minorsOpen}
                    title="Escanear DNI (cámara o pistola)"
                    onScan={(raw) => {
                      const parsed = parseDniScan(raw);
                      if (parsed?.dni) applyParsedDni(parsed);
                    }}
                  />
                </div>
              ) : null}
            </div>
            ) : null}

            {stepKey === "vehicle" ? (
            <div className="grid grid-cols-2 gap-2 text-xs">
                  <label>
                    Patente
                    <input value={plate} onChange={(e) => setPlate(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 uppercase dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                  </label>
                  <label>
                    Compañía
                    <input value={insCompany} onChange={(e) => setInsCompany(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                  </label>
                  <label>
                    Póliza
                    <input value={insPolicy} onChange={(e) => setInsPolicy(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                  </label>
                  <label>
                    Vence
                    <input type="date" value={insUntil} onChange={(e) => setInsUntil(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                  </label>
                  <label className="col-span-2 flex items-center gap-2 font-semibold">
                    <input type="checkbox" checked={trunkChecked} onChange={(e) => setTrunkChecked(e.target.checked)} />
                    Baúl revisado
                  </label>
                  {canDecide ? (
                    <div className="col-span-2 space-y-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Tarjeta / póliza del auto</p>
                      <DocumentScanPanel
                        tenantId={tenantId}
                        value={vehDoc}
                        overlayOpen={docKind === "vehicle"}
                        onOverlayChange={(open) => setDocKind(open ? "vehicle" : docKind === "vehicle" ? null : docKind)}
                        onAccept={setVehDoc}
                        onClear={() => setVehDoc(null)}
                      />
                      <label>
                        Licencia (opcional) · vence
                        <input type="date" value={licUntil} onChange={(e) => setLicUntil(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                      </label>
                      <label>
                        Nro. de licencia
                        <input value={licNumber} onChange={(e) => setLicNumber(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                      </label>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Foto de la licencia (opcional)</p>
                      <DocumentScanPanel
                        tenantId={tenantId}
                        value={licDoc}
                        overlayOpen={docKind === "license"}
                        onOverlayChange={(open) => setDocKind(open ? "license" : docKind === "license" ? null : docKind)}
                        onAccept={setLicDoc}
                        onClear={() => setLicDoc(null)}
                      />
                    </div>
                  ) : null}
            </div>
            ) : null}

            {stepKey === "art" ? (
                <div className="space-y-2 rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-700">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">ART / seguro de vida</p>
                  <label>
                    Compañía
                    <input value={artCompany} onChange={(e) => setArtCompany(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                  </label>
                  <label>
                    Vence
                    <input type="date" value={artUntil} onChange={(e) => setArtUntil(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                  </label>
                  {canDecide ? (
                    <DocumentScanPanel
                      tenantId={tenantId}
                      value={artDoc}
                      overlayOpen={docKind === "art"}
                      onOverlayChange={(open) => setDocKind(open ? "art" : docKind === "art" ? null : docKind)}
                      onAccept={setArtDoc}
                      onClear={() => setArtDoc(null)}
                    />
                  ) : null}
                  {artDoc || current.personInsurance?.hasDocument ? (
                    <p className="text-[11px] text-slate-500">{artDoc ? "Constancia recortada lista." : "Ya hay constancia adjunta."}</p>
                  ) : null}
                </div>
            ) : null}

            {stepKey === "companions" ? (
            canDecide ? (
              <div className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Acompañantes</p>
                {companionsDraft.map((row, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    <label className="text-[11px] font-semibold">
                      Nombre
                      <input
                        value={row.name}
                        onChange={(e) => {
                          const next = companionsDraft.slice();
                          next[i] = { ...next[i], name: e.target.value };
                          setCompanionsDraft(next);
                        }}
                        className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      />
                    </label>
                    <label className="text-[11px] font-semibold">
                      DNI
                      <input
                        value={row.dni}
                        onChange={(e) => {
                          const next = companionsDraft.slice();
                          next[i] = { ...next[i], dni: e.target.value };
                          setCompanionsDraft(next);
                        }}
                        className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      />
                    </label>
                    <button
                      type="button"
                      className="mt-5 rounded p-1 text-slate-500"
                      aria-label="Quitar acompañante"
                      onClick={() => setCompanionsDraft(companionsDraft.filter((_, j) => j !== i))}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold dark:border-slate-600"
                  onClick={() => setCompanionsDraft([...companionsDraft, { name: "", dni: "" }])}
                >
                  <Plus className="h-3 w-3" />
                  Agregar acompañante
                </button>
                <DniScanPanel
                  active={Boolean(current) && !scanOpen && !minorsOpen}
                  title="DNI de acompañante (cámara o pistola)"
                  onScan={(raw) => {
                    const parsed = parseDniScan(raw);
                    if (!parsed?.dni) return;
                    const name = parsedFullName(parsed);
                    setCompanionsDraft((prev) => {
                      const i = prev.findIndex((x) => !x.dni.trim());
                      if (i >= 0) {
                        const next = prev.slice();
                        next[i] = { name: next[i].name || name, dni: parsed.dni };
                        return next;
                      }
                      return [...prev, { name, dni: parsed.dni }];
                    });
                  }}
                />
              </div>
            ) : current.companions.length ? (
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                Acompañantes: {current.companions.map((x) => `${x.name}${x.isMinor ? " (menor)" : ""}${x.dni ? ` (${x.dni})` : ""}`).join(", ")}
              </p>
            ) : (
              <p className="text-[11px] text-slate-500">Sin acompañantes.</p>
            )
            ) : null}

            {stepKey === "exit" ? (
              <div className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Egreso</p>
                {current.needsTrunk ? (
                  <label className="flex items-center gap-2 text-[11px] font-semibold">
                    <input type="checkbox" checked={trunkChecked} onChange={(e) => setTrunkChecked(e.target.checked)} />
                    Baúl revisado
                  </label>
                ) : null}
                <label className="block text-[11px] font-semibold">
                  Descripción del bien no registrado
                  <input
                    value={goodsDesc}
                    onChange={(e) => setGoodsDesc(e.target.value)}
                    className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </label>
                <label className="block text-[11px] font-semibold">
                  Foto del bien
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="mt-0.5 block w-full text-[11px]"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => setGoodsPhoto(String(reader.result || ""));
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || (!goodsDesc && !goodsPhoto)}
                  className="rounded-lg bg-amber-600 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api(withTenant(`/api/visitors/approvals/${current.id}/goods`, tenantId), {
                        method: "POST",
                        body: JSON.stringify({ description: goodsDesc, photoBase64: goodsPhoto }),
                      });
                      load();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "No se pudo alertar");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Alertar bien no registrado
                </button>
                {current.goodsAlert ? (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    {current.goodsAuthorized
                      ? "El titular autorizó el bien."
                      : current.goodsCallReady
                        ? "Sin respuesta: llamá al titular."
                        : "Esperando autorización del lote. La barrera queda retenida."}
                  </p>
                ) : null}
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/60 dark:bg-amber-950/30">
                  <p className="text-[11px] font-bold text-amber-900 dark:text-amber-200">
                    Ingresaron {current.minorsInCount ?? 0} menor(es). No hay que identificarlos: solo la cantidad.
                  </p>
                  <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-300">Ahora salen: {minorsDraft}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      className="h-9 w-9 rounded-lg border border-slate-300 text-lg font-bold dark:border-slate-600"
                      onClick={() => setMinorsDraft((n) => Math.max(0, n - 1))}
                    >
                      −
                    </button>
                    <span className="min-w-[2rem] text-center text-lg font-bold">{minorsDraft}</span>
                    <button
                      type="button"
                      className="h-9 w-9 rounded-lg border border-slate-300 text-lg font-bold dark:border-slate-600"
                      onClick={() => setMinorsDraft((n) => Math.min(20, n + 1))}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold dark:border-slate-600"
                      onClick={() => void saveMinors(minorsDraft)}
                    >
                      Guardar cantidad
                    </button>
                  </div>
                  {minorsDraft !== (current.minorsInCount ?? 0) ? (
                    <div className="mt-2 space-y-1">
                      <p className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                        {minorsDraft > (current.minorsInCount ?? 0)
                          ? `Salen ${minorsDraft - (current.minorsInCount ?? 0)} de más.`
                          : `Salen menos: quedan ${(current.minorsInCount ?? 0) - minorsDraft} en el barrio.`}
                      </p>
                      <button
                        type="button"
                        disabled={busy}
                        className="rounded-lg bg-amber-700 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                        onClick={async () => {
                          setBusy(true);
                          setError(null);
                          try {
                            await saveMinors(minorsDraft);
                            await api(withTenant(`/api/visitors/approvals/${current.id}/minors-mismatch`, tenantId), {
                              method: "POST",
                            });
                            load();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "No se pudo avisar al lote");
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Marcar diferencia y avisar al lote {current.lotNumber || ""}
                      </button>
                      {current.minorsMismatchNotified ? (
                        <p className="text-[11px] text-amber-800 dark:text-amber-300">
                          Aviso enviado al lote
                          {minorsDraft > (current.minorsInCount ?? 0) && !current.minorTransferAuthorized
                            ? ". Esperá autorización para abrir."
                            : "."}
                        </p>
                      ) : null}
                      {current.minorTransferAuthorized ? (
                        <p className="text-[11px] font-semibold text-emerald-700">El lote autorizó la diferencia.</p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-500">La cantidad coincide con el ingreso.</p>
                  )}
                </div>
              </div>
            ) : null}

            {stepKey === "summary" ? (
              <div className="space-y-2 text-xs">
                <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                  <p className="font-semibold text-slate-800 dark:text-slate-100">{guestName || current.guestName}</p>
                  <p className="text-slate-500">DNI {guestDni || current.guestDni || "—"}{current.qrHint ? ` · QR ${current.qrHint}` : ""}</p>
                  {current.scanChannelLabel ? (
                    <p className="text-slate-500">Lectura: {current.scanChannelLabel}{current.scannedByName ? ` · ${current.scannedByName}` : ""}</p>
                  ) : null}
                  {current.approvedByName ? (
                    <p className="text-slate-500">
                      Aprobó {current.approvedByName}
                      {current.approvedVia === "login" ? " (sesión)" : ""}
                      {current.phoneAuthVia === "guard_code" ? " · autorización con código de guardia" : ""}
                    </p>
                  ) : current.phoneAuthVia === "guard_code" && current.ownerAuthorizedByName ? (
                    <p className="text-slate-500">Código de guardia: {current.ownerAuthorizedByName}</p>
                  ) : null}
                  {current.needsTrunk ? <p className="text-slate-500">Patente {plate || "—"} · baúl {trunkChecked ? "revisado" : "pendiente"}</p> : <p className="text-slate-500">Ingreso peatonal</p>}
                  {current.needsArt ? <p className="text-slate-500">ART {artCompany || "—"} · vence {artUntil || "—"}</p> : null}
                  {companionsDraft.filter((x) => x.name.trim()).length ? (
                    <p className="text-slate-500">Acompañantes: {companionsDraft.filter((x) => x.name.trim()).map((x) => x.name).join(", ")}</p>
                  ) : null}
                </div>
                <label className="block">
                  Comentario
                  <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                </label>
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              {current.emergencies.map((e) => (
                <a key={e.phone} href={`tel:${e.phone}`} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-bold dark:border-slate-600">
                  <Phone className="h-3 w-3" />
                  {e.label} {e.phone}
                </a>
              ))}
              {current.ownerPhone ? (
                <a href={`tel:${current.ownerPhone}`} className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2 py-1 text-[11px] font-bold text-white dark:bg-white dark:text-slate-900">
                  <Phone className="h-3 w-3" />
                  Lote · {current.ownerName}
                </a>
              ) : null}
            </div>

            {error ? <p className="mt-2 text-[11px] text-rose-600">{error}</p> : null}

            {canDecide && current.needsPhoneAuth ? (
              <div className="mt-3 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
                <p className="text-[11px] font-semibold text-amber-900 dark:text-amber-200">
                  Si el titular autorizó por teléfono, confirmá con tu código de guardia. Después abrís.
                </p>
                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                  Código de guardia
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    value={guardCode}
                    onChange={(e) => setGuardCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                    className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || guardCode.length < 4}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white dark:bg-white dark:text-slate-900 disabled:opacity-50"
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await api(withTenant(`/api/visitors/approvals/${current.id}/phone-auth`, tenantId), {
                        method: "POST",
                        body: JSON.stringify({ guardCode }),
                      });
                      setGuardCode("");
                      load();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Código rechazado");
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Confirmar autorización por llamada
                </button>
              </div>
            ) : null}

            {!canDecide ? (
              <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                Cuando el invitado acerque el QR, esta misma ficha sirve para aprobar o denegar. El propietario con cara o QR permanente no espera.
              </p>
            ) : stepKey !== "summary" ? (
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  disabled={busy || fichaStep === 0}
                  onClick={goPrevFicha}
                  className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold dark:border-slate-600 disabled:opacity-50"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void goNextFicha()}
                  className="inline-flex flex-1 items-center justify-center rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white dark:bg-white dark:text-slate-900 disabled:opacity-50"
                >
                  Guardar y siguiente
                </button>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={goPrevFicha}
                  className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold dark:border-slate-600 disabled:opacity-50"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Anterior
                </button>
                <button type="button" disabled={busy} onClick={() => void saveFicha()} className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold dark:border-slate-600 disabled:opacity-50">
                  Guardar ficha
                </button>
                <button type="button" disabled={busy} onClick={() => void decide("approved")} className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                  <Check className="h-4 w-4" />
                  Aprobar y abrir
                </button>
                <button type="button" disabled={busy} onClick={() => void decide("denied")} className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-rose-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                  <X className="h-4 w-4" />
                  Denegar
                </button>
              </div>
            )}
      </Modal>
      ) : null}

      <Modal
        open={minorsOpen}
        onClose={() => {
          setMinorsDraft(minorsSnapshot);
          setMinorsOpen(false);
        }}
        size="sm"
        zClass="z-[70]"
      >
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">Menores en el vehículo</h3>
          <p className="text-xs text-slate-500">
            Solo la cantidad. No hay que cargar nombre ni DNI.
            {current?.sentido === "out"
              ? ` En el ingreso se anotaron ${current.minorsInCount ?? 0}.`
              : " Se guarda en el ingreso y se contrasta en la salida."}
          </p>
          <div className="flex items-center justify-center gap-4 py-2">
            <button
              type="button"
              className="h-12 w-12 rounded-xl border border-slate-300 text-2xl font-bold dark:border-slate-600"
              onClick={() => setMinorsDraft((n) => Math.max(0, n - 1))}
            >
              −
            </button>
            <span className="min-w-[3rem] text-center text-3xl font-bold tabular-nums">{minorsDraft}</span>
            <button
              type="button"
              className="h-12 w-12 rounded-xl border border-slate-300 text-2xl font-bold dark:border-slate-600"
              onClick={() => setMinorsDraft((n) => Math.min(20, n + 1))}
            >
              +
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold dark:border-slate-600"
              onClick={() => {
                setMinorsDraft(minorsSnapshot);
                setMinorsOpen(false);
              }}
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={busy}
              className="flex-1 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white dark:bg-white dark:text-slate-900 disabled:opacity-50"
              onClick={() => void saveMinors(minorsDraft)}
            >
              Guardar
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
