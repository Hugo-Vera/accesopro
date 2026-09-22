"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, Check, Phone, Plus, Trash2, X } from "lucide-react";
import { api, apiUrl, withTenant } from "@/lib/api";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { LiveVisitHoldToast, type VisitHoldAlert } from "@/components/ops/LiveVisitHoldToast";

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
  missing: string[];
  companions: { name: string; dni: string | null; isMinor?: boolean }[];
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
          sentido: p.sentido === "out" ? "out" : "in",
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
  useEscapeKey(() => {
    setOpenId(null);
    setPreview(null);
  }, Boolean(current));

  useEffect(() => {
    if (!current) return;
    setComment("");
    setTrunkChecked(false);
    setGuestDni(current.guestDni || "");
    setPlate(current.patente || "");
    setGoodsDesc(current.goodsDescription || "");
    setExitMinors(String(current.minorsIn ?? ""));
    setGuardCode("");
    setError(null);
    setCompanionsDraft((current.companions || []).map((x) => ({ name: x.name, dni: x.dni || "" })));
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
          companions: companionsDraft.filter((x) => x.name.trim()),
          insurance:
            current.needsTrunk && insCompany && insPolicy
              ? { plate, company: insCompany, policyNumber: insPolicy, validUntil: insUntil }
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
          className="fixed right-4 top-20 z-40 inline-flex max-w-[min(280px,calc(100vw-2rem))] items-center gap-2 rounded-full bg-amber-500 px-3 py-2 text-xs font-bold text-white shadow-lg"
        >
          <Bell className="h-4 w-4 shrink-0" />
          <span className="truncate">
            {items[0].guestName}
            {items.length === 1 ? " · 1 aprobación" : ` · ${items.length} aprobaciones`}
          </span>
        </button>
      ) : null}

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

      {current ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => { setOpenId(null); setPreview(null); }}>
          <div
            className="w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                  {current.sentido === "out" ? "Salida" : "Entrada"} · Lote {current.lotNumber || "—"}
                </p>
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">{current.guestName}</h3>
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
                    : "Identificado en el lector. El QR no abre: completá y aprobá."}
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
                  <p className="mt-0.5 text-[11px] text-slate-500">Preautorizado por el titular. El lector solo identificó el pase.</p>
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

            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="col-span-2">
                DNI
                <input value={guestDni} onChange={(e) => setGuestDni(e.target.value)} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              </label>
              {current.needsTrunk ? (
                <>
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
                </>
              ) : null}
              <label className="col-span-2">
                Comentario
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
              </label>
            </div>

            {canDecide ? (
              <div className="mt-3 space-y-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
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
              </div>
            ) : current.companions.length ? (
              <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-400">
                Acompañantes: {current.companions.map((x) => `${x.name}${x.isMinor ? " (menor)" : ""}${x.dni ? ` (${x.dni})` : ""}`).join(", ")}
              </p>
            ) : null}

            {current.sentido === "out" && canDecide ? (
              <div className="mt-3 space-y-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Egreso</p>
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
                <label className="block text-[11px] font-semibold">
                  Menores que salen
                  <input
                    value={exitMinors}
                    onChange={(e) => setExitMinors(e.target.value)}
                    className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </label>
                {Number(exitMinors) > (current.minorsIn ?? 0) ? (
                  <>
                    <label className="block text-[11px] font-semibold">
                      Lote de procedencia del menor
                      <select
                        value={originLot}
                        onChange={(e) => setOriginLot(e.target.value)}
                        className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      >
                        <option value="">Elegí el lote</option>
                        {lots.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.lotNumber}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={busy || !originLot}
                      className="rounded-lg bg-slate-900 px-2 py-1 text-[11px] font-bold text-white dark:bg-white dark:text-slate-900 disabled:opacity-50"
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await api(withTenant(`/api/visitors/approvals/${current.id}/minors`, tenantId), {
                            method: "POST",
                            body: JSON.stringify({
                              originPropertyId: originLot,
                              exitMinorsCount: Number(exitMinors),
                              exitAdultsCount: current.adultsIn,
                            }),
                          });
                          load();
                        } catch (err) {
                          setError(err instanceof Error ? err.message : "No se pudo pedir autorización");
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Pedir autorización de traslado
                    </button>
                    {current.minorTransferAuthorized ? (
                      <p className="text-[11px] text-emerald-700">El lote de procedencia autorizó el traslado.</p>
                    ) : null}
                  </>
                ) : null}
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
            ) : (
              <div className="mt-4 flex gap-2">
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
          </div>
        </div>
      ) : null}
    </>
  );
}
