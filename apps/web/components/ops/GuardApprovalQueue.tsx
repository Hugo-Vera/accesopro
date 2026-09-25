"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Baby, Bell, Check, FileCheck2, Footprints, Minus, Phone, Plus, QrCode, Trash2, X } from "lucide-react";
import { api, apiUrl, withTenant } from "@/lib/api";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { LiveVisitHoldToast, type VisitHoldAlert } from "@/components/ops/LiveVisitHoldToast";
import { DniScanPanel } from "@/components/DniScanPanel";
import { DocumentScanPanel, type AcceptedDoc } from "@/components/ops/DocumentScanPanel";
import {
  TrunkEditor,
  TrunkPhotoZoom,
  trunkDraftDirty,
  trunkDraftFrom,
  type TrunkCheck,
  type TrunkDraft,
} from "@/components/ops/TrunkInspection";
import { parseDniScan, parsedFullName, parsedIdentityMatches } from "@/lib/parseDni";
import {
  ARRIVAL_MODES,
  VISIT_KINDS,
  arrivalModeLabel,
  artLabelFor,
  docRequirements,
  expiredLabel,
  fmtDay,
  isPastDay,
  isoDay,
  missingInfo,
  normalizeArrivalMode,
  normalizeVisitKind,
  personInsuranceKindFor,
  visitKindLabel,
  type ArrivalModeId,
  type FichaPage,
  type VisitKindId,
} from "@/lib/visitDocs";
import { Modal } from "@/components/ui/Modal";
import { ExitFicha } from "@/components/ops/ExitFicha";

type FichaStep = FichaPage;

const FICHA_LABEL: Record<FichaStep, string> = {
  identity: "Identidad",
  type: "Tipo de ingreso",
  vehicle: "Vehículo",
  art: "ART",
  companions: "Acompañantes",
  exit: "Egreso",
  summary: "Aprobar",
};

function fichaStepsOf(visitKind: string, arrivalMode: string): FichaStep[] {
  const steps: FichaStep[] = ["identity"];
  const req = docRequirements(visitKind, arrivalMode);
  steps.push("type");
  if (req.vehicle) steps.push("vehicle");
  if (req.art) steps.push("art");
  steps.push("companions", "summary");
  return steps;
}

type DocOnFile = {
  id: string;
  kind?: string;
  company: string | null;
  policyNumber?: string | null;
  licenseNumber?: string | null;
  plate?: string | null;
  validUntil: string | number;
  hasDocument: boolean;
  expired: boolean;
};

