"use client";

import { useEffect, useState } from "react";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";

type Cmd = {
  id: string;
  action: string;
  payload: unknown;
  status: string;
  result: unknown;
  createdAt: string | number;
};

type Act = {
  id: string;
  name: string;
  driver: string;
  engineSentido: string | null;
  dahuaChannel: number;
  triggerAlpr: boolean;
  triggerDahua: boolean;
  triggerQr: boolean;
  triggerManual: boolean;
};

type Cgi = { name: string; path: string; uso: string };
type CmdInfo = { action: string; via: string; uso: string };

type Debug = {
  agentOnline: boolean;
  agentLastSeenAt: string | number | null;
  engineOnline: boolean;
  actuators: Act[];
  dahuaCgi: Cgi[];
  comandosAccesoPro: CmdInfo[];
  commands: Cmd[];
};

export function DebugPanel() {
  const { tenantId } = useDash();
  const [data, setData] = useState<Debug | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    function load() {
      api<Debug>(withTenant("/api/debug", tenantId))
        .then(setData)
        .catch((err) => setError(err instanceof Error ? err.message : "Error"));
    }
    load();
    const id = setInterval(load, 2500);
    return () => clearInterval(id);
  }, [tenantId]);

  return (
    <div className="space-y-4">
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <span className={`badge ${data?.engineOnline ? "badge-green" : "badge-gray"}`}>
          Motor LAN {data?.engineOnline ? "en línea" : "offline"}
        </span>
        <span className={`badge ${data?.agentOnline ? "badge-green" : "badge-gray"}`}>
          Agent Dahua {data?.agentOnline ? "en línea" : "offline"}
        </span>
      </div>

      <section className="card overflow-hidden">
        <div className="card-h">Qué abre qué</div>
        <table className="w-full text-sm">
          <thead className="text-left text-muted">
            <tr>
              <th className="px-4 py-2">Actuador</th>
              <th>Driver</th>
              <th>Botón</th>
              <th>Chapa</th>
              <th>Cara</th>
              <th>QR</th>
            </tr>
          </thead>
          <tbody>
            {(data?.actuators ?? []).map((a) => (
              <tr key={a.id} className="border-t border-line">
                <td className="px-4 py-2 font-semibold">
                  {a.name}
                  {a.driver === "engine" ? ` · ${a.engineSentido?.toUpperCase()}` : ""}
                  {a.driver === "dahua" ? ` · ch${a.dahuaChannel}` : ""}
                </td>
                <td className="uppercase text-muted">{a.driver}</td>
                <td>{a.triggerManual ? "sí" : "—"}</td>
                <td>{a.triggerAlpr ? "sí" : "—"}</td>
                <td>{a.triggerDahua ? "sí" : "—"}</td>
                <td>{a.triggerQr ? "sí" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <div className="card-h -mx-4 -mt-4 mb-3">CGI Dahua (agent en la LAN)</div>
          <ul className="space-y-3 text-sm">
            {(data?.dahuaCgi ?? []).map((x) => (
              <li key={x.name}>
                <p className="font-semibold text-accent">{x.name}</p>
                <p className="font-mono text-[11px] text-muted">{x.path}</p>
                <p>{x.uso}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">Digest/Basic. Las claves no salen de la LAN ni de este listado.</p>
        </section>
        <section className="card p-4">
          <div className="card-h -mx-4 -mt-4 mb-3">Comandos AccesoPro</div>
          <ul className="space-y-3 text-sm">
            {(data?.comandosAccesoPro ?? []).map((x) => (
              <li key={x.action}>
                <p className="font-semibold text-accent">{x.action}</p>
                <p className="text-xs text-muted">{x.via}</p>
                <p>{x.uso}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="card overflow-hidden">
        <div className="card-h">Cola de comandos (vivo)</div>
        <ul className="max-h-[420px] divide-y divide-line overflow-auto text-sm">
          {(data?.commands ?? []).map((c) => (
            <li key={c.id} className="px-4 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono font-semibold">{c.action}</span>
                <span
                  className={`badge ${
                    c.status === "done" ? "badge-green" : c.status === "pending" ? "badge-blue" : "badge-gray"
                  }`}
                >
                  {c.status}
                </span>
                <span className="text-xs text-muted">{when(c.createdAt)}</span>
              </div>
              <pre className="mt-1 overflow-auto text-[11px] text-muted">{fmt(c.payload)}</pre>
              {c.result ? <pre className="overflow-auto text-[11px] text-muted">{fmt(c.result)}</pre> : null}
            </li>
          ))}
          {!data?.commands?.length ? <li className="px-4 py-3 text-muted">Todavía no hay comandos. Abrí un actuador para ver el rastro.</li> : null}
        </ul>
      </section>
    </div>
  );
}

function fmt(v: unknown) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function when(v: string | number) {
  const d = typeof v === "number" ? new Date(v) : new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit", day: "2-digit", month: "2-digit" });
}
