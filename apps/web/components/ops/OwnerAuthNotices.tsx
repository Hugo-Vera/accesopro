"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Ticket, UserRound, X } from "lucide-react";
import { api, withTenant } from "@/lib/api";
import { useEscapeKey } from "@/hooks/useEscapeKey";

export type OwnerPassNotice = {
  id: string;
  source?: "pass" | "auth";
  guestName: string;
  guestDni: string | null;
  patente: string | null;
  status: string;
  bucket?: "pending" | "closed";
  validFrom: string | number;
  validUntil: string | number;
  createdAt: string | number;
  scannedInAt: string | number | null;
  scannedOutAt: string | number | null;
  stayMs?: number | null;
  dahuaSynced: boolean;
  lot: string;
  ownerName: string;
  kind?: string;
};

function formatStay(ms: number | null | undefined) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "menos de 1 min";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

function stayFromRange(inAt: string | number | null | undefined, outAt: string | number | null | undefined) {
  if (inAt == null || outAt == null) return null;
  const a = new Date(inAt).getTime();
  const b = new Date(outAt).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  return b - a;
}

function timeLabel(v: string | number | undefined) {
  if (!v) return "—";
  return new Date(v).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ts(v: string | number | null | undefined) {
  if (v == null || v === "") return NaN;
  const n = new Date(v).getTime();
  return Number.isFinite(n) ? n : NaN;
}

function ago(v: string | number | undefined) {
  const n = ts(v);
  if (!Number.isFinite(n)) return "";
  const d = Date.now() - n;
  if (d < 45_000) return "ahora";
  if (d < 3_600_000) return `hace ${Math.max(1, Math.round(d / 60_000))} min`;
  return timeLabel(v);
}

function overlapsToday(p: OwnerPassNotice) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const from = ts(p.validFrom) || 0;
  const until = ts(p.validUntil);
  const untilMs = Number.isFinite(until) ? until : end.getTime();
  return from <= end.getTime() && untilMs >= start.getTime();
}

/** Personal permanente / servicios: no ensucian la barra de portería. */
function isStandingAuth(p: OwnerPassNotice) {
  if (p.source !== "auth") return false;
  const kind = (p.kind || "").toLowerCase();
  if (/visita|invit/.test(kind)) return false;
  if (/emplead|jardin|pileter|cuidador|servicio|domést|domest/.test(kind)) return true;
  const from = ts(p.validFrom);
  const until = ts(p.validUntil);
  if (Number.isFinite(from) && Number.isFinite(until) && until - from > 48 * 3600 * 1000) return true;
  return Boolean(kind) && kind !== "visita";
}

function lotShort(lot: string) {
  return lot.replace(/^Lote\s+/i, "L");
}

function statusTone(status: string) {
  if (status === "revoked" || status === "expired") return "danger";
  if (status === "completed" || status === "in_site") return "ok";
  if (status === "pending" || status === "active") return "new";
  return "muted";
}

function statusLabel(p: OwnerPassNotice) {
  if (p.scannedOutAt || p.status === "completed") return "Cerrado";
  if (p.status === "in_site") return "En predio";
  if (p.status === "temp_out") return "Salió, vuelve";
  if (p.status === "revoked") return "Revocado";
  if (p.status === "expired") return "Vencido";
  if (p.status === "pending" || p.status === "active") return "Esperando";
  return p.status;
}

function LiveDwell({ inAt }: { inAt: string | number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);
  const start = new Date(inAt).getTime();
  if (!Number.isFinite(start)) return null;
  const label = formatStay(now - start);
  if (!label) return null;
  return <p className="mt-0.5 text-[9.5px] font-semibold text-sky-700 dark:text-sky-300">En predio {label}</p>;
}

