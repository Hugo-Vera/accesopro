"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, ScanSearch, Server, Table2 } from "lucide-react";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { METHOD_CODE_ROWS } from "@accesopro/catalog";

type Device = { id: string; name: string; host?: string; deviceType?: string };

type NodeDump = { ok: boolean; count?: number; error?: string; lines?: Record<string, string> };
type ConfigDump = { ok?: boolean; nodes?: Record<string, NodeDump>; error?: string };

type PersonRows = { ok?: boolean; count?: number; rows?: Record<string, string>[]; raw?: string; error?: string };

type RawEvent = {
  at: string;
  deviceId: string;
  source: string;
  record: Record<string, unknown>;
};
type RawEvents = { ok?: boolean; events?: RawEvent[]; error?: string };

/** Instrumento de medición del firmware del ASI: muestra lo que el equipo responde, sin mapear. */
export function AsiDiscoveryPanel() {
  const { tenantId } = useDash();
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [dump, setDump] = useState<ConfigDump | null>(null);
  const [persons, setPersons] = useState<PersonRows | null>(null);
  const [raw, setRaw] = useState<RawEvent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const t = useCallback((path: string) => withTenant(path, tenantId), [tenantId]);

  useEffect(() => {
    if (!tenantId) return;
    api<{ devices?: Device[] }>(t("/api/hardware/dahua"))
      .then((d) => {
        const list = (d.devices ?? []).filter((x) => x.deviceType !== "camera_ip");
        setDevices(list);
        setDeviceId((prev) => prev || list[0]?.id || "");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error al listar equipos"));
  }, [tenantId, t]);

  const loadRaw = useCallback(() => {
    if (!tenantId || !deviceId) return;
    api<RawEvents>(t(`/api/hardware/dahua/${deviceId}/raw-events`))
      .then((d) => setRaw(d.events ?? []))
      .catch(() => undefined);
  }, [tenantId, deviceId, t]);

  useEffect(() => {
    loadRaw();
    const id = setInterval(loadRaw, 3000);
    return () => clearInterval(id);
  }, [loadRaw]);

  async function run(kind: "dump" | "persons") {
    if (!deviceId) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === "dump") {
        setDump(await api<ConfigDump>(t(`/api/hardware/dahua/${deviceId}/config-dump`)));
      } else {
        setPersons(await api<PersonRows>(t(`/api/hardware/dahua/${deviceId}/person-rows?count=25`)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al consultar el lector");
    } finally {
      setBusy(null);
    }
  }

  const observed = useMemo(() => {
    const seen = new Map<string, number>();
    for (const ev of raw) {
      const rec = (ev.record ?? {}) as Record<string, unknown>;
      const data = (rec.data ?? rec.Data ?? {}) as Record<string, unknown>;
      const code = String(data.Method ?? rec.Method ?? "").trim();
      if (!code) continue;
      seen.set(code, (seen.get(code) ?? 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
  }, [raw]);

  return (
    <div className="space-y-4">
      <section className="card p-4">
        <div className="card-h -mx-4 -mt-4 mb-3 flex items-center gap-2">
          <ScanSearch className="h-4 w-4 text-accent" />
          Descubrimiento del lector ASI
        </div>
        <p className="mb-3 text-xs text-muted">
          Lee y muestra lo que responde el equipo, sin interpretarlo. Sirve para medir los códigos de
          método reales, la enumeración de UserType y en qué nodo vive el pass-through.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold text-muted">
            Equipo
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className="mt-1 block w-full min-w-[220px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} {d.host ? `(${d.host})` : ""}
                </option>
              ))}
              {!devices.length ? <option value="">Sin equipos de acceso</option> : null}
            </select>
          </label>
          <button
            type="button"
            onClick={() => run("dump")}
            disabled={!deviceId || busy === "dump"}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            <Server className="h-4 w-4" />
            {busy === "dump" ? "Leyendo config…" : "Volcar config"}
          </button>
          <button
            type="button"
            onClick={() => run("persons")}
            disabled={!deviceId || busy === "persons"}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Table2 className="h-4 w-4" />
            {busy === "persons" ? "Leyendo padrón…" : "Volcar padrón crudo"}
          </button>
        </div>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      </section>

      {dump?.nodes ? (
        <section className="card p-4">
          <div className="card-h -mx-4 -mt-4 mb-3">Nodos de configuración</div>
          <div className="space-y-3">
            {Object.entries(dump.nodes).map(([node, info]) => (
              <div key={node} className="rounded-lg border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold text-accent">{node}</span>
                  <span className={`badge ${info.ok ? "badge-green" : "badge-gray"}`}>
                    {info.ok ? `${info.count} claves` : "no existe"}
                  </span>
                </div>
                {info.ok && info.lines ? (
                  <pre className="mt-2 max-h-60 overflow-auto text-[11px] text-muted">
                    {Object.entries(info.lines)
                      .map(([k, v]) => `${k}=${v}`)
                      .join("\n")}
                  </pre>
                ) : (
                  <p className="mt-1 text-[11px] text-muted">{info.error}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {persons ? (
        <section className="card p-4">
          <div className="card-h -mx-4 -mt-4 mb-3">
            Padrón crudo · {persons.count ?? 0} fila(s)
          </div>
          <p className="mb-2 text-xs text-muted">
            Para medir la enumeración de UserType: cargá un invitado desde la web del propio lector y
            mirá qué número queda acá.
          </p>
          <pre className="max-h-72 overflow-auto text-[11px] text-muted">
            {(persons.rows ?? [])
              .map(
                (r, i) =>
                  `[${i}] UserID=${r.UserID ?? ""} CardNo=${r.CardNo ?? ""} CardType=${r.CardType ?? ""} UserType=${r.UserType ?? ""} UseTime=${r.UseTime ?? ""} ValidDateEnd=${r.ValidDateEnd ?? ""}`,
              )
              .join("\n") || persons.raw || persons.error || "sin datos"}
          </pre>
        </section>
      ) : null}

      <section className="card p-4">
        <div className="card-h -mx-4 -mt-4 mb-3 flex items-center justify-between">
          <span>Eventos crudos del ASI</span>
          <button type="button" onClick={loadRaw} className="text-muted hover:text-accent" title="Recargar">
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-2 text-xs text-muted">
          Pasá una credencial de cada tipo (cara, tarjeta, PIN, huella, QR) y anotá el Method que
          emite el equipo. Según el manual de integración: 0 password, 1 tarjeta, 2 y 3 combinados, 6
          huella, 15 cara. El código de QR no está documentado.
        </p>
        {observed.length ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {observed.map(([code, n]) => (
              <span key={code} className="badge badge-blue font-mono">
                Method {code} · {n} vez(ces) · {labelFor(code)}
              </span>
            ))}
          </div>
        ) : null}
        <ul className="max-h-[420px] divide-y divide-line overflow-auto text-sm">
          {raw.map((ev, i) => (
            <li key={`${ev.at}-${i}`} className="px-1 py-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono font-semibold">{ev.at}</span>
                <span className="badge badge-gray">{ev.source}</span>
              </div>
              <pre className="mt-1 overflow-auto text-[11px] text-muted">
                {JSON.stringify(ev.record, null, 2)}
              </pre>
            </li>
          ))}
          {!raw.length ? (
            <li className="px-1 py-3 text-muted">
              Sin eventos todavía. Pasá una credencial frente al lector.
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}

function labelFor(code: string) {
  const row = METHOD_CODE_ROWS.find((m) => String(m.code) === String(code));
  return row ? row.label : `desconocido (código ${code})`;
}
