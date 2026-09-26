"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Baby, Bell, Check, ChevronDown, DoorOpen, FileCheck2, Footprints, Info, Minus, Pencil, Phone, Plus, QrCode, Trash2, X } from "lucide-react";
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
  ageFrom,
  artLabelFor,
  docRequirements,
  isMinorAge,
  minorsAllowed,
  MINOR_KIND_TEXT,
  expiredLabel,
  fmtDay,
  fmtStamp,
  isPastDay,
  isoDay,
  missingInfo,
  normalizeArrivalMode,
  normalizeVisitKind,
  personInsuranceKindFor,
  requiredDocsFor,
  visitKindLabel,
  type ArrivalModeId,
  type EntryRule,
  type FichaPage,
  type VisitKindId,
} from "@/lib/visitDocs";
import { Modal } from "@/components/ui/Modal";
import { ExitFicha } from "@/components/ops/ExitFicha";

const INPUT_CLS =
  "mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white";

/** La ficha de ingreso es un solo scroll: cada faltante lleva a su sección. */
function scrollToSection(page: FichaPage, openSummary?: () => void) {
  const id = page === "vehicle" || page === "art" || page === "identity" ? page : "summary";
  if (id === "summary") openSummary?.();
  document.getElementById(`ficha-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

type IdentityHistory = {
  found: boolean;
  blacklisted?: boolean;
  visitCount?: number;
  flags?: { overstays: number; denials: number; goodsDenied: number };
  lastComment?: string | null;
  lastVisit?: { visitType: string; lotNumber: string | null; patente: string | null; at: string | null } | null;
};

/** Antecedentes del DNI: resaltado si ya vino, rojo si hay marcas para alertar al guardia. */
function HistoryBox({ history }: { history: IdentityHistory | null }) {
  if (!history?.found) return null;
  const f = history.flags || { overstays: 0, denials: 0, goodsDenied: 0 };
  const alert = Boolean(history.blacklisted) || f.overstays > 0 || f.denials > 0 || f.goodsDenied > 0;
  const count = history.visitCount || 0;
  const lv = history.lastVisit;
  return (
    <div
      className={`mb-3 flex gap-2 rounded-xl border px-3 py-2 text-[12px] ${
        alert
          ? "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100"
          : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
      }`}
    >
      {alert ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="min-w-0 space-y-0.5">
        <p className="font-bold">
          {count > 1 ? `Ya vino ${count} veces` : count === 1 ? "Ya vino 1 vez" : "Tiene antecedentes en el barrio"}
        </p>
        {lv?.at ? (
          <p>
            Último ingreso {fmtStamp(lv.at)}
            {lv.lotNumber ? ` · lote ${lv.lotNumber}` : ""} · {visitKindLabel(lv.visitType)}
            {lv.patente ? ` · ${lv.patente}` : ""}
          </p>
        ) : null}
        {history.blacklisted ? <p className="font-bold">Tiene impedimento de ingreso. Consultá con administración.</p> : null}
        {f.denials > 0 ? <p className="font-semibold">Ingreso denegado {f.denials} {f.denials === 1 ? "vez" : "veces"}</p> : null}
        {f.overstays > 0 ? <p className="font-semibold">Se pasó del horario {f.overstays} {f.overstays === 1 ? "vez" : "veces"}</p> : null}
        {f.goodsDenied > 0 ? <p className="font-semibold">Intentó sacar un bien sin autorización</p> : null}
        {history.lastComment ? <p className="line-clamp-2 text-[11px] opacity-80">Nota: {history.lastComment}</p> : null}
      </div>
    </div>
  );
}

function RequiredDocs({
  visitKind,
  arrivalMode,
  dniRead,
  rules,
}: {
  visitKind: string;
  arrivalMode: string;
  dniRead: boolean;
  rules: EntryRule[] | null;
}) {
  const docs = requiredDocsFor(visitKind, arrivalMode, dniRead, rules);
  return (
    <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100">
      {docs.length ? (
        <>
          <p className="font-bold">Solicitar siguientes documentos:</p>
          <ul className="mt-0.5 list-disc pl-5">
            {docs.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="font-bold">No hace falta pedir otros documentos.</p>
      )}
    </div>
  );
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
  guestBirthDate?: string | null;
  guestAge?: number | null;
  patente: string | null;
  arrivalMode: string;
  needsTrunk: boolean;
  needsArt?: boolean;
  needsLicense?: boolean;
  needsVehicle?: boolean;
  /** Regla del barrio para el tipo y medio del pase. */
  rule?: EntryRule | null;
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
  goodsPhotoUrl?: string | null;
  goodsAuthorized?: boolean;
  goodsAuthorizedByName?: string | null;
  goodsDenied?: boolean;
  goodsCallReady?: boolean;
  minorsIn?: number;
  adultsIn?: number;
  originPropertyId?: string | null;
  minorTransferAuthorized?: boolean;
  needsPhoneAuth?: boolean;
};

type Props = { tenantId: string; enabled: boolean };

function fmtWindow(v: string | number) {
  return fmtStamp(v);
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
  const [editIdentity, setEditIdentity] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const [verifyDni, setVerifyDni] = useState(false);
  const [companionScan, setCompanionScan] = useState(false);
  const [history, setHistory] = useState<IdentityHistory | null>(null);
  const [licTouched, setLicTouched] = useState(false);
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
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [visitKind, setVisitKind] = useState<VisitKindId>("social");
  const [arrivalMode, setArrivalMode] = useState<ArrivalModeId>("peatonal");
  const [insReuse, setInsReuse] = useState<string | null>(null);
  const [artReuse, setArtReuse] = useState<string | null>(null);
  const [licReuse, setLicReuse] = useState<string | null>(null);
  const [trunkDraft, setTrunkDraft] = useState<TrunkDraft>({ description: "", add: [], remove: [] });
  const [zoom, setZoom] = useState<{ photos: string[]; index: number } | null>(null);
  const [entryRules, setEntryRules] = useState<EntryRule[] | null>(null);

  useEffect(() => {
    if (!enabled || !tenantId) return;
    api<{ rules: EntryRule[] }>(withTenant("/api/visitors/entry-rules", tenantId))
      .then((d) => setEntryRules(d.rules || null))
      .catch(() => undefined);
  }, [enabled, tenantId]);

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
  const rules = entryRules ?? (current?.rule ? [current.rule] : null);
  const req = docRequirements(visitKind, arrivalMode, rules);
  const expiredDocs = !exitMode ? current?.expiredDocs || [] : [];
  const guestAge = current ? current.guestAge ?? ageFrom(current.guestBirthDate) : null;
  const guestMinor = isMinorAge(guestAge);
  const canApprove = canDecide && !passExpired && expiredDocs.length === 0 && !(guestMinor && !minorsAllowed(visitKind));
  const trunkSaved = current?.trunkIn;
  const artLabel = artLabelFor(req);
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
    if (!exitMode && (typeOpen || editIdentity || verifyDni || companionScan)) {
      setTypeOpen(false);
      setEditIdentity(false);
      setVerifyDni(false);
      setCompanionScan(false);
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
    setEditIdentity(false);
    setTypeOpen(false);
    setVerifyDni(false);
    setCompanionScan(false);
    setHistory(null);
    setLicTouched(Boolean(current.license?.licenseNumber));
    setDniMatch("idle");
    setPlate(current.patente || "");
    setMinorsDraft(current.minorsCount ?? 0);
    setGuardCode("");
    setError(null);
    setCompanionsDraft((current.companions || []).map((x) => ({ name: x.name, dni: x.dni || "" })));
    setExtrasOpen((current.minorsCount ?? 0) > 0 || (current.companions?.length ?? 0) > 0);
    setInsCompany(current.insurance?.company || "");
    setInsPolicy(current.insurance?.policyNumber || "");
    setInsUntil(isoDay(current.insurance?.validUntil));
    setArtUntil(isoDay(current.personInsurance?.validUntil));
    setArtCompany(current.personInsurance?.company || "");
    setLicUntil(isoDay(current.license?.validUntil));
    setLicNumber(current.license?.licenseNumber || (current.guestDni || "").replace(/\D/g, ""));
    setVehDoc(null);
    setArtDoc(null);
    setLicDoc(null);
  }, [current?.id, current?.sentido, current?.reentry]);

  useEffect(() => {
    if (licTouched) return;
    setLicNumber(guestDni.replace(/\D/g, ""));
  }, [guestDni, licTouched]);

  const historyDni = guestDni.replace(/\D/g, "");
  const historyPassId = current && !exitMode ? current.passId : null;
  useEffect(() => {
    if (!historyPassId || historyDni.length < 7 || !tenantId) return;
    let alive = true;
    api<IdentityHistory>(
      withTenant(`/api/visitors/search-identity?dni=${historyDni}&excludePassId=${encodeURIComponent(historyPassId)}`, tenantId),
    )
      .then((d) => {
        if (alive) setHistory(d);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [historyDni, historyPassId, tenantId]);

  function fichaPayload(): Record<string, unknown> {
    if (!current || exitMode) return {};
    const out: Record<string, unknown> = {
      guestDni,
      guestName,
      minorsCount: minorsAllowed(visitKind) ? minorsDraft : 0,
      companions: companionsDraft.filter((x) => x.name.trim()),
    };
    out.visitKind = visitKind;
    out.arrivalMode = arrivalMode;
    if (arrivalMode === "vehiculo") {
      out.patente = plate || undefined;
      if (req.insurance && (insReuse || insCompany || insPolicy || insUntil || vehDoc)) {
        out.insurance = {
          plate,
          company: insCompany,
          policyNumber: insPolicy,
          validUntil: insUntil,
          cardPhotoBase64: vehDoc?.base64 || undefined,
          reuseId: insReuse || undefined,
        };
      }
      if (req.license && (licReuse || licNumber || licUntil || licDoc)) {
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
        kind: personInsuranceKindFor(req),
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
      scrollToSection(infos[0].page, () => setExtrasOpen(true));
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

  async function decide(decision: "approved" | "denied", open = false) {
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
        body: JSON.stringify({ decision, comment, trunkChecked, open, ...fichaPayload() }),
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
        panelClassName={exitMode ? undefined : "p-0"}
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
            <div
              id="ficha-identity"
              className="scroll-mt-2 border-b border-blue-200 bg-blue-50 px-5 pb-3 pt-4 dark:border-blue-900 dark:bg-blue-950/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                    Entrada · Lote {current.lotNumber || "—"} · {current.ownerName}
                  </p>
                  <h3 id="ap-guard-ficha-title" className="mt-0.5 break-words text-2xl font-extrabold leading-tight text-slate-900 dark:text-white">
                    {guestName || current.guestName || "Sin nombre"}
                  </h3>
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                    {guestDni ? `DNI ${guestDni}` : "DNI pendiente"}
                    {guestAge != null ? ` · ${guestAge} años` : ""}
                    {dniMatch === "ok" ? (
                      <span className="ml-2 text-[11px] font-bold text-emerald-700 dark:text-emerald-400">Verificado con el plástico</span>
                    ) : dniMatch === "filled" ? (
                      <span className="ml-2 text-[11px] font-bold text-amber-800 dark:text-amber-300">Cargado desde el plástico</span>
                    ) : null}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {canDecide && !editIdentity ? (
                    <button
                      type="button"
                      onClick={() => setEditIdentity(true)}
                      className="rounded-lg p-1.5 text-slate-600 hover:bg-blue-100 dark:text-slate-300 dark:hover:bg-blue-900/50"
                      aria-label="Editar identidad"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setOpenId(null);
                      setPreview(null);
                    }}
                    className="rounded-lg p-1.5 text-slate-500 hover:bg-blue-100 dark:hover:bg-blue-900/50"
                    aria-label="Cerrar"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={!canDecide}
                  onClick={() => setTypeOpen((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-full border border-blue-300 bg-white px-2.5 py-1 text-[11px] font-bold text-blue-800 disabled:cursor-default dark:border-blue-800 dark:bg-slate-900 dark:text-blue-200"
                >
                  {visitKindLabel(visitKind)} · {arrivalModeLabel(arrivalMode)}
                  {canDecide ? <Pencil className="h-3 w-3" /> : null}
                </button>
                {canDecide ? (
                  <button
                    type="button"
                    onClick={() => setVerifyDni((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                  >
                    <QrCode className="h-3 w-3" />
                    {verifyDni ? "Ocultar lector DNI" : "Verificar DNI"}
                  </button>
                ) : null}
              </div>
              {statusLine ? (
                <p
                  className={`mt-1.5 text-[11px] font-semibold ${
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

            <div className="space-y-3 px-5 pb-4 pt-3 text-xs">
              {editIdentity ? (
                <div className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                  <label className="block">
                    Nombre y apellido
                    <input value={guestName} onChange={(e) => setGuestName(e.target.value)} className={INPUT_CLS} />
                  </label>
                  <label className="block">
                    DNI
                    <input
                      value={guestDni}
                      inputMode="numeric"
                      onChange={(e) => setGuestDni(e.target.value.replace(/\D/g, "").slice(0, 9))}
                      className={INPUT_CLS}
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        const ok = await saveFicha({ guestDni, guestName });
                        if (ok) setEditIdentity(false);
                      }}
                      className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
                    >
                      Guardar
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setGuestName(current.guestName || "");
                        setGuestDni(current.guestDni || "");
                        setEditIdentity(false);
                      }}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-[11px] font-bold dark:border-slate-600"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : null}

              {canDecide && (verifyDni || !guestDni.trim()) ? (
                <DniScanPanel
                  active={Boolean(current) && !scanOpen}
                  title="Escanear DNI (cámara o pistola)"
                  onScan={(raw) => {
                    const parsed = parseDniScan(raw);
                    if (parsed?.dni) {
                      applyParsedDni(parsed);
                      setVerifyDni(false);
                    }
                  }}
                />
              ) : null}

              {typeOpen && canDecide ? (
                <div className="space-y-3 rounded-lg border border-blue-200 p-2 dark:border-blue-900">
                  <div>
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Quién es</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {VISIT_KINDS.filter((k) => !guestMinor || minorsAllowed(k.id)).map((k) => (
                        <button
                          key={k.id}
                          type="button"
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
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const ok = await saveFicha();
                      if (ok) setTypeOpen(false);
                    }}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
                  >
                    Listo
                  </button>
                </div>
              ) : null}

              {guestMinor ? (
                <div className="flex gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-[12px] text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-bold">Menor de edad · {guestAge} años</p>
                    <p>{minorsAllowed(visitKind) ? "Solo puede ingresar como visita." : `${MINOR_KIND_TEXT}. Cambiá el tipo o denegá.`}</p>
                  </div>
                </div>
              ) : null}

              <HistoryBox history={history} />

              <RequiredDocs
                visitKind={visitKind}
                arrivalMode={arrivalMode}
                rules={rules}
                dniRead={dniMatch !== "idle" || (Boolean(current.guestDni) && !current.missing.includes("dni"))}
              />

              {expiredDocs.length ? (
                <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
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

              {canDecide && current.needsPhoneAuth ? (
                <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
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
                      className={INPUT_CLS}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy || guardCode.length < 4}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
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

              {req.vehicle ? (
                <div id="ficha-vehicle" className="scroll-mt-2 space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Vehículo</p>
                  {req.plate ? (
                    <label className="block">
                      Patente
                      <input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} className={`${INPUT_CLS} uppercase`} />
                    </label>
                  ) : null}

                  {req.insurance ? (
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
                          <input value={insCompany} onChange={(e) => setInsCompany(e.target.value)} className={INPUT_CLS} />
                        </label>
                        <label>
                          Póliza
                          <input value={insPolicy} onChange={(e) => setInsPolicy(e.target.value)} className={INPUT_CLS} />
                        </label>
                        <label className="col-span-2">
                          Vence
                          <input type="date" value={insUntil} onChange={(e) => setInsUntil(e.target.value)} className={INPUT_CLS} />
                        </label>
                        {insUntil && isPastDay(insUntil) ? (
                          <p className="col-span-2 text-[11px] font-semibold text-rose-700 dark:text-rose-300">Seguro vencido: no puede entrar con el auto.</p>
                        ) : null}
                      </div>
                    ) : null}
                    {canDecide ? (
                      <DocumentScanPanel
                        tenantId={tenantId}
                        value={vehDoc}
                        overlayOpen={docKind === "vehicle"}
                        onOverlayChange={(open) => setDocKind(open ? "vehicle" : docKind === "vehicle" ? null : docKind)}
                        onAccept={setVehDoc}
                        onClear={() => setVehDoc(null)}
                      />
                    ) : null}
                  </div>
                  ) : null}

                  {req.license ? (
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
                          <input
                            value={licNumber}
                            inputMode="numeric"
                            onChange={(e) => {
                              setLicTouched(true);
                              setLicNumber(e.target.value.replace(/\D/g, "").slice(0, 12));
                            }}
                            className={INPUT_CLS}
                          />
                        </label>
                        <label>
                          Vence
                          <input type="date" value={licUntil} onChange={(e) => setLicUntil(e.target.value)} className={INPUT_CLS} />
                        </label>
                        {licUntil && isPastDay(licUntil) ? (
                          <p className="col-span-2 text-[11px] font-semibold text-rose-700 dark:text-rose-300">Licencia vencida: no puede entrar manejando.</p>
                        ) : null}
                      </div>
                    ) : null}
                    {canDecide ? (
                      <DocumentScanPanel
                        tenantId={tenantId}
                        value={licDoc}
                        overlayOpen={docKind === "license"}
                        onOverlayChange={(open) => setDocKind(open ? "license" : docKind === "license" ? null : docKind)}
                        onAccept={setLicDoc}
                        onClear={() => setLicDoc(null)}
                      />
                    ) : null}
                  </div>
                  ) : null}

                  {req.trunk ? (
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
                  ) : null}
                </div>
              ) : null}

              {req.art ? (
                <div id="ficha-art" className="scroll-mt-2 space-y-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
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
                    <div className="grid grid-cols-2 gap-2">
                      <label>
                        Compañía
                        <input value={artCompany} onChange={(e) => setArtCompany(e.target.value)} className={INPUT_CLS} />
                      </label>
                      <label>
                        Vence
                        <input type="date" value={artUntil} onChange={(e) => setArtUntil(e.target.value)} className={INPUT_CLS} />
                      </label>
                      {artUntil && isPastDay(artUntil) ? (
                        <p className="col-span-2 text-[11px] font-semibold text-rose-700 dark:text-rose-300">{artLabel} vencida: no puede ingresar.</p>
                      ) : null}
                    </div>
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

              <div id="ficha-summary" className="scroll-mt-2 space-y-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                {canDecide ? (
                  <button
                    type="button"
                    aria-expanded={extrasOpen}
                    onClick={() => setExtrasOpen((v) => !v)}
                    className="flex w-full items-center justify-between gap-2 text-left"
                  >
                    <span>
                      <span className="block text-[11px] font-bold text-slate-800 dark:text-slate-100">
                        {minorsAllowed(visitKind) ? "Menores, acompañantes y comentario" : "Acompañantes y comentario"}
                      </span>
                      <span className="block text-[10px] text-slate-500">
                        {[
                          minorsAllowed(visitKind) && minorsDraft > 0 ? `${minorsDraft} ${minorsDraft === 1 ? "menor" : "menores"}` : null,
                          companionsDraft.length
                            ? `${companionsDraft.length} ${companionsDraft.length === 1 ? "acompañante" : "acompañantes"}`
                            : null,
                          comment.trim() ? "con comentario" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "Nada cargado"}
                      </span>
                    </span>
                    <ChevronDown
                      className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${extrasOpen ? "rotate-180" : ""}`}
                    />
                  </button>
                ) : null}

                {(!canDecide || extrasOpen) && minorsAllowed(visitKind) ? (
                <div className="flex items-center justify-between gap-2">
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
                      disabled={!canDecide}
                      aria-label="Restar menor"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 disabled:opacity-50 dark:border-slate-600 dark:text-white"
                      onClick={() => setMinorsDraft((n) => Math.max(0, n - 1))}
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="min-w-[1.5rem] text-center text-base font-bold tabular-nums text-slate-900 dark:text-white">{minorsDraft}</span>
                    <button
                      type="button"
                      disabled={!canDecide}
                      aria-label="Sumar menor"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 disabled:opacity-50 dark:border-slate-600 dark:text-white"
                      onClick={() => setMinorsDraft((n) => Math.min(20, n + 1))}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                ) : null}

                {canDecide && extrasOpen ? (
                  <>
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
                            className={INPUT_CLS}
                          />
                        </label>
                        <label className="text-[11px] font-semibold">
                          DNI
                          <input
                            value={row.dni}
                            inputMode="numeric"
                            onChange={(e) => {
                              const next = companionsDraft.slice();
                              next[i] = { ...next[i], dni: e.target.value };
                              setCompanionsDraft(next);
                            }}
                            className={INPUT_CLS}
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
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold dark:border-slate-600"
                        onClick={() => setCompanionsDraft([...companionsDraft, { name: "", dni: "" }])}
                      >
                        <Plus className="h-3 w-3" />
                        Agregar acompañante
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold dark:border-slate-600"
                        onClick={() => setCompanionScan((v) => !v)}
                      >
                        <QrCode className="h-3 w-3" />
                        {companionScan ? "Ocultar lector" : "Escanear DNI de acompañante"}
                      </button>
                    </div>
                    {companionScan ? (
                      <DniScanPanel
                        active={Boolean(current) && !scanOpen && !verifyDni && Boolean(guestDni.trim())}
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
                    ) : null}
                  </>
                ) : !canDecide && current.companions.length ? (
                  <p className="text-[11px] text-slate-600 dark:text-slate-400">
                    Acompañantes: {current.companions.map((x) => `${x.name}${x.isMinor ? " (menor)" : ""}${x.dni ? ` (${x.dni})` : ""}`).join(", ")}
                  </p>
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

                {canDecide && extrasOpen ? (
                  <label className="block">
                    Comentario
                    <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} className={INPUT_CLS} />
                  </label>
                ) : null}
              </div>

              {current.emergencies.length || current.ownerPhone ? (
                <div className="flex flex-wrap gap-2">
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

              {!canDecide ? (
                <p className="rounded-lg bg-slate-100 px-3 py-2 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  Cuando el invitado acerque el QR, esta misma ficha sirve para aprobar o denegar. El propietario con cara o QR permanente no espera.
                </p>
              ) : null}
            </div>

            {canDecide ? (
              <div className="sticky bottom-0 z-10 border-t border-slate-200 bg-white px-5 py-3 dark:border-slate-700 dark:bg-slate-900">
                {passExpired ? (
                  <p className="mb-2 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                    Pase vencido o fuera de vigencia: no se puede abrir. Solo denegar. Quedó en historial.
                  </p>
                ) : expiredDocs.length ? (
                  <p className="mb-2 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                    Documento vencido: no se puede aprobar el ingreso con el vehículo.
                  </p>
                ) : current.missing.length ? (
                  <div className="mb-2 flex flex-wrap items-center gap-1">
                    <span className="text-[11px] font-bold text-rose-700 dark:text-rose-300">Falta:</span>
                    {current.missing.map((k) => {
                      const info = missingInfo(k, current.sentido);
                      return (
                        <button
                          key={k}
                          type="button"
                          onClick={() => scrollToSection(info.page, () => setExtrasOpen(true))}
                          className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
                        >
                          {info.label.replace(/^Falta /, "")}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {error ? <p className="mb-2 text-[11px] text-rose-600 dark:text-rose-400">{error}</p> : null}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void saveFicha()}
                    className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold disabled:opacity-50 dark:border-slate-600"
                  >
                    Guardar
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void decide("denied")}
                    className="inline-flex items-center justify-center gap-1 rounded-xl bg-rose-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                    Denegar
                  </button>
                  {!req.openBarrier ? (
                    <button
                      type="button"
                      disabled={busy || !canApprove}
                      onClick={() => void decide("approved", true)}
                      title="Registra el ingreso y pulsa el relé"
                      className="inline-flex items-center justify-center gap-1 rounded-xl border border-emerald-600 px-3 py-2 text-xs font-bold text-emerald-700 disabled:opacity-50 dark:text-emerald-300"
                    >
                      <DoorOpen className="h-4 w-4" />
                      Abrir igual
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy || !canApprove}
                    onClick={() => void decide("approved")}
                    className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" />
                    {req.openBarrier ? "Aprobar y abrir" : "Registrar ingreso"}
                  </button>
                </div>
                {!req.openBarrier ? (
                  <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                    La regla de {visitKindLabel(visitKind)} · {arrivalModeLabel(arrivalMode)} registra sin abrir la barrera.
                  </p>
                ) : null}
              </div>
            ) : error ? (
              <p className="px-5 pb-4 text-[11px] text-rose-600 dark:text-rose-400">{error}</p>
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
