"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Baby, Camera, Check, DoorOpen, LogIn, LogOut, Minus, PackageSearch, Phone, Plus, X } from "lucide-react";
import { api, withTenant } from "@/lib/api";
import { Modal } from "@/components/ui/Modal";
import {
  TrunkEditor,
  TrunkSavedCard,
  trunkDraftDirty,
  trunkPhotoSrc,
  type TrunkDraft,
} from "@/components/ops/TrunkInspection";
import { expiredLabel, fileToJpegDataUrl } from "@/lib/visitDocs";
import type { GuardApprovalItem } from "@/components/ops/GuardApprovalQueue";

type Props = {
  item: GuardApprovalItem;
  tenantId: string;
  canDecide: boolean;
  onClose: () => void;
  onDone: () => void;
  onReload: () => void;
  onZoom: (photos: string[], index: number) => void;
  /** Avisa al padre que hay un modal propio abierto (la pila de Escape la maneja ese modal). */
  onOverlayChange: (open: boolean) => void;
};

function fmtDateTime(v: string | number | null | undefined) {
  if (v == null) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function enteredLabel(v: string | number | null | undefined) {
  if (v == null) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const mins = Math.max(0, Math.floor((Date.now() - d.getTime()) / 60_000));
  const hhmm = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  const ago = mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
  return `entró ${hhmm} (hace ${ago})`;
}

function Counter({ value, onChange, max = 20 }: { value: number; onChange: (n: number) => void; max?: number }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label="Restar"
        onClick={() => onChange(Math.max(0, value - 1))}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 dark:border-slate-600 dark:text-white"
      >
        <Minus className="h-4 w-4" />
      </button>
      <span className="min-w-[2rem] text-center text-lg font-bold tabular-nums text-slate-900 dark:text-white">{value}</span>
      <button
        type="button"
        aria-label="Sumar"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 dark:border-slate-600 dark:text-white"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">{children}</p>;
}

/** Salida y reingreso en una sola pantalla: lo que ya se cargó al entrar es solo lectura. */
export function ExitFicha({ item, tenantId, canDecide, onClose, onDone, onReload, onZoom, onOverlayChange }: Props) {
  const reentry = Boolean(item.reentry) && item.sentido !== "out";
  const crossing = reentry ? "out_temp" : "in";
  const guestHere = (item.guestPresence || "in") === crossing;
  const compsHere = useMemo(
    () => (item.companions || []).filter((c) => (c.presence || "in") === crossing && c.id),
    [item.companions, crossing],
  );
  const insideNow =
    ((item.guestPresence || "in") === "in" ? 1 : 0) + (item.companions || []).filter((c) => (c.presence || "in") === "in").length;
  const tempOutNow =
    ((item.guestPresence || "in") === "out_temp" ? 1 : 0) +
    (item.companions || []).filter((c) => c.presence === "out_temp").length;
  const minorsInside = item.minorsInCount ?? 0;
  const minorsDefault = reentry ? item.minorsOutTemp ?? 0 : item.minorsCount ?? minorsInside;
  const needsVehicle = item.arrivalMode === "vehiculo";
  const arrivedByCar = needsVehicle;
  const checksTrunk = item.rule ? item.rule.items.baul : Boolean(item.needsTrunk);
  const opensBarrier = item.rule ? item.rule.openBarrier : true;

  const [guest, setGuest] = useState(guestHere);
  const [compIds, setCompIds] = useState<string[]>(compsHere.map((c) => c.id as string));
  const [minors, setMinors] = useState(minorsDefault);
  const [showMinors, setShowMinors] = useState(minorsDefault > 0 || minorsInside > 0);
  const [returns, setReturns] = useState(Boolean(item.returns));
  const [vehicle, setVehicle] = useState(needsVehicle && guestHere);
  const [trunkOk, setTrunkOk] = useState(Boolean(item.trunkChecked));
  const [trunkEdit, setTrunkEdit] = useState(false);
  const [trunkDraft, setTrunkDraft] = useState<TrunkDraft>({ description: "", add: [], remove: [] });
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [goodsOpen, setGoodsOpen] = useState(false);
  const [goodsDesc, setGoodsDesc] = useState(item.goodsDescription || "");
  const [goodsPhoto, setGoodsPhoto] = useState<string | null>(null);
  const [guardCode, setGuardCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setGuest(guestHere);
    setCompIds(compsHere.map((c) => c.id as string));
    setMinors(minorsDefault);
    setShowMinors(minorsDefault > 0 || minorsInside > 0);
    setReturns(Boolean(item.returns));
    setVehicle(needsVehicle && guestHere);
    setTrunkOk(Boolean(item.trunkChecked));
    setTrunkEdit(false);
    setTrunkDraft({ description: "", add: [], remove: [] });
    setNote("");
    setNoteOpen(false);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, item.sentido, item.reentry]);

  useEffect(() => {
    onOverlayChange(goodsOpen);
  }, [goodsOpen, onOverlayChange]);

  const roundTrunk = item.trunkThisRound ? (reentry ? item.trunkIn : item.trunkOut) : null;
  const selectedCount = (guest ? 1 : 0) + compIds.length;
  const adultsRemain = !reentry && (guestHere && !guest ? true : compsHere.some((c) => !compIds.includes(c.id as string)));
  const minorsMismatch = !reentry && (minors > minorsInside || (!adultsRemain && minors !== minorsInside));
  const reentryExpired = reentry
    ? (item.expiredDocs || []).filter((k) => vehicle || (k !== "seguro_vehiculo" && k !== "licencia"))
    : [];
  const reentryTrunkReady =
    Boolean(roundTrunk && (roundTrunk.description?.trim() || roundTrunk.photoIds.length)) ||
    Boolean(trunkDraft.description.trim() || trunkDraft.add.length);

  let blockReason: string | null = null;
  if (!canDecide) blockReason = "Esperando que acerque el QR";
  else if (!selectedCount) blockReason = reentry ? "Marcá quién vuelve" : "Marcá quién sale";
  else if (reentryExpired.length) blockReason = "Documento vencido";
  else if (!reentry && vehicle && checksTrunk && !trunkOk && !trunkDraftDirty(trunkDraft, roundTrunk)) blockReason = "Falta revisar el baúl";
  else if (reentry && vehicle && checksTrunk && !reentryTrunkReady) blockReason = "Falta revisar el baúl";
  else if (!reentry && item.goodsAlert && item.goodsDenied) blockReason = "El lote rechazó el bien: sale sin él o denegá";
  else if (!reentry && item.goodsAlert && !item.goodsAuthorized) blockReason = "Esperando que el lote autorice el bien";
  else if (minorsMismatch && !item.minorsMismatchNotified) blockReason = "Avisá al lote la diferencia de menores";
  else if (!reentry && minors > minorsInside && !item.minorTransferAuthorized) blockReason = "Esperando que el lote autorice los menores";

  const notices: string[] = [];
  if (item.overstay) {
    notices.push(
      `Se pasó del horario autorizado (vencía ${fmtDateTime(item.validUntil)}). Sale en definitiva: para volver, el lote tiene que autorizarlo de nuevo.`,
    );
  }
  if (item.laneMismatch && !reentry) {
    notices.push(`Presentó el QR en el tótem de ${item.readerSentido === "out" ? "salida" : "ingreso"}. Se trata como salida porque ya había entrado.`);
  }

  function toggleComp(id: string) {
    setCompIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function saveTrunk() {
    if (!trunkDraftDirty(trunkDraft, roundTrunk)) return;
    await api(withTenant(`/api/visitors/approvals/${item.id}/trunk`, tenantId), {
      method: "POST",
      body: JSON.stringify({
        description: trunkDraft.description,
        addPhotosBase64: trunkDraft.add,
        removePhotoIds: trunkDraft.remove,
      }),
    });
    setTrunkDraft({ description: trunkDraft.description, add: [], remove: [] });
    if (!reentry) setTrunkOk(true);
  }

  async function setMode(mode: "exit" | "reentry") {
    setBusy(true);
    setError(null);
    try {
      await api(withTenant(`/api/visitors/approvals/${item.id}/mode`, tenantId), {
        method: "POST",
        body: JSON.stringify({ mode }),
      });
      onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cambiar");
    } finally {
      setBusy(false);
    }
  }

  async function notifyMinors() {
    setBusy(true);
    setError(null);
    try {
      await api(withTenant(`/api/visitors/approvals/${item.id}/minors-count`, tenantId), {
        method: "POST",
        body: JSON.stringify({ count: minors }),
      });
      await api(withTenant(`/api/visitors/approvals/${item.id}/minors-mismatch`, tenantId), { method: "POST" });
      onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo avisar al lote");
    } finally {
      setBusy(false);
    }
  }

  async function sendGoods() {
    setBusy(true);
    setError(null);
    try {
      await api(withTenant(`/api/visitors/approvals/${item.id}/goods`, tenantId), {
        method: "POST",
        body: JSON.stringify({ description: goodsDesc, photoBase64: goodsPhoto }),
      });
      setGoodsOpen(false);
      onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo alertar");
    } finally {
      setBusy(false);
    }
  }

  async function clearGoods() {
    setBusy(true);
    setError(null);
    try {
      await api(withTenant(`/api/visitors/approvals/${item.id}/goods/clear`, tenantId), { method: "POST" });
      setGoodsDesc("");
      setGoodsPhoto(null);
      onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo sacar el bien");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPhone() {
    setBusy(true);
    setError(null);
    try {
      await api(withTenant(`/api/visitors/approvals/${item.id}/phone-auth`, tenantId), {
        method: "POST",
        body: JSON.stringify({ guardCode }),
      });
      setGuardCode("");
      onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Código rechazado");
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "approved" | "denied", open = false) {
    if (!canDecide) return;
    setBusy(true);
    setError(null);
    try {
      if (decision === "approved" && ((vehicle && checksTrunk) || trunkEdit)) await saveTrunk();
      await api(withTenant(`/api/visitors/approvals/${item.id}/decide`, tenantId), {
        method: "POST",
        body: JSON.stringify({
          decision,
          comment: note,
          trunkChecked: trunkOk,
          minorsCount: minors,
          exitPeople: { guest, companionIds: compIds, vehicle },
          returns: !reentry && !item.overstay && returns,
          open,
        }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo resolver");
      onReload();
    } finally {
      setBusy(false);
    }
  }

  const entered = enteredLabel(item.scannedInAt);
  const minorsLabel = reentry ? "Menores que vuelven" : "Menores que salen";
  const goodsPending = Boolean(item.goodsAlert && !item.goodsAuthorized && !item.goodsDenied);

  const guardCodeRow = (
    <div className="flex items-end gap-2">
      <label className="block flex-1 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
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
        onClick={() => void confirmPhone()}
        className="rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
      >
        Autorizar con mi código
      </button>
    </div>
  );

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            {reentry ? "Reingreso" : "Salida"} · Lote {item.lotNumber || "—"} · {item.ownerName}
          </p>
          <h3 id="ap-guard-ficha-title" className="text-lg font-bold text-slate-900 dark:text-white">
            {item.guestName}
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {item.guestDni ? `DNI ${item.guestDni}` : "Sin DNI"}
            {entered ? ` · ${entered}` : ""}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 text-slate-500" aria-label="Cerrar">
          <X className="h-5 w-5" />
        </button>
      </div>

      {canDecide && insideNow > 0 && tempOutNow > 0 ? (
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={busy || !reentry}
            onClick={() => void setMode("exit")}
            className={`inline-flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-[11px] font-bold ${
              !reentry ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-200"
            }`}
          >
            <LogOut className="h-3.5 w-3.5" />
            Sale alguien
          </button>
          <button
            type="button"
            disabled={busy || reentry}
            onClick={() => void setMode("reentry")}
            className={`inline-flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-[11px] font-bold ${
              reentry ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-200"
            }`}
          >
            <LogIn className="h-3.5 w-3.5" />
            Vuelve alguien
          </button>
        </div>
      ) : null}

      {notices.length ? (
        <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          {notices.map((n) => (
            <p key={n} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {n}
            </p>
          ))}
        </div>
      ) : null}

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-950">
        <SectionTitle>Ingresó con</SectionTitle>
        <p className="text-slate-700 dark:text-slate-200">
          {(item.companions || []).length
            ? (item.companions || [])
                .map((c) => `${c.name}${c.dni ? ` (${c.dni})` : ""}${c.presence === "out" ? " · ya salió" : c.presence === "out_temp" ? " · salió, vuelve" : ""}`)
                .join(" · ")
            : "Sin acompañantes"}
        </p>
        <p className="mt-0.5 text-slate-600 dark:text-slate-400">
          {minorsInside ? `${minorsInside} menor${minorsInside === 1 ? "" : "es"} adentro` : "Sin menores adentro"}
          {(item.minorsOutTemp ?? 0) > 0 ? ` · ${item.minorsOutTemp} afuera (vuelven)` : ""}
          {arrivedByCar ? ` · Vehículo${item.patente ? ` · ${item.patente}` : ""}` : " · A pie"}
        </p>
      </div>

      {guestHere && compsHere.length === 0 ? null : (
        <div>
          <SectionTitle>{reentry ? "Quién vuelve" : "Quién sale"}</SectionTitle>
          <div className="space-y-1">
            {guestHere ? (
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100">
                <input type="checkbox" checked={guest} onChange={(e) => setGuest(e.target.checked)} disabled={!canDecide} />
                {item.guestName} <span className="font-normal text-slate-500">· titular del pase</span>
              </label>
            ) : null}
            {compsHere.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 font-semibold text-slate-800 dark:border-slate-700 dark:text-slate-100"
              >
                <input
                  type="checkbox"
                  checked={compIds.includes(c.id as string)}
                  onChange={() => toggleComp(c.id as string)}
                  disabled={!canDecide}
                />
                {c.name}
                {c.dni ? <span className="font-normal text-slate-500">· DNI {c.dni}</span> : null}
              </label>
            ))}
          </div>
        </div>
      )}

      {showMinors ? (
        <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-700">
          <div className="flex items-center justify-between gap-2">
            <div>
              <SectionTitle>{minorsLabel}</SectionTitle>
              <p className="text-[11px] text-slate-600 dark:text-slate-400">
                {reentry ? `Salieron ${item.minorsOutTemp ?? 0}` : `Salen ${minors} de ${minorsInside}`}
              </p>
            </div>
            <Counter value={minors} onChange={setMinors} />
          </div>
          {minorsMismatch ? (
            <div className="mt-2 space-y-1">
              <p className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                {minors > minorsInside
                  ? `Salen ${minors - minorsInside} de más.`
                  : `Quedan ${minorsInside - minors} menor${minorsInside - minors === 1 ? "" : "es"} sin un adulto de la visita.`}
              </p>
              {item.minorsMismatchNotified ? (
                <p className="text-[11px] text-amber-800 dark:text-amber-300">
                  Aviso enviado al lote.
                  {minors > minorsInside && !item.minorTransferAuthorized ? " Esperá autorización para abrir." : ""}
                  {item.minorTransferAuthorized ? " El lote autorizó." : ""}
                </p>
              ) : (
                <button
                  type="button"
                  disabled={busy || !canDecide}
                  onClick={() => void notifyMinors()}
                  className="inline-flex items-center gap-1 rounded-lg bg-amber-700 px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                >
                  Avisar al lote {item.lotNumber || ""}
                </button>
              )}
            </div>
          ) : null}
        </div>
      ) : canDecide ? (
        <button
          type="button"
          onClick={() => setShowMinors(true)}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-blue-400"
        >
          <Baby className="h-3.5 w-3.5" />
          {reentry ? "Vuelve con menores" : "Sale con menores"}
        </button>
      ) : null}

      {!reentry && !item.overstay ? (
        <div>
          <SectionTitle>¿Vuelve?</SectionTitle>
          <div className="grid grid-cols-2 gap-1.5">
            {[
              { v: false, label: "Salida definitiva" },
              { v: true, label: "Sale y vuelve" },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                disabled={!canDecide}
                onClick={() => setReturns(o.v)}
                className={`rounded-lg border px-2 py-2 text-[11px] font-bold ${
                  returns === o.v
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-200"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {returns ? (
            <p className="mt-1 text-[11px] text-slate-500">Al volver se reconoce con el mismo QR o DNI y no se piden los documentos de nuevo.</p>
          ) : null}
        </div>
      ) : null}

      {needsVehicle ? (
        <div className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
          <label className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-100">
            <input type="checkbox" checked={vehicle} onChange={(e) => setVehicle(e.target.checked)} disabled={!canDecide} />
            {reentry ? "Vuelve con el vehículo" : "Sale con el vehículo"}
            {item.patente ? <span className="font-normal text-slate-500">· {item.patente}</span> : null}
          </label>
          {vehicle && !reentry && checksTrunk ? (
            <>
              <TrunkSavedCard tenantId={tenantId} check={item.trunkIn} title="Baúl al ingreso" onZoom={onZoom} />
              <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                <input type="checkbox" checked={trunkOk} onChange={(e) => setTrunkOk(e.target.checked)} disabled={!canDecide} />
                Coincide con el ingreso
              </label>
              {trunkEdit || roundTrunk ? (
                <TrunkEditor
                  tenantId={tenantId}
                  saved={roundTrunk}
                  draft={trunkDraft}
                  onChange={setTrunkDraft}
                  onZoom={onZoom}
                  onError={setError}
                  disabled={!canDecide}
                  title="Baúl a la salida"
                />
              ) : canDecide ? (
                <button
                  type="button"
                  onClick={() => setTrunkEdit(true)}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-blue-400"
                >
                  <Camera className="h-3.5 w-3.5" />
                  Agregar foto del baúl (opcional)
                </button>
              ) : null}
            </>
          ) : null}
          {vehicle && reentry ? (
            <TrunkEditor
              tenantId={tenantId}
              saved={roundTrunk}
              draft={trunkDraft}
              onChange={setTrunkDraft}
              onZoom={onZoom}
              onError={setError}
              disabled={!canDecide}
              title="Baúl al volver a entrar"
            />
          ) : null}
          {reentryExpired.length ? (
            <p className="rounded-lg bg-rose-50 px-2 py-1.5 text-[11px] font-semibold text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
              {reentryExpired.map(expiredLabel).join(" · ")}.{" "}
              {reentryExpired.every((k) => k === "seguro_vehiculo" || k === "licencia")
                ? "No puede volver con el vehículo: destildá «Vuelve con el vehículo» para que pase a pie."
                : "No puede volver a entrar."}
            </p>
          ) : null}
        </div>
      ) : reentryExpired.length ? (
        <p className="rounded-lg bg-rose-50 px-2 py-1.5 text-[11px] font-semibold text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
          {reentryExpired.map(expiredLabel).join(" · ")}. No puede volver a entrar.
        </p>
      ) : null}

      {!reentry ? (
        <div className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
          <SectionTitle>¿Sale con algo?</SectionTitle>
          {!item.goodsAlert ? (
            canDecide ? (
              <button
                type="button"
                onClick={() => setGoodsOpen(true)}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-2 py-2 text-[11px] font-bold text-slate-800 dark:border-slate-600 dark:text-slate-100"
              >
                <PackageSearch className="h-4 w-4" />
                Lleva un bien (TV, electrodoméstico, herramienta…)
              </button>
            ) : (
              <p className="text-[11px] text-slate-500">Sin bienes declarados.</p>
            )
          ) : (
            <>
              <div className="flex items-start gap-2">
                {item.goodsPhotoUrl ? (
                  <button
                    type="button"
                    onClick={() => onZoom([trunkPhotoSrc(tenantId, item.goodsPhotoUrl as string)], 0)}
                    className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700"
                  >
                    <img src={trunkPhotoSrc(tenantId, item.goodsPhotoUrl)} alt="Foto del bien" className="h-full w-full object-cover" />
                  </button>
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800 dark:text-slate-100">{item.goodsDescription || "Bien sin descripción"}</p>
                  <p
                    className={`mt-0.5 text-[11px] font-semibold ${
                      item.goodsAuthorized
                        ? "text-emerald-700 dark:text-emerald-400"
                        : item.goodsDenied
                          ? "text-rose-700 dark:text-rose-300"
                          : "text-amber-800 dark:text-amber-300"
                    }`}
                  >
                    {item.goodsAuthorized
                      ? `Autorizó: ${item.goodsAuthorizedByName || "el lote"}`
                      : item.goodsDenied
                        ? "El lote rechazó: no puede sacarlo."
                        : item.goodsCallReady
                          ? "El lote no contesta. Llamá y confirmá con tu código de guardia."
                          : "Esperando al lote (avisado a todo el grupo familiar)."}
                  </p>
                </div>
              </div>
              {canDecide && goodsPending ? (
                <>
                  {item.ownerPhone ? (
                    <a
                      href={`tel:${item.ownerPhone}`}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 underline-offset-2 hover:underline dark:text-slate-200"
                    >
                      <Phone className="h-3.5 w-3.5" />
                      Llamar al lote
                    </a>
                  ) : null}
                  {guardCodeRow}
                </>
              ) : null}
              {canDecide && (item.goodsDenied || goodsPending) ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void clearGoods()}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-[11px] font-bold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
                >
                  Sale sin el bien
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {canDecide && item.needsPhoneAuth && !goodsPending ? (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="text-[11px] font-semibold text-amber-900 dark:text-amber-200">
            Si el titular autorizó por teléfono, confirmá con tu código de guardia.
          </p>
          {guardCodeRow}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {canDecide ? (
          <button
            type="button"
            onClick={() => setNoteOpen((v) => !v)}
            className="text-[11px] font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-blue-400"
          >
            {noteOpen ? "Quitar nota" : "Agregar nota"}
          </button>
        ) : null}
        {item.ownerPhone ? (
          <a
            href={`tel:${item.ownerPhone}`}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 underline-offset-2 hover:underline dark:text-slate-200"
          >
            <Phone className="h-3.5 w-3.5" />
            Llamar al lote
          </a>
        ) : null}
      </div>
      {noteOpen ? (
        <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
          Nota
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
        </label>
      ) : null}

      {error ? <p className="text-[11px] text-rose-600">{error}</p> : null}

      {canDecide ? (
        <div className="space-y-1">
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide("denied")}
              className="inline-flex items-center justify-center gap-1 rounded-xl border border-rose-300 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50 dark:border-rose-800 dark:text-rose-300"
            >
              <X className="h-4 w-4" />
              Denegar
            </button>
            {!opensBarrier ? (
              <button
                type="button"
                disabled={busy || Boolean(blockReason)}
                onClick={() => void decide("approved", true)}
                className="inline-flex items-center justify-center gap-1 rounded-xl border border-emerald-600 px-3 py-2 text-xs font-bold text-emerald-700 disabled:opacity-50 dark:text-emerald-300"
              >
                <DoorOpen className="h-4 w-4" />
                Abrir igual
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy || Boolean(blockReason)}
              onClick={() => void decide("approved")}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              {opensBarrier
                ? reentry
                  ? "Aprobar reingreso y abrir"
                  : "Aprobar salida y abrir"
                : reentry
                  ? "Registrar reingreso"
                  : "Registrar salida"}
            </button>
          </div>
          {blockReason ? <p className="text-right text-[11px] font-semibold text-rose-700 dark:text-rose-300">{blockReason}</p> : null}
        </div>
      ) : (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          Cuando acerque el QR o el DNI, esta ficha sirve para aprobar.
        </p>
      )}

      <Modal open={goodsOpen} onClose={() => setGoodsOpen(false)} size="sm" zClass="z-[70]">
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">Sale con un bien</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Se avisa a todo el grupo familiar del lote. La barrera queda retenida hasta que alguien autorice o confirmes con tu código de guardia.
          </p>
          <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
            Qué lleva
            <input
              value={goodsDesc}
              onChange={(e) => setGoodsDesc(e.target.value)}
              className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </label>
          <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
            Foto
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="mt-0.5 block w-full text-[11px] dark:text-slate-200"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  setGoodsPhoto(await fileToJpegDataUrl(file));
                } catch (err) {
                  setError(err instanceof Error ? err.message : "No se pudo leer la foto");
                }
              }}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setGoodsOpen(false)}
              className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold dark:border-slate-600 dark:text-white"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={busy || (!goodsDesc.trim() && !goodsPhoto)}
              onClick={() => void sendGoods()}
              className="flex-1 rounded-xl bg-amber-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              Avisar al lote
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