function NoticeCard({ p }: { p: OwnerPassNotice }) {
  const tone = statusTone(p.status);
  const stay = formatStay(p.stayMs ?? stayFromRange(p.scannedInAt, p.scannedOutAt));
  return (
    <article className={`ops-auth-card ops-auth-card--${tone}`}>
      <div className="flex items-start gap-1.5">
        <span className="mt-0.5 grid h-6 w-6 flex-shrink-0 place-items-center rounded bg-slate-100 dark:bg-[#122536]">
          <UserRound className="h-3.5 w-3.5 text-slate-500 dark:text-[#8fa6b8]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-bold leading-tight text-slate-900 dark:text-white">{p.guestName}</p>
          <p className="mt-0.5 truncate text-[10px] text-slate-600 dark:text-slate-400">
            {p.lot} · {p.ownerName}
            {p.kind ? ` · ${p.kind}` : null}
          </p>
          {p.patente || p.guestDni ? (
            <p className="mt-0.5 truncate font-mono text-[9.5px] text-slate-500">
              {[p.patente, p.guestDni ? `DNI ${p.guestDni}` : null].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          {p.scannedInAt && !p.scannedOutAt ? (
            <>
              <p className="mt-0.5 text-[9.5px] text-slate-500">Ingreso {timeLabel(p.scannedInAt)}</p>
              <LiveDwell inAt={p.scannedInAt} />
            </>
          ) : null}
          {stay ? (
            <p className="mt-0.5 text-[9.5px] font-semibold text-slate-600 dark:text-slate-300">Permanencia {stay}</p>
          ) : null}
          <div className="mt-1 flex items-center justify-between gap-1">
            <span className={`ops-auth-pill ops-auth-pill--${tone}`}>{statusLabel(p)}</span>
            <span className="font-mono text-[9px] text-slate-400">{timeLabel(p.createdAt)}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

function AuthChip({ p }: { p: OwnerPassNotice }) {
  const onsite = p.status === "in_site";
  return (
    <span className={`ops-auth-chip ${onsite ? "ops-auth-chip--site" : "ops-auth-chip--wait"}`}>
      <span className="truncate font-semibold">{p.guestName}</span>
      <span className="truncate opacity-70">{lotShort(p.lot)}</span>
    </span>
  );
}

type Tab = "pending" | "closed";
type DrawerTab = "waiting" | "onsite" | "closed";

type Props = {
  tenantId: string | null;
  enabled: boolean;
  layout?: "rail" | "strip";
};

export function OwnerAuthNotices({ tenantId, enabled, layout = "rail" }: Props) {
  const [pending, setPending] = useState<OwnerPassNotice[]>([]);
  const [closed, setClosed] = useState<OwnerPassNotice[]>([]);
  const [tab, setTab] = useState<Tab>("pending");
  const [drawer, setDrawer] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("waiting");
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const seenRef = useRef<Set<string> | null>(null);
  const freshTimer = useRef<number>(0);

  useEscapeKey(() => setDrawer(false), drawer);

  useEffect(() => {
    if (!tenantId || !enabled) {
      setPending([]);
      setClosed([]);
      return;
    }
    let cancelled = false;
    const load = () => {
      api<{ pending?: OwnerPassNotice[]; closed?: OwnerPassNotice[]; passes?: OwnerPassNotice[] }>(
        withTenant("/api/visitors/owner-passes?limit=60", tenantId),
      )
        .then((d) => {
          if (cancelled) return;
          let nextPending: OwnerPassNotice[];
          let nextClosed: OwnerPassNotice[];
          if (d.pending || d.closed) {
            nextPending = d.pending ?? [];
            nextClosed = d.closed ?? [];
          } else {
            const list = d.passes ?? [];
            nextPending = list.filter((p) => p.bucket !== "closed");
            nextClosed = list.filter((p) => p.bucket === "closed");
          }
          setPending(nextPending);
          setClosed(nextClosed);
          setError(null);
          const ids = new Set(nextPending.map((p) => p.id));
          if (seenRef.current) {
            const isNew = nextPending.some(
              (p) => !seenRef.current!.has(p.id) && Date.now() - ts(p.createdAt) < 180_000,
            );
            if (isNew) {
              setFresh(true);
              window.clearTimeout(freshTimer.current);
              freshTimer.current = window.setTimeout(() => setFresh(false), 8000);
            }
          }
          seenRef.current = ids;
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Sin autorizaciones");
        });
    };
    load();
    const id = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.clearTimeout(freshTimer.current);
    };
  }, [tenantId, enabled]);

  const waiting = useMemo(
    () => pending.filter((p) => p.status !== "in_site" && overlapsToday(p) && !isStandingAuth(p)),
    [pending],
  );
  const onsite = useMemo(() => pending.filter((p) => p.status === "in_site"), [pending]);
  const chips = useMemo(() => [...waiting, ...onsite].slice(0, 3), [waiting, onsite]);
  const extra = Math.max(0, waiting.length + onsite.length - chips.length);
  const newest = waiting[0] ?? onsite[0] ?? null;

  const list = tab === "pending" ? pending : closed;
  const strip = layout === "strip";
  const drawerList = drawerTab === "waiting" ? waiting : drawerTab === "onsite" ? onsite : closed;

  function openDrawer(next?: DrawerTab) {
    setDrawerTab(next ?? "waiting");
    setDrawer(true);
  }

  if (!enabled) {
    return (
      <aside className={strip ? "ops-auth-strip ops-auth-strip--idle" : "ops-auth-rail ops-subpanel"}>
        <p className="ops-section-title">AUTORIZACIONES</p>
        <p className="mt-1 text-[11px] text-slate-500">Módulo visitas no contratado</p>
      </aside>
    );
  }

  if (strip) {
    const tone = waiting.length ? "wait" : onsite.length ? "site" : "idle";
    return (
      <>
        <aside
          className={`ops-auth-strip ops-auth-strip--${tone}${fresh ? " ops-auth-strip--fresh" : ""}`}
          aria-label="Autorizaciones de propietarios"
        >
          <button type="button" className="ops-auth-bar" onClick={() => openDrawer()}>
            <Ticket className="h-3.5 w-3.5 shrink-0 opacity-70" />
            <span className="ops-section-title">AUTORIZACIONES</span>
            {waiting.length || onsite.length ? (
              <span className="ops-auth-bar-counts">
                {waiting.length ? <span>{waiting.length} esperando</span> : null}
                {waiting.length && onsite.length ? <span aria-hidden>·</span> : null}
                {onsite.length ? <span>{onsite.length} en predio</span> : null}
                {newest ? <span className="opacity-70">{ago(newest.createdAt)}</span> : null}
              </span>
            ) : (
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Sin visitas esperando hoy</span>
            )}
            <span className="ops-auth-chips">
              {chips.map((p) => (
                <AuthChip key={p.id} p={p} />
              ))}
              {extra > 0 ? <span className="ops-auth-chip ops-auth-chip--more">+{extra}</span> : null}
            </span>
            <span className="ops-auth-bar-action">Ver lista</span>
          </button>
        </aside>
        {drawer ? (
          <div
            className="fixed inset-0 z-[2000] flex items-end justify-center bg-black/50 p-3 sm:items-center"
            onClick={() => setDrawer(false)}
          >
            <div
              className="flex max-h-[min(80vh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
              onClick={(ev) => ev.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">Autorizaciones de hoy</h3>
                  <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    Visitas que un vecino autorizó para hoy, o que ya están adentro. El personal permanente queda en Visitas.
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={() => setDrawer(false)}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex gap-1 border-b border-slate-200 px-4 py-2 dark:border-slate-700">
                <button
                  type="button"
                  className={`ops-auth-tab ${drawerTab === "waiting" ? "active" : ""}`}
                  onClick={() => setDrawerTab("waiting")}
                >
                  Esperando
                  <span className="ops-auth-tab-count">{waiting.length}</span>
                </button>
                <button
                  type="button"
                  className={`ops-auth-tab ${drawerTab === "onsite" ? "active" : ""}`}
                  onClick={() => setDrawerTab("onsite")}
                >
                  En predio
                  <span className="ops-auth-tab-count">{onsite.length}</span>
                </button>
                <button
                  type="button"
                  className={`ops-auth-tab ${drawerTab === "closed" ? "active" : ""}`}
                  onClick={() => setDrawerTab("closed")}
                >
                  Cerradas
                  <span className="ops-auth-tab-count">{closed.length}</span>
                </button>
              </div>
              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4 py-3">
                {error ? <p className="text-[11px] text-rose-600">{error}</p> : null}
                {!error && drawerList.length === 0 ? (
                  <p className="py-6 text-center text-[12px] text-slate-500">
                    {drawerTab === "waiting"
                      ? "Nadie esperando ingreso ahora."
                      : drawerTab === "onsite"
                        ? "Nadie en predio con pase de visita."
                        : "Sin cierres recientes."}
                  </p>
                ) : null}
                {drawerList.map((p) => (
                  <NoticeCard key={p.id} p={p} />
                ))}
              </div>
              <div className="flex justify-end border-t border-slate-200 px-4 py-2 dark:border-slate-700">
                <Link
                  href="/dashboard/visitas"
                  className="text-[11px] font-semibold text-sky-700 hover:underline dark:text-sky-300"
                >
                  Abrir Visitas
                </Link>
              </div>
            </div>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <aside className="ops-auth-rail ops-subpanel flex min-h-0 flex-col" aria-label="Autorizaciones de propietarios">
      <div className="mb-1.5 flex flex-shrink-0 items-center justify-between border-b border-slate-200 pb-1.5 dark:border-[#172d3e]">
        <p className="ops-section-title">AUTORIZACIONES</p>
        <Link href="/dashboard/visitas" className="font-mono text-[9px] font-bold text-blue-600 hover:text-blue-700 dark:text-[#38bdf8]">
          VER →
        </Link>
      </div>
      <div className="ops-auth-tabs mb-2 flex flex-shrink-0 gap-1">
        <button type="button" className={`ops-auth-tab ${tab === "pending" ? "active" : ""}`} onClick={() => setTab("pending")}>
          Pendientes
          <span className="ops-auth-tab-count">{pending.length}</span>
        </button>
        <button type="button" className={`ops-auth-tab ${tab === "closed" ? "active" : ""}`} onClick={() => setTab("closed")}>
          Cerradas
          <span className="ops-auth-tab-count">{closed.length}</span>
        </button>
      </div>
      <p className="mb-1.5 flex-shrink-0 text-[10px] leading-snug text-slate-500 dark:text-[#6b8498]">
        {tab === "pending" ? "De todos los propietarios · vigentes / en predio" : "Vencidas, revocadas o con egreso"}
      </p>
      <div className="ops-scroll-hidden min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain">
        {error ? <p className="text-[11px] text-rose-600">{error}</p> : null}
        {!error && list.length === 0 ? (
          <div className="py-4 text-center text-slate-400">
            <Ticket className="mx-auto mb-1 h-6 w-6 opacity-40" />
            <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              {tab === "pending" ? "Sin pendientes" : "Sin cerradas recientes"}
            </p>
            <p className="mt-0.5 text-[9.5px] opacity-75">
              {tab === "pending" ? "Cuando un vecino autorice, aparece acá" : "Acá van vencidas, revocadas y egresos"}
            </p>
          </div>
        ) : null}
        {list.map((p) => (
          <NoticeCard key={p.id} p={p} />
        ))}
      </div>
    </aside>
  );
}
