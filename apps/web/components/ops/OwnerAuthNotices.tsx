"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Ticket, UserRound } from "lucide-react";
import { api, withTenant } from "@/lib/api";

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

function statusTone(status: string) {
  if (status === "revoked" || status === "expired") return "danger";
  if (status === "completed" || status === "in_site") return "ok";
  if (status === "pending" || status === "active") return "new";
  return "muted";
}

function statusLabel(p: OwnerPassNotice) {
  if (p.scannedOutAt || p.status === "completed") return "Cerrado";
  if (p.status === "in_site") return "En predio";
  if (p.status === "revoked") return "Revocado";
  if (p.status === "expired") return "Vencido";
  if (p.status === "pending" || p.status === "active") return "Pendiente";
  return p.status;
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
          <p className="truncate text-[12px] font-bold leading-tight text-slate-900 dark:text-white">
            {p.guestName}
          </p>
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
            <p className="mt-0.5 text-[9.5px] text-slate-500">Ingreso {timeLabel(p.scannedInAt)}</p>
          ) : null}
          {stay ? (
            <p className="mt-0.5 text-[9.5px] font-semibold text-slate-600 dark:text-slate-300">
              Permanencia {stay}
            </p>
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

type Tab = "pending" | "closed";

type Props = {
  tenantId: string | null;
  enabled: boolean;
};

export function OwnerAuthNotices({ tenantId, enabled }: Props) {
  const [pending, setPending] = useState<OwnerPassNotice[]>([]);
  const [closed, setClosed] = useState<OwnerPassNotice[]>([]);
  const [tab, setTab] = useState<Tab>("pending");
  const [error, setError] = useState<string | null>(null);

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
          if (d.pending || d.closed) {
            setPending(d.pending ?? []);
            setClosed(d.closed ?? []);
          } else {
            const list = d.passes ?? [];
            setPending(list.filter((p) => p.bucket !== "closed"));
            setClosed(list.filter((p) => p.bucket === "closed"));
          }
          setError(null);
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
    };
  }, [tenantId, enabled]);

  if (!enabled) {
    return (
      <aside className="ops-auth-rail ops-subpanel">
        <p className="ops-section-title">AUTORIZACIONES</p>
        <p className="mt-3 text-[11px] text-slate-500">Módulo visitas no contratado</p>
      </aside>
    );
  }

  const list = tab === "pending" ? pending : closed;

  return (
    <aside className="ops-auth-rail ops-subpanel flex min-h-0 flex-col" aria-label="Autorizaciones de propietarios">
      <div className="mb-1.5 flex flex-shrink-0 items-center justify-between border-b border-slate-200 pb-1.5 dark:border-[#172d3e]">
        <p className="ops-section-title">AUTORIZACIONES</p>
        <Link
          href="/dashboard/visitas"
          className="font-mono text-[9px] font-bold text-blue-600 hover:text-blue-700 dark:text-[#38bdf8]"
        >
          VER →
        </Link>
      </div>

      <div className="ops-auth-tabs mb-2 flex flex-shrink-0 gap-1">
        <button
          type="button"
          className={`ops-auth-tab ${tab === "pending" ? "active" : ""}`}
          onClick={() => setTab("pending")}
        >
          Pendientes
          <span className="ops-auth-tab-count">{pending.length}</span>
        </button>
        <button
          type="button"
          className={`ops-auth-tab ${tab === "closed" ? "active" : ""}`}
          onClick={() => setTab("closed")}
        >
          Cerradas
          <span className="ops-auth-tab-count">{closed.length}</span>
        </button>
      </div>

      <p className="mb-1.5 flex-shrink-0 text-[10px] leading-snug text-slate-500 dark:text-[#6b8498]">
        {tab === "pending"
          ? "De todos los propietarios · vigentes / en predio"
          : "Vencidas, revocadas o con egreso"}
      </p>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain ops-scroll-hidden">
        {error ? <p className="text-[11px] text-rose-600">{error}</p> : null}
        {!error && list.length === 0 ? (
          <div className="py-6 text-center text-slate-400">
            <Ticket className="mx-auto mb-1 h-6 w-6 opacity-40" />
            <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              {tab === "pending" ? "Sin pendientes" : "Sin cerradas recientes"}
            </p>
            <p className="mt-0.5 text-[9.5px] opacity-75">
              {tab === "pending"
                ? "Cuando un vecino autorice, aparece acá"
                : "Acá van vencidas, revocadas y egresos"}
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