function OnFileCard({
  title,
  doc,
  detail,
  active,
  onUse,
  disabled,
}: {
  title: string;
  doc: DocOnFile;
  detail: string;
  active: boolean;
  onUse: () => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-[11px] ${
        doc.expired
          ? "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
          : "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
      }`}
    >
      <div className="min-w-0">
        <p className="font-bold">En archivo · {title}</p>
        <p className="truncate">
          {detail} · vence {fmtDay(doc.validUntil)}
          {doc.expired ? " (vencido)" : ""}
          {doc.hasDocument ? " · con foto" : " · sin foto"}
        </p>
      </div>
      <button
        type="button"
        disabled={disabled || doc.expired}
        onClick={onUse}
        className={`shrink-0 rounded-lg px-2 py-1 font-bold disabled:opacity-50 ${
          active ? "bg-emerald-700 text-white" : "border border-current"
        }`}
      >
        {active ? "Usando" : "Usar"}
      </button>
    </div>
  );
}

function LinkedDocRow({ label, until, hasPhoto, expired }: { label: string; until: string | number; hasPhoto: boolean; expired: boolean }) {
  return (
    <p
      className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold ${
        expired
          ? "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
          : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
      }`}
    >
      <FileCheck2 className="h-3.5 w-3.5 shrink-0" />
      {label} · vence {fmtDay(until)}
      {expired ? " · VENCIDO" : ""}
      {hasPhoto ? " · con foto" : " · falta foto"}
    </p>
  );
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
  needsLicense?: boolean;
  needsVehicle?: boolean;
  visitKind?: string;
  missing: string[];
  expiredDocs?: string[];
  canSwitchToPedestrian?: boolean;
  trunkChecked?: boolean;
  onFile?: { art: DocOnFile | null; license: DocOnFile | null; insurance: DocOnFile | null };
  trunkIn?: TrunkCheck | null;
  trunkOut?: TrunkCheck | null;
  companions: { id?: string; name: string; dni: string | null; isMinor?: boolean; presence?: "in" | "out_temp" | "out" }[];
  overstay?: boolean;
  reentry?: boolean;
  returns?: boolean;
  exitPeople?: { guest: boolean; companionIds: string[]; vehicle: boolean } | null;
  guestPresence?: "in" | "out_temp" | "out";
  minorsOutTemp?: number;
  trunkThisRound?: boolean;
  verbalAuthorizedBy?: string | null;
  insurance?: {
    id?: string;
    company?: string;
    policyNumber?: string;
    validUntil?: string | number;
    hasPhoto?: boolean;
    expired?: boolean;
  } | null;
  personInsurance?: {
    id: string;
    kind: string;
    company: string | null;
    validUntil: string | number;
    hasDocument: boolean;
    expired?: boolean;
  } | null;
  license?: { id: string; licenseNumber: string; validUntil: string | number; hasPhoto?: boolean; expired?: boolean } | null;
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

/** Una sola línea de estado en el encabezado de entrada, por prioridad. */
function entryStatusLine(item: GuardApprovalItem, passExpired: boolean): { tone: "red" | "amber" | "slate"; text: string } | null {
  if (passExpired) {
    return item.windowState === "too_early" || item.reason === "too_early"
      ? { tone: "red", text: `Todavía no vale: habilitado desde ${fmtWindow(item.validFrom)}` }
      : { tone: "red", text: `Pase vencido: valía hasta ${fmtWindow(item.validUntil)}` };
  }
  if (item.reason === "walk_in") {
    if (item.ownerAuthStatus === "owner_approved") return { tone: "slate", text: `Autorizó: ${item.ownerAuthorizedByName || "el lote"}` };
    if (item.ownerAuthStatus === "owner_denied") return { tone: "red", text: `${item.ownerAuthorizedByName || "El lote"} rechazó. Denegá o llamá al lote.` };
    if (item.ownerAuthStatus === "owner_expired") return { tone: "amber", text: "El lote no contestó. Llamá y confirmá con tu código de guardia." };
    return { tone: "amber", text: "Avisamos al lote (2 min). La barrera la abrís vos." };
  }
  if (item.laneMismatch) {
    return { tone: "amber", text: `Presentó el QR en el tótem de ${item.readerSentido === "out" ? "salida" : "ingreso"}: se trata como ingreso.` };
  }
  const who = item.ownerAuthorizedByName || item.verbalAuthorizedBy || (item.reason !== "preview" ? item.ownerName : null);
  return who ? { tone: "slate", text: `Autorizó: ${who}` } : null;
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
  const [guardCode, setGuardCode] = useState("");
  const [companionsDraft, setCompanionsDraft] = useState<{ name: string; dni: string }[]>([]);
  const [exitOverlay, setExitOverlay] = useState(false);
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
  const [minorsDraft, setMinorsDraft] = useState(0);
  const [visitKind, setVisitKind] = useState<VisitKindId>("social");
  const [arrivalMode, setArrivalMode] = useState<ArrivalModeId>("peatonal");
  const [insReuse, setInsReuse] = useState<string | null>(null);
  const [artReuse, setArtReuse] = useState<string | null>(null);
  const [licReuse, setLicReuse] = useState<string | null>(null);
  const [trunkDraft, setTrunkDraft] = useState<TrunkDraft>({ description: "", add: [], remove: [] });
  const [zoom, setZoom] = useState<{ photos: string[]; index: number } | null>(null);

  const load = useCallback(() => {
    if (!enabled || !tenantId) return;
    api<{ items: GuardApprovalItem[] }>(withTenant("/api/visitors/approvals", tenantId))
      .then((d) => setItems(d.items || []))
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
          denied: p.denied === true,
          expired: p.expired === true || p.reason === "expired" || p.reason === "too_early",
          validFrom: (p.validFrom as string | number | null | undefined) ?? null,
          validUntil: (p.validUntil as string | number | null | undefined) ?? null,
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
  const passExpired = Boolean(
    current && (current.reason === "expired" || current.reason === "too_early" || current.windowState === "expired" || current.windowState === "too_early"),
  );
  const exitMode = Boolean(current && (current.sentido === "out" || current.reentry));
  const req = docRequirements(visitKind, arrivalMode);
  const expiredDocs = !exitMode ? current?.expiredDocs || [] : [];
  const canApprove = canDecide && !passExpired && expiredDocs.length === 0;
  const fichaSteps = current && !exitMode ? fichaStepsOf(visitKind, arrivalMode) : [];
  const stepKey = fichaSteps[Math.min(fichaStep, Math.max(0, fichaSteps.length - 1))] ?? "identity";
  const trunkSaved = current?.trunkIn;
  const artLabel = artLabelFor(visitKind);
  const statusLine = current && !exitMode ? entryStatusLine(current, passExpired) : null;
  useEscapeKey(() => {
    if (zoom) {
      setZoom(null);
      return;
    }
    if (exitOverlay) return;
    if (docKind) {
      setDocKind(null);
      return;
    }
    if (scanOpen) {
      setScanOpen(false);
      return;
    }
    if (fichaStep > 0 && !exitMode) {
      setFichaStep((n) => Math.max(0, n - 1));
      return;
    }
    setOpenId(null);
    setPreview(null);
  }, Boolean(current) || scanOpen || Boolean(docKind) || Boolean(zoom));

  useEffect(() => {
    if (!current) return;
    setComment("");
    setTrunkChecked(Boolean(current.trunkChecked));
    setVisitKind(normalizeVisitKind(current.visitKind));
    setArrivalMode(normalizeArrivalMode(current.arrivalMode));
    setInsReuse(null);
    setArtReuse(null);
    setLicReuse(null);
    setTrunkDraft(trunkDraftFrom(current.trunkIn));
    setZoom(null);
    setExitOverlay(false);
    setGuestDni(current.guestDni || "");
    setGuestName(current.guestName || "");
    setFichaStep(0);
    setDniMatch("idle");
    setPlate(current.patente || "");
    setMinorsDraft(current.minorsCount ?? 0);
    setGuardCode("");
    setError(null);
    setCompanionsDraft((current.companions || []).map((x) => ({ name: x.name, dni: x.dni || "" })));
    setInsCompany(current.insurance?.company || "");
    setInsPolicy(current.insurance?.policyNumber || "");
    setInsUntil(isoDay(current.insurance?.validUntil));
    setArtUntil(isoDay(current.personInsurance?.validUntil));
    setArtCompany(current.personInsurance?.company || "");
    setLicUntil(isoDay(current.license?.validUntil));
    setLicNumber(current.license?.licenseNumber || "");
    setVehDoc(null);
    setArtDoc(null);
    setLicDoc(null);
  }, [current?.id, current?.sentido, current?.reentry]);

  function fichaPayload(): Record<string, unknown> {
    if (!current || exitMode) return {};
    const out: Record<string, unknown> = {
      guestDni,
      guestName,
      minorsCount: minorsDraft,
      companions: companionsDraft.filter((x) => x.name.trim()),
    };
    out.visitKind = visitKind;
    out.arrivalMode = arrivalMode;
    if (req.vehicle) {
      out.patente = plate || undefined;
      if (insReuse || insCompany || insPolicy || insUntil || vehDoc) {
        out.insurance = {
          plate,
          company: insCompany,
          policyNumber: insPolicy,
          validUntil: insUntil,
          cardPhotoBase64: vehDoc?.base64 || undefined,
          reuseId: insReuse || undefined,
        };
      }
      if (licReuse || licNumber || licUntil || licDoc) {
        out.driverLicense = {
          licenseNumber: licNumber,
          validUntil: licUntil,
          photoBase64: licDoc?.base64 || undefined,
          reuseId: licReuse || undefined,
        };
      }
    }
    if (req.art && (artReuse || artUntil || artDoc)) {
      out.personInsurance = {
        kind: personInsuranceKindFor(visitKind),
        company: artCompany,
        validUntil: artUntil,
        documentBase64: artDoc?.base64 || undefined,
        documentMime: artDoc?.mime,
        source: artDoc?.source || "scan",
        reuseId: artReuse || undefined,
      };
    }
    return out;
  }

  function showApiError(err: unknown, fallback: string) {
    const msg = err instanceof Error ? err.message : fallback;
    const data = (err as { data?: { missing?: string[] } } | null)?.data;
    const missing = data?.missing || [];
    if (missing.length && current) {
      const infos = missing.map((k) => missingInfo(k, current.sentido));
      setError(`${msg} ${infos.map((x) => x.label).join(" · ")}`.trim());
      const target = fichaSteps.indexOf(infos[0].page);
      if (target >= 0) setFichaStep(target);
    } else {
      setError(msg);
    }
    load();
  }

  async function saveTrunkIfDirty() {
    if (!current || !canDecide || !req.trunk) return;
    if (!trunkDraftDirty(trunkDraft, trunkSaved)) return;
    await api(withTenant(`/api/visitors/approvals/${current.id}/trunk`, tenantId), {
      method: "POST",
      body: JSON.stringify({
        description: trunkDraft.description,
        addPhotosBase64: trunkDraft.add,
        removePhotoIds: trunkDraft.remove,
      }),
    });
    setTrunkDraft((d) => ({ description: d.description, add: [], remove: [] }));
  }

  async function decide(decision: "approved" | "denied") {
    if (!current || !canDecide) return;
    if (decision === "approved" && passExpired) {
      setError("El pase está vencido. Solo se puede denegar.");
      return;
    }
    if (decision === "approved" && expiredDocs.length) {
      setError("Documento vencido: no puede ingresar con el vehículo.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (decision === "approved") await saveTrunkIfDirty();
      await api(withTenant(`/api/visitors/approvals/${current.id}/decide`, tenantId), {
        method: "POST",
        body: JSON.stringify({ decision, comment, trunkChecked, ...fichaPayload() }),
      });
      setOpenId(null);
      setPreview(null);
      load();
    } catch (err) {
      showApiError(err, "No se pudo resolver");
    } finally {
      setBusy(false);
    }
  }

  async function toPedestrian() {
    if (!current || !canDecide) return;
    setBusy(true);
    setError(null);
    try {
      await api(withTenant(`/api/visitors/approvals/${current.id}/pedestrian`, tenantId), { method: "POST" });
      setArrivalMode("peatonal");
      setPlate("");
      setInsReuse(null);
      setLicReuse(null);
      setVehDoc(null);
      setLicDoc(null);
      setTrunkDraft({ description: "", add: [], remove: [] });
      setFichaStep(0);
      load();
    } catch (err) {
      showApiError(err, "No se pudo pasar a peatonal");
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
      const res = await api<{
        approvalId?: string;
        passId?: string;
        item?: GuardApprovalItem;
        accessKind?: string;
        personName?: string;
        actuatorsFired?: string[];
        ok?: boolean;
        denied?: boolean;
        error?: string;
      }>(withTenant("/api/visitors/approvals/scan-qr", tenantId), {
        method: "POST",
        body: JSON.stringify({ cardRaw: raw, scanChannel: "web" }),
      });
      setScanOpen(false);
      load();
      if (res.accessKind === "access_qr") {
        setError(null);
        window.alert(
          `Acceso propio: ${res.personName || "vecino"}. ${
            res.actuatorsFired?.length ? "Barrera abierta." : "Relé disparado."
          }`,
        );
        return true;
      }
      if (res.item?.id) {
        setPreview(null);
        setOpenId(res.item.id);
      } else if (res.passId) {
        window.dispatchEvent(new CustomEvent("ap:open-visit-approval", { detail: { passId: res.passId } }));
      }
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "QR no autorizado";
      setError(msg);
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
        body: JSON.stringify({ ...fichaPayload(), ...extra }),
      });
      await saveTrunkIfDirty();
      load();
      return true;
    } catch (err) {
      showApiError(err, "No se pudo guardar la ficha");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function goNextFicha() {
    setDocKind(null);
    if (canDecide) {
      const ok = await saveFicha();
      if (!ok) return;
    }
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
            {exitMode ? (
              <ExitFicha
                item={current}
                tenantId={tenantId}
                canDecide={canDecide}
                onClose={() => {
                  setOpenId(null);
                  setPreview(null);
                }}
                onDone={() => {
                  setOpenId(null);
                  setPreview(null);
                  load();
                }}
                onReload={load}
                onZoom={(photos, index) => setZoom({ photos, index })}
                onOverlayChange={setExitOverlay}
              />
            ) : (
            <>
            <div className="mb-3 flex items-start justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                  Entrada · Lote {current.lotNumber || "—"} · {current.ownerName}
                </p>
                <h3 id="ap-guard-ficha-title" className="text-lg font-bold text-slate-900 dark:text-white">{current.guestName}</h3>
                <p className="text-xs text-slate-600 dark:text-slate-300">
                  {current.guestDni ? `DNI ${current.guestDni}` : "DNI pendiente"}
                </p>
                {statusLine ? (
                  <p
                    className={`mt-0.5 text-[11px] font-semibold ${
                      statusLine.tone === "red"
                        ? "text-rose-700 dark:text-rose-300"
                        : statusLine.tone === "amber"
                          ? "text-amber-800 dark:text-amber-300"
                          : "text-slate-600 dark:text-slate-300"
                    }`}
                  >
                    {statusLine.text}
                  </p>
                ) : null}
              </div>
              <button type="button" onClick={() => { setOpenId(null); setPreview(null); }} className="rounded p-1 text-slate-500" aria-label="Cerrar">
                <X className="h-5 w-5" />
              </button>
            </div>

            {current.missing.length ? (
              <div className="mb-2 flex flex-wrap gap-1">
                {current.missing.map((k) => {
                  const info = missingInfo(k, current.sentido);
                  const target = fichaSteps.indexOf(info.page);
                  return (
                    <button
                      key={k}
                      type="button"
                      disabled={target < 0}
                      onClick={() => target >= 0 && setFichaStep(target)}
                      className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 disabled:cursor-default dark:bg-rose-950/40 dark:text-rose-300"
                    >
                      {info.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
            {expiredDocs.length ? (
              <div className="mb-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
                <p>{expiredDocs.map(expiredLabel).join(" · ")}.</p>
                <p className="mt-0.5 font-normal">
                  {current.canSwitchToPedestrian
                    ? "No puede ingresar con el vehículo. Puede dejarlo afuera y pasar a pie: se le toman los datos como ingreso caminando."
                    : "No puede ingresar. Solo se puede denegar."}
                </p>
                {canDecide && current.canSwitchToPedestrian ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void toPedestrian()}
                    className="mt-2 inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
                  >
                    <Footprints className="h-3.5 w-3.5" />
                    Pasar a peatonal
                  </button>
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
              {dniMatch === "ok" ? (
                <p className="col-span-2 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">El DNI coincide con el precargado.</p>
              ) : dniMatch === "filled" ? (
                <p className="col-span-2 text-[11px] font-semibold text-amber-800 dark:text-amber-300">Se cargaron nombre y DNI desde el plástico.</p>
              ) : (
                <p className="col-span-2 text-[11px] text-slate-500">Escaneá el DNI para confirmar.</p>
              )}
              {canDecide ? (
                <div className="col-span-2">
                  <DniScanPanel
                    active={Boolean(current) && !scanOpen}
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

            {stepKey === "type" ? (
              <div className="space-y-3 text-xs">
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Tipo de visita</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {VISIT_KINDS.map((k) => (
                      <button
                        key={k.id}
                        type="button"
                        disabled={!canDecide}
                        onClick={() => setVisitKind(k.id)}
                        className={`rounded-lg border px-2 py-2 text-[11px] font-bold ${
                          visitKind === k.id
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-200"
                        }`}
                      >
                        {k.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Cómo llega</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {ARRIVAL_MODES.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        disabled={!canDecide}
                        onClick={() => setArrivalMode(m.id)}
                        className={`rounded-lg border px-2 py-2 text-[11px] font-bold ${
                          arrivalMode === m.id
                            ? "border-blue-600 bg-blue-600 text-white"
                            : "border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-200"
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                  <p className="font-bold">La ficha va a pedir</p>
                  <p>
                    DNI
                    {req.vehicle ? " · patente · seguro del auto con foto · licencia con foto · baúl" : ""}
                    {req.art ? ` · ${artLabel} con constancia` : ""}
                  </p>
                  <p className="mt-1 text-slate-500">Un documento vencido no pasa. Si es el seguro o la licencia, puede entrar a pie.</p>
                </div>
              </div>
            ) : null}

            {stepKey === "vehicle" ? (
            <div className="space-y-3 text-xs">
              <label className="block">
                Patente
                <input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 uppercase dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              </label>

              <div className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Seguro del auto</p>
                {current.insurance?.validUntil ? (
                  <LinkedDocRow
                    label={`${current.insurance.company || "Seguro"}${current.insurance.policyNumber ? ` · ${current.insurance.policyNumber}` : ""}`}
                    until={current.insurance.validUntil}
                    hasPhoto={Boolean(current.insurance.hasPhoto)}
                    expired={Boolean(current.insurance.expired)}
                  />
                ) : null}
                {current.onFile?.insurance ? (
                  <OnFileCard
                    title="Seguro"
                    doc={current.onFile.insurance}
                    detail={`${current.onFile.insurance.company || "—"} · ${current.onFile.insurance.policyNumber || "—"}`}
                    active={insReuse === current.onFile.insurance.id}
                    disabled={!canDecide}
                    onUse={() => setInsReuse(insReuse === current.onFile?.insurance?.id ? null : current.onFile?.insurance?.id || null)}
                  />
                ) : null}
                {!insReuse ? (
                  <div className="grid grid-cols-2 gap-2">
                    <label>
                      Compañía
                      <input value={insCompany} onChange={(e) => setInsCompany(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                    </label>
                    <label>
                      Póliza
                      <input value={insPolicy} onChange={(e) => setInsPolicy(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                    </label>
                    <label className="col-span-2">
                      Vence
                      <input type="date" value={insUntil} onChange={(e) => setInsUntil(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                    </label>
                    {insUntil && isPastDay(insUntil) ? (
                      <p className="col-span-2 text-[11px] font-semibold text-rose-700 dark:text-rose-300">Seguro vencido: no puede entrar con el auto.</p>
                    ) : null}
                  </div>
                ) : null}
                {canDecide ? (
                  <>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Foto de la tarjeta del seguro (obligatoria)</p>
                    <DocumentScanPanel
                      tenantId={tenantId}
                      value={vehDoc}
                      overlayOpen={docKind === "vehicle"}
                      onOverlayChange={(open) => setDocKind(open ? "vehicle" : docKind === "vehicle" ? null : docKind)}
                      onAccept={setVehDoc}
                      onClear={() => setVehDoc(null)}
                    />
                  </>
                ) : null}
              </div>

              <div className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Licencia de conducir</p>
                {current.license?.validUntil ? (
                  <LinkedDocRow
                    label={`Licencia ${current.license.licenseNumber || ""}`.trim()}
                    until={current.license.validUntil}
                    hasPhoto={Boolean(current.license.hasPhoto)}
                    expired={Boolean(current.license.expired)}
                  />
                ) : null}
                {current.onFile?.license ? (
                  <OnFileCard
                    title="Licencia"
                    doc={current.onFile.license}
                    detail={current.onFile.license.licenseNumber || "—"}
                    active={licReuse === current.onFile.license.id}
                    disabled={!canDecide}
                    onUse={() => setLicReuse(licReuse === current.onFile?.license?.id ? null : current.onFile?.license?.id || null)}
                  />
                ) : null}
                {!licReuse ? (
                  <div className="grid grid-cols-2 gap-2">
                    <label>
                      Nro. de licencia
                      <input value={licNumber} onChange={(e) => setLicNumber(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                    </label>
                    <label>
                      Vence
                      <input type="date" value={licUntil} onChange={(e) => setLicUntil(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                    </label>
                    {licUntil && isPastDay(licUntil) ? (
                      <p className="col-span-2 text-[11px] font-semibold text-rose-700 dark:text-rose-300">Licencia vencida: no puede entrar manejando.</p>
                    ) : null}
                  </div>
                ) : null}
                {canDecide ? (
                  <>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Foto de la licencia (obligatoria)</p>
                    <DocumentScanPanel
                      tenantId={tenantId}
                      value={licDoc}
                      overlayOpen={docKind === "license"}
                      onOverlayChange={(open) => setDocKind(open ? "license" : docKind === "license" ? null : docKind)}
                      onAccept={setLicDoc}
                      onClear={() => setLicDoc(null)}
                    />
                  </>
                ) : null}
              </div>

              <TrunkEditor
                tenantId={tenantId}
                saved={current.trunkIn}
                draft={trunkDraft}
                onChange={setTrunkDraft}
                onZoom={(photos, index) => setZoom({ photos, index })}
                onError={setError}
                disabled={!canDecide}
                title="Revisión del baúl al ingreso"
              />
            </div>
            ) : null}

            {stepKey === "art" ? (
                <div className="space-y-2 rounded-lg border border-slate-200 p-2 text-xs dark:border-slate-700">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{artLabel}</p>
                  {current.personInsurance?.validUntil ? (
                    <LinkedDocRow
                      label={`${current.personInsurance.kind === "life" ? "Seguro de vida" : "ART"} ${current.personInsurance.company || ""}`.trim()}
                      until={current.personInsurance.validUntil}
                      hasPhoto={current.personInsurance.hasDocument}
                      expired={Boolean(current.personInsurance.expired)}
                    />
                  ) : null}
                  {current.onFile?.art ? (
                    <OnFileCard
                      title={current.onFile.art.kind === "life" ? "Seguro de vida" : "ART"}
                      doc={current.onFile.art}
                      detail={current.onFile.art.company || "—"}
                      active={artReuse === current.onFile.art.id}
                      disabled={!canDecide}
                      onUse={() => setArtReuse(artReuse === current.onFile?.art?.id ? null : current.onFile?.art?.id || null)}
                    />
                  ) : null}
                  {!artReuse ? (
                    <>
                      <label className="block">
                        Compañía
                        <input value={artCompany} onChange={(e) => setArtCompany(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                      </label>
                      <label className="block">
                        Vence
                        <input type="date" value={artUntil} onChange={(e) => setArtUntil(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
                      </label>
                      {artUntil && isPastDay(artUntil) ? (
                        <p className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">{artLabel} vencida: no puede ingresar.</p>
                      ) : null}
                    </>
                  ) : null}
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
                <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2 py-1.5 dark:border-slate-700">
                  <div>
                    <p className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-800 dark:text-slate-100">
                      <Baby className="h-3.5 w-3.5" />
                      Menores
                    </p>
                    <p className="text-[10px] text-slate-500">Solo la cantidad, sin nombre ni DNI. Se contrasta en la salida.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Restar menor"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 dark:border-slate-600 dark:text-white"
                      onClick={() => setMinorsDraft((n) => Math.max(0, n - 1))}
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="min-w-[1.5rem] text-center text-base font-bold tabular-nums text-slate-900 dark:text-white">{minorsDraft}</span>
                    <button
                      type="button"
                      aria-label="Sumar menor"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 dark:border-slate-600 dark:text-white"
                      onClick={() => setMinorsDraft((n) => Math.min(20, n + 1))}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <DniScanPanel
                  active={Boolean(current) && !scanOpen}
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

            {stepKey === "summary" ? (
              <div className="space-y-2 text-xs">
                <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                  <p className="font-semibold text-slate-800 dark:text-slate-100">{guestName || current.guestName}</p>
                  <p className="text-slate-500">DNI {guestDni || current.guestDni || "—"}</p>
                  {current.approvedByName ? (
                    <p className="text-slate-500">
                      Aprobó {current.approvedByName}
                      {current.approvedVia === "login" ? " (sesión)" : ""}
                      {current.phoneAuthVia === "guard_code" ? " · autorización con código de guardia" : ""}
                    </p>
                  ) : current.phoneAuthVia === "guard_code" && current.ownerAuthorizedByName ? (
                    <p className="text-slate-500">Código de guardia: {current.ownerAuthorizedByName}</p>
                  ) : null}
                  <p className="text-slate-500">
                    {visitKindLabel(visitKind)} · {arrivalModeLabel(arrivalMode)}
                  </p>
                  {req.vehicle ? (
                    <p className="text-slate-500">
                      Patente {plate || current.patente || "—"} · baúl{" "}
                      {current.trunkIn || trunkDraftDirty(trunkDraft, current.trunkIn) ? "revisado" : "pendiente"}
                    </p>
                  ) : (
                    <p className="text-slate-500">Ingreso sin vehículo</p>
                  )}
                  {minorsDraft > 0 ? <p className="text-slate-500">Menores: {minorsDraft}</p> : null}
                  {req.vehicle ? (
                    <p className="text-slate-500">
                      Seguro {insReuse ? "en archivo" : `vence ${insUntil ? fmtDay(insUntil) : fmtDay(current.insurance?.validUntil)}`} · licencia{" "}
                      {licReuse ? "en archivo" : `vence ${licUntil ? fmtDay(licUntil) : fmtDay(current.license?.validUntil)}`}
                    </p>
                  ) : null}
                  {req.art ? (
                    <p className="text-slate-500">
                      {artLabel} {artReuse ? "en archivo" : `${artCompany || "—"} · vence ${artUntil ? fmtDay(artUntil) : "—"}`}
                    </p>
                  ) : null}
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

            {stepKey === "summary" ? (
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
            ) : null}

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
                <button type="button" disabled={busy || !canApprove} onClick={() => void decide("approved")} className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                  <Check className="h-4 w-4" />
                  Aprobar y abrir
                </button>
                <button type="button" disabled={busy} onClick={() => void decide("denied")} className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-rose-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
                  <X className="h-4 w-4" />
                  Denegar
                </button>
              </div>
            )}
            {passExpired ? (
              <p className="mt-2 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                Pase vencido o fuera de vigencia: no se puede abrir. Solo denegar. Quedó en historial.
              </p>
            ) : expiredDocs.length && stepKey === "summary" ? (
              <p className="mt-2 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                Hay un documento vencido: no se puede aprobar el ingreso con el vehículo.
              </p>
            ) : null}
            </>
            )}
      </Modal>
      ) : null}

      <TrunkPhotoZoom
        photos={zoom?.photos || []}
        index={zoom?.index ?? 0}
        onIndex={(i) => setZoom((z) => (z ? { ...z, index: i } : z))}
        onClose={() => setZoom(null)}
      />
    </>
  );
}
