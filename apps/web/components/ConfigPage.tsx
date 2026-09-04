"use client";

import { useEffect, useState } from "react";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { PageHeader } from "@/components/PageHeader";
import { EquipmentPanel } from "@/components/EquipmentPanel";

type Tab =
  | "modulos"
  | "equipos"
  | "barreras"
  | "alpr"
  | "evidencia"
  | "dni"
  | "motor"
  | "almacenamiento"
  | "operadores";

type Cfg = Record<string, unknown>;
type Led = { running?: boolean; source?: string; last_error?: string; type?: string; com_port?: string };
type Subsys = {
  alpr_in?: Led;
  alpr_out?: Led;
  qr_in?: Led;
  qr_out?: Led;
  snapshot_enabled_in?: boolean;
  snapshot_enabled_out?: boolean;
  relay?: { simulated?: boolean; port?: string; open_in?: boolean; open_out?: boolean };
};
type Op = { id: number; username: string; rol: string; lote?: string | null; activo: boolean };
type Port = { port: string; desc?: string };

const BASE_TABS: { id: Tab; label: string }[] = [
  { id: "modulos", label: "Módulos" },
];

const COUNTRIES = [
  ["AR", "Argentina"],
  ["BR", "Brasil"],
  ["UY", "Uruguay"],
  ["PY", "Paraguay"],
  ["CL", "Chile"],
  ["CO", "Colombia"],
  ["MX", "México"],
  ["VE", "Venezuela"],
  ["US", "EE.UU."],
];

export function ConfigPage() {
  const { tenantId, modules, plan, plans, features, isPlatform, toggleModule, toggleFeature, assignPlan, status, can, enabled } =
    useDash();
  const canToggleFeatures = isPlatform || can("core.config");
  const showEquipos = enabled("dahua_access");
  const TABS = showEquipos
    ? [...BASE_TABS, { id: "equipos" as const, label: "Equipos" }]
    : BASE_TABS;
  const [tab, setTab] = useState<Tab>("modulos");

  useEffect(() => {
    if (tab === "equipos" && !showEquipos) setTab("modulos");
  }, [tab, showEquipos]);
  const [cfg, setCfg] = useState<Cfg>({});
  const [sub, setSub] = useState<Subsys | null>(null);
  const [ops, setOps] = useState<Op[]>([]);
  const [ports, setPorts] = useState<Port[]>([]);
  const [camIn, setCamIn] = useState<Rtsp>(emptyRtsp());
  const [camOut, setCamOut] = useState<Rtsp>(emptyRtsp());
  const [alprSide, setAlprSide] = useState<"in" | "out">("in");
  const [dniSide, setDniSide] = useState<"in" | "out">("in");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [purgeDesde, setPurgeDesde] = useState("");
  const [purgeHasta, setPurgeHasta] = useState("");
  const [opForm, setOpForm] = useState({ id: 0, username: "", password: "", rol: "vigilador", lote: "", activo: true });
  const engineUrl = (status.engineUrl ?? "http://127.0.0.1:5051").replace(/\/$/, "");

  function engine<T>(p: string, init?: RequestInit) {
    return api<T>(withTenant(`/api/alpr/engine?p=${encodeURIComponent(p)}`, tenantId), init);
  }

  async function reload() {
    if (!tenantId) return;
    const [c, s, o, p, cin, cout] = await Promise.all([
      engine<Cfg>("/api/config"),
      engine<Subsys>("/api/subsystems"),
      engine<Op[]>("/api/auth/operadores").catch(() => [] as Op[]),
      engine<Port[]>("/api/com-ports").catch(() => [] as Port[]),
      engine<{ camera?: Partial<Rtsp> & { password?: string }; source_masked?: string }>("/api/camera-config?sentido=in").catch(
        () => ({}) as { camera?: Partial<Rtsp>; source_masked?: string },
      ),
      engine<{ camera?: Partial<Rtsp> & { password?: string }; source_masked?: string }>("/api/camera-config?sentido=out").catch(
        () => ({}) as { camera?: Partial<Rtsp>; source_masked?: string },
      ),
    ]);
    setCfg(c);
    setSub(s);
    setOps(Array.isArray(o) ? o : []);
    setPorts(Array.isArray(p) ? p : []);
    setCamIn(fromCam(cin.camera, cin.source_masked ?? str(c, "camera_source_in")));
    setCamOut(fromCam(cout.camera, cout.source_masked ?? str(c, "camera_source_out")));
  }

  useEffect(() => {
    // Motor LAN (AccesoSeguro) pausado: no se consulta desde configuración.
  }, [tenantId]);

  async function savePartial(patch: Cfg) {
    setBusy(true);
    setMsg("");
    try {
      await engine("/api/config", { method: "POST", body: JSON.stringify({ ...stripMasked(patch), persist: true }) });
      await reload();
      setMsg("Guardado.");
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  }

  async function saveAlpr() {
    setBusy(true);
    setMsg("");
    const cam = alprSide === "in" ? camIn : camOut;
    try {
      await engine(`/api/camera-config?sentido=${alprSide}`, {
        method: "POST",
        body: JSON.stringify({
          host: cam.host,
          port: Number(cam.port) || 554,
          user: cam.user,
          password: cam.pass,
          path: cam.path,
          channel: Number(cam.channel) || 1,
          persist: true,
        }),
      });
      await savePartial(pickAlpr(cfg, alprSide));
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo guardar ALPR");
      setBusy(false);
    }
  }

  async function toggleSub(subsystem: string, enable: boolean) {
    setBusy(true);
    try {
      await engine("/api/subsystems/toggle", {
        method: "POST",
        body: JSON.stringify({ subsystem, action: enable ? "start" : "stop" }),
      });
      await reload();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "No se pudo cambiar el subsistema");
    } finally {
      setBusy(false);
    }
  }

  async function testBarrier(sentido: "in" | "out", action: "open" | "close") {
    try {
      await api(withTenant(`/api/alpr/relay/${action}`, tenantId), {
        method: "POST",
        body: JSON.stringify({ sentido }),
      });
      setMsg(`Barrera ${sentido.toUpperCase()}: ${action === "open" ? "abrir" : "cerrar"} enviado.`);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Fallo el test");
    }
  }

  const alpr = alprSide === "in" ? camIn : camOut;
  function setAlprCam(next: Rtsp) {
    if (alprSide === "in") setCamIn({ ...next, full: next.pass ? buildRtsp(next) : next.full });
    else setCamOut({ ...next, full: next.pass ? buildRtsp(next) : next.full });
  }

  const outConfigured = Boolean(camOut.host) || Boolean(sub?.alpr_out?.running);
  const eviInOn = Boolean(sub?.snapshot_enabled_in ?? bool(cfg, "snapshot_enabled_in"));
  const eviOutOn = Boolean(sub?.snapshot_enabled_out ?? bool(cfg, "snapshot_enabled_out"));

  return (
    <div>
      <PageHeader
        title="Configuración"
        subtitle="Plan, módulos y equipos del barrio. Lo que no está habilitado no se muestra en el dashboard."
      />
      {msg ? <p className="mb-3 text-sm text-accent">{msg}</p> : null}

      <div className="mb-4 flex flex-wrap gap-1 border-b border-line pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`cfg-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "equipos" && showEquipos ? (
        <section className="card p-5">
          <EquipmentPanel />
        </section>
      ) : null}

      {tab === "modulos" ? (
        <section className="card p-5">
          <p className="mb-4 text-sm text-muted">
            {isPlatform
              ? "El plan define el techo. Después tildás qué módulos del plan usa este barrio."
              : "Solo se muestran los módulos incluidos en el plan contratado."}
          </p>

          {isPlatform ? (
            <div className="mb-5 rounded-md border border-line bg-ink/50 p-4">
              <p className="cfg-label mb-2">Plan del barrio</p>
              <div className="flex flex-wrap items-end gap-3">
                <select
                  className="cfg-input mt-0 max-w-md"
                  value={plan?.id ?? ""}
                  onChange={(e) => {
                    if (e.target.value) assignPlan(e.target.value).catch(() => null);
                  }}
                >
                  <option value="" disabled>
                    Elegí un plan…
                  </option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                {plan ? (
                  <p className="text-[12px] text-muted">
                    {plan.summary} · hasta {plan.limits.maxGuards} guardias · {plan.limits.maxProperties} lotes
                  </p>
                ) : (
                  <p className="text-[12px] text-warn">Sin plan — asigná uno para habilitar módulos.</p>
                )}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {plans.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`rounded-md border px-3 py-2 text-left text-[12px] ${
                      plan?.id === p.id ? "border-accent bg-accent/10" : "border-line hover:border-[#3a3a3a]"
                    }`}
                    onClick={() => assignPlan(p.id).catch(() => null)}
                  >
                    <span className="block font-medium text-[#e6e6e6]">{p.name}</span>
                    <span className="text-muted">{p.moduleKeys.join(", ") || "solo núcleo"}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : plan ? (
            <p className="mb-4 rounded-md border border-line bg-ink/40 px-3 py-2 text-sm">
              Plan: <span className="font-medium">{plan.name}</span>
              <span className="text-muted"> — {plan.summary}</span>
            </p>
          ) : null}

          <ul className="divide-y divide-line">
            {modules
              .filter((m) => isPlatform || m.enabled)
              .filter((m) => m.key !== "alpr")
              .map((m) => {
                const locked = isPlatform && !m.alwaysOn && m.inPlan === false;
                return (
                  <li
                    key={m.key}
                    className={`flex items-start justify-between gap-4 py-3 ${locked ? "opacity-45" : ""}`}
                  >
                    <div>
                      <p className="font-medium">
                        {m.name}
                        {locked ? <span className="ml-2 text-[11px] font-normal text-muted">fuera del plan</span> : null}
                      </p>
                      <p className="text-sm text-muted">{m.summary}</p>
                    </div>
                    {isPlatform ? (
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={m.enabled}
                          disabled={m.alwaysOn || locked}
                          onChange={(e) => toggleModule(m.key, e.target.checked)}
                        />
                        {m.alwaysOn ? "Siempre" : m.enabled ? "On" : "Off"}
                      </label>
                    ) : (
                      <span className="text-sm text-accent">On</span>
                    )}
                  </li>
                );
              })}
          </ul>

          {features.some((f) => f.parentOn) ? (
            <div className="mt-6 border-t border-line pt-4">
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted">
                Funciones del equipo (feature packs)
              </p>
              <p className="mb-3 text-sm text-muted">
                El admin del barrio tilda qué usa del lector (eventos, personas, QR…). Después otorga el permiso a cada
                usuario.
              </p>
              <ul className="divide-y divide-line">
                {features
                  .filter((f) => f.parentOn)
                  .map((f) => (
                    <li key={f.key} className="flex items-start justify-between gap-4 py-3">
                      <div>
                        <p className="font-medium">
                          {f.name}
                          <span className="ml-2 text-[11px] font-normal text-muted">{f.key}</span>
                        </p>
                        <p className="text-sm text-muted">{f.summary}</p>
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={f.enabled}
                          disabled={!canToggleFeatures}
                          onChange={(e) => toggleFeature(f.key, e.target.checked)}
                        />
                        {f.enabled ? "On" : "Off"}
                      </label>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "barreras" ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] text-muted">
              Activá solo lo que el predio usa. OUT vacío = no aparece en el dashboard.
            </p>
            <button type="button" className="btn-ghost" onClick={() => reload()}>
              Actualizar
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <LanePanel
              title="Ingreso · IN"
              accent="in"
              rows={[
                {
                  led: sub?.alpr_in?.running,
                  name: "ALPR patentes",
                  detail: sub?.alpr_in?.running
                    ? `Activo · ${shortSrc(sub.alpr_in.source)}`
                    : sub?.alpr_in?.last_error || "Detenido",
                  checked: !!sub?.alpr_in?.running,
                  onToggle: (v) => toggleSub("alpr_in", v),
                },
                {
                  led: sub?.qr_in?.running,
                  name: "Lector QR / DNI",
                  detail: sub?.qr_in?.running ? `Tipo: ${sub.qr_in.type}` : sub?.qr_in?.last_error || "Detenido",
                  checked: !!sub?.qr_in?.running,
                  onToggle: (v) => toggleSub("qr_in", v),
                },
                {
                  led: eviInOn,
                  name: "Cámara evidencia",
                  detail: eviInOn ? "Habilitada · se muestra en registro" : "Off · no se muestra en registro",
                  checked: eviInOn,
                  onToggle: (v) => toggleSub("snapshot_in", v),
                },
              ]}
            />
            <LanePanel
              title="Salida · OUT"
              accent="out"
              hint={!outConfigured ? "Sin cámara ALPR: el live OUT no se muestra en el dashboard." : undefined}
              rows={[
                {
                  led: sub?.alpr_out?.running,
                  name: "ALPR patentes",
                  detail: sub?.alpr_out?.running
                    ? `Activo · ${shortSrc(sub.alpr_out.source)}`
                    : outConfigured
                      ? sub?.alpr_out?.last_error || "Detenido"
                      : "Sin cámara — configurá en Cámaras ALPR",
                  checked: !!sub?.alpr_out?.running,
                  onToggle: (v) => toggleSub("alpr_out", v),
                  disabled: !outConfigured && !sub?.alpr_out?.running,
                },
                {
                  led: sub?.qr_out?.running,
                  name: "Lector QR / DNI",
                  detail: sub?.qr_out?.running ? `Tipo: ${sub.qr_out.type}` : "Detenido",
                  checked: !!sub?.qr_out?.running,
                  onToggle: (v) => toggleSub("qr_out", v),
                },
                {
                  led: eviOutOn,
                  name: "Cámara evidencia",
                  detail: eviOutOn ? "Habilitada · se muestra en registro" : "Off · no se muestra en registro",
                  checked: eviOutOn,
                  onToggle: (v) => toggleSub("snapshot_out", v),
                },
              ]}
            />
          </div>

          <section className="card">
            <div className="card-h">Barreras físicas / relé</div>
            <div className="grid gap-5 p-4 lg:grid-cols-2">
              <BarrierForm
                title="Ingreso (IN)"
                accent="in"
                cfg={cfg}
                suffix="in"
                ports={ports}
                onChange={(k, v) => setCfg({ ...cfg, [k]: v })}
                onTest={(a) => testBarrier("in", a)}
              />
              <BarrierForm
                title="Salida (OUT)"
                accent="out"
                cfg={cfg}
                suffix="out"
                ports={ports}
                onChange={(k, v) => setCfg({ ...cfg, [k]: v })}
                onTest={(a) => testBarrier("out", a)}
              />
            </div>
            <div className="flex justify-end border-t border-line p-3">
              <button type="button" disabled={busy} className="btn-primary" onClick={() => savePartial(pickBarrier(cfg))}>
                Guardar barreras
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {tab === "alpr" ? (
        <div className="space-y-4">
          {status.engineOnline === false ? (
            <p className="rounded-md border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">
              Motor ALPR offline ({engineUrl}). Levantá AccesoSeguro en el puerto 5051 para guardar cámaras.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={`cfg-tab ${alprSide === "in" ? "active" : ""}`} onClick={() => setAlprSide("in")}>
              Ingreso (IN)
            </button>
            <button type="button" className={`cfg-tab ${alprSide === "out" ? "active" : ""}`} onClick={() => setAlprSide("out")}>
              Salida (OUT)
            </button>
            {alprSide === "out" && !outConfigured ? (
              <span className="text-[12px] text-muted">Completá IP/host para habilitar el live OUT en el dashboard.</span>
            ) : null}
          </div>
          <section className="card">
            <div className="card-h">ALPR — {alprSide === "in" ? "Ingreso (IN)" : "Salida (OUT)"}</div>
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="IP / Host" value={alpr.host} onChange={(v) => setAlprCam({ ...alpr, host: v })} />
              <Field label="Puerto" value={alpr.port} onChange={(v) => setAlprCam({ ...alpr, port: v })} />
              <Field label="Usuario" value={alpr.user} onChange={(v) => setAlprCam({ ...alpr, user: v })} />
              <Field label="Contraseña" value={alpr.pass} placeholder="vacío = no cambiar" type="password" onChange={(v) => setAlprCam({ ...alpr, pass: v })} />
              <Field label="Ruta" value={alpr.path} onChange={(v) => setAlprCam({ ...alpr, path: v })} />
              <Field label="Canal" value={alpr.channel} onChange={(v) => setAlprCam({ ...alpr, channel: v })} />
              <label className="cfg-label sm:col-span-2 lg:col-span-3">
                Fuente
                <input className="cfg-input font-mono text-xs" value={alpr.full} readOnly />
              </label>
            </div>
            <div className="grid gap-3 px-4 pb-4 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={bool(cfg, alprSide === "in" ? "hud_overlay_enabled_in" : "hud_overlay_enabled_out")}
                  onChange={(e) => setCfg({ ...cfg, [alprSide === "in" ? "hud_overlay_enabled_in" : "hud_overlay_enabled_out"]: e.target.checked })}
                />
                Habilitar HUD en esta cámara
              </label>
              <label className="cfg-label">
                Posición HUD
                <select
                  className="cfg-input"
                  value={str(cfg, alprSide === "in" ? "hud_overlay_position_in" : "hud_overlay_position_out", "bottom-left")}
                  onChange={(e) => setCfg({ ...cfg, [alprSide === "in" ? "hud_overlay_position_in" : "hud_overlay_position_out"]: e.target.value })}
                >
                  <option value="center">Centro</option>
                  <option value="top-left">Superior izquierda</option>
                  <option value="top-right">Superior derecha</option>
                  <option value="bottom-left">Inferior izquierda</option>
                  <option value="bottom-right">Inferior derecha</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={bool(cfg, alprSide === "in" ? "motion_detection_enabled_in" : "motion_detection_enabled_out", true)}
                  onChange={(e) =>
                    setCfg({ ...cfg, [alprSide === "in" ? "motion_detection_enabled_in" : "motion_detection_enabled_out"]: e.target.checked })
                  }
                />
                Ahorro de CPU (movimiento)
              </label>
              <label className="cfg-label">
                Umbral de movimiento
                <select
                  className="cfg-input"
                  value={str(cfg, alprSide === "in" ? "motion_threshold_in" : "motion_threshold_out", "0.005")}
                  onChange={(e) => setCfg({ ...cfg, [alprSide === "in" ? "motion_threshold_in" : "motion_threshold_out"]: Number(e.target.value) })}
                >
                  <option value="0.002">Alta</option>
                  <option value="0.005">Recomendada</option>
                  <option value="0.01">Baja</option>
                  <option value="0.02">Muy baja</option>
                </select>
              </label>
              <Field
                label="Cooldown movimiento (seg)"
                value={str(cfg, alprSide === "in" ? "motion_cooldown_sec_in" : "motion_cooldown_sec_out", "3")}
                onChange={(v) => setCfg({ ...cfg, [alprSide === "in" ? "motion_cooldown_sec_in" : "motion_cooldown_sec_out"]: Number(v) })}
              />
            </div>
            <div className="flex justify-end border-t border-line p-3">
              <button type="button" disabled={busy} className="btn-primary" onClick={() => saveAlpr()}>
                Guardar ALPR
              </button>
            </div>
          </section>
          {alpr.host || alprSide === "in" ? (
            <section className="card p-4">
              <p className="text-sm text-muted">Live de referencia (ROI se ajusta en AccesoSeguro).</p>
              <img
                className="mt-3 w-full max-w-3xl rounded-md border border-line bg-black"
                src={`${engineUrl}/video_feed/${alprSide}`}
                alt="ROI"
              />
            </section>
          ) : null}
        </div>
      ) : null}

      {tab === "evidencia" ? (
        <div className="space-y-4">
          <p className="text-[12px] text-muted">
            Si está off, el registro de detecciones no muestra la columna Evidencia.
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            <EvidenceCard side="in" cfg={cfg} setCfg={setCfg} engineUrl={engineUrl} />
            <EvidenceCard side="out" cfg={cfg} setCfg={setCfg} engineUrl={engineUrl} />
          </div>
          <div className="flex justify-end">
            <button type="button" disabled={busy} className="btn-primary" onClick={() => savePartial(pickEvi(cfg))}>
              Guardar evidencia
            </button>
          </div>
        </div>
      ) : null}

      {tab === "dni" ? (
        <div className="space-y-4">
          <div className="flex gap-2">
            <button type="button" className={`cfg-tab ${dniSide === "in" ? "active" : ""}`} onClick={() => setDniSide("in")}>
              Ingreso (IN)
            </button>
            <button type="button" className={`cfg-tab ${dniSide === "out" ? "active" : ""}`} onClick={() => setDniSide("out")}>
              Salida (OUT)
            </button>
          </div>
          <section className="card p-4">
            <label className="cfg-label mb-4">
              Modo de lector QR
              <select
                className="cfg-input"
                value={str(cfg, dniSide === "in" ? "qr_source_type_in" : "qr_source_type_out", "com")}
                onChange={(e) => setCfg({ ...cfg, [dniSide === "in" ? "qr_source_type_in" : "qr_source_type_out"]: e.target.value })}
              >
                <option value="com">Lector de pistola (puerto COM)</option>
                <option value="disabled">Desactivado</option>
              </select>
            </label>
            <label className="cfg-label">
              Puerto COM
              <select
                className="cfg-input"
                value={str(cfg, dniSide === "in" ? "qr_com_port_in" : "qr_com_port_out")}
                onChange={(e) => setCfg({ ...cfg, [dniSide === "in" ? "qr_com_port_in" : "qr_com_port_out"]: e.target.value })}
              >
                <option value="">(sin puerto)</option>
                {ports.map((p) => (
                  <option key={p.port} value={p.port}>
                    {p.port} {p.desc ? `— ${p.desc}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-4 flex justify-end">
              <button type="button" disabled={busy} className="btn-primary" onClick={() => savePartial(pickDni(cfg))}>
                Guardar DNI
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {tab === "motor" ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card">
              <div className="card-h">Funcionamiento de autorización</div>
              <div className="space-y-3 p-4">
                <label className="cfg-label">
                  Modo de validación
                  <select className="cfg-input" value={str(cfg, "auth_mode", "combinado")} onChange={(e) => setCfg({ ...cfg, auth_mode: e.target.value })}>
                    <option value="patente">Solo patente</option>
                    <option value="dni">Solo QR DNI</option>
                    <option value="ambos">Patente + QR DNI</option>
                    <option value="combinado">Combinado (patente o QR)</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={bool(cfg, "auto_register")} onChange={(e) => setCfg({ ...cfg, auto_register: e.target.checked })} />
                  Registro automático
                </label>
              </div>
            </section>
            <section className="card">
              <div className="card-h">Rendimiento del motor de IA</div>
              <div className="grid grid-cols-2 gap-3 p-4">
                <Field label="Inferencia cada N frames" value={str(cfg, "inference_every_n", "3")} onChange={(v) => setCfg({ ...cfg, inference_every_n: Number(v) })} />
                <label className="cfg-label">
                  Dispositivo ONNX
                  <select className="cfg-input" value={str(cfg, "ocr_device", "auto")} onChange={(e) => setCfg({ ...cfg, ocr_device: e.target.value })}>
                    <option value="auto">auto</option>
                    <option value="cpu">cpu</option>
                    <option value="cuda">cuda</option>
                  </select>
                </label>
                <Field label="Conf. OCR mínima" value={str(cfg, "filter_min_ocr_conf", "0.3")} onChange={(v) => setCfg({ ...cfg, filter_min_ocr_conf: Number(v) })} />
                <Field label="Conf. detector mínima" value={str(cfg, "filter_min_detector_conf", "0.3")} onChange={(v) => setCfg({ ...cfg, filter_min_detector_conf: Number(v) })} />
                <Field label="Ventana dedup (seg)" value={str(cfg, "dedup_window_sec", "3")} onChange={(v) => setCfg({ ...cfg, dedup_window_sec: Number(v) })} />
              </div>
            </section>
          </div>
          <section className="card p-4">
            <div className="card-h -mx-4 -mt-4 mb-4">Filtro de formato de patente</div>
            <label className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={bool(cfg, "plate_filter_enabled", true)}
                onChange={(e) => setCfg({ ...cfg, plate_filter_enabled: e.target.checked })}
              />
              Activar filtro
            </label>
            <div className="flex flex-wrap gap-3">
              {COUNTRIES.map(([code, name]) => {
                const list = Array.isArray(cfg.plate_filter_countries) ? (cfg.plate_filter_countries as string[]) : ["AR"];
                const on = list.includes(code);
                return (
                  <label key={code} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => {
                        const next = e.target.checked ? [...list, code] : list.filter((x) => x !== code);
                        setCfg({ ...cfg, plate_filter_countries: next });
                      }}
                    />
                    {name}
                  </label>
                );
              })}
            </div>
          </section>
          <div className="flex justify-end">
            <button type="button" disabled={busy} className="btn-primary" onClick={() => savePartial(pickMotor(cfg))}>
              Guardar motor y lógica
            </button>
          </div>
        </div>
      ) : null}

      {tab === "almacenamiento" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card p-4">
            <div className="card-h -mx-4 -mt-4 mb-4">Retención automática</div>
            <p className="mb-4 text-xs text-muted">Días que se conservan fotos de evidencia y recortes de patente.</p>
            <Field
              label="Días de retención"
              value={str(cfg, "evidence_retention_days", "90")}
              onChange={(v) => setCfg({ ...cfg, evidence_retention_days: Number(v) })}
            />
            <button
              type="button"
              className="btn-primary mt-4 w-full"
              onClick={() =>
                engine("/api/config/evidence", {
                  method: "POST",
                  body: JSON.stringify({ evidence_retention_days: Number(cfg.evidence_retention_days) || 90 }),
                }).then(() => setMsg("Retención guardada."))
              }
            >
              Guardar retención
            </button>
          </section>
          <section className="card p-4">
            <div className="card-h -mx-4 -mt-4 mb-4 text-warn">Purga manual</div>
            <p className="mb-3 text-xs text-danger">Borra archivos de imagen en el rango. Las detecciones en la base quedan.</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="cfg-label">
                Desde
                <input className="cfg-input" type="date" value={purgeDesde} onChange={(e) => setPurgeDesde(e.target.value)} />
              </label>
              <label className="cfg-label">
                Hasta
                <input className="cfg-input" type="date" value={purgeHasta} onChange={(e) => setPurgeHasta(e.target.value)} />
              </label>
            </div>
            <button
              type="button"
              className="btn-danger mt-4 w-full py-2"
              onClick={() =>
                engine("/api/evidencia/purge-manual", {
                  method: "POST",
                  body: JSON.stringify({ desde: purgeDesde, hasta: purgeHasta }),
                }).then(() => setMsg("Purga enviada."))
              }
            >
              Purgar fotos
            </button>
          </section>
        </div>
      ) : null}

      {tab === "operadores" ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card p-4">
              <div className="card-h -mx-4 -mt-4 mb-4">Privilegios y apertura automática</div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={bool(cfg, "vigilador_manual_trigger")}
                    onChange={(e) => setCfg({ ...cfg, vigilador_manual_trigger: e.target.checked })}
                  />
                  Permitir al vigilador apertura manual de barreras
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={bool(cfg, "propietario_auth_visits")}
                    onChange={(e) => setCfg({ ...cfg, propietario_auth_visits: e.target.checked })}
                  />
                  Permitir a propietarios pre-autorizar visitas
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={bool(cfg, "barrier_auto_open_in", true)}
                    onChange={(e) => setCfg({ ...cfg, barrier_auto_open_in: e.target.checked })}
                  />
                  Apertura automática IN
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={bool(cfg, "barrier_auto_open_out", true)}
                    onChange={(e) => setCfg({ ...cfg, barrier_auto_open_out: e.target.checked })}
                  />
                  Apertura automática OUT
                </label>
              </div>
              <div className="mt-4 flex justify-end">
                <button type="button" className="btn-primary" onClick={() => savePartial(pickPerms(cfg))}>
                  Guardar privilegios
                </button>
              </div>
            </section>
            <section className="card p-4">
              <div className="card-h -mx-4 -mt-4 mb-4">{opForm.id ? "Editar usuario" : "Registrar usuario"}</div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Usuario" value={opForm.username} onChange={(v) => setOpForm({ ...opForm, username: v })} />
                <Field
                  label={opForm.id ? "Contraseña (vacío = no cambiar)" : "Contraseña"}
                  value={opForm.password}
                  type="password"
                  onChange={(v) => setOpForm({ ...opForm, password: v })}
                />
                <label className="cfg-label">
                  Rol
                  <select className="cfg-input" value={opForm.rol} onChange={(e) => setOpForm({ ...opForm, rol: e.target.value })}>
                    <option value="viewer">viewer</option>
                    <option value="vigilador">vigilador</option>
                    <option value="propietario">propietario</option>
                    <option value="supervisor">supervisor</option>
                    <option value="admin">admin</option>
                  </select>
                </label>
                <Field label="Lote (solo propietario)" value={opForm.lote} onChange={(v) => setOpForm({ ...opForm, lote: v })} />
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setOpForm({ id: 0, username: "", password: "", rol: "vigilador", lote: "", activo: true })}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={async () => {
                    try {
                      if (opForm.id) {
                        await engine(`/api/auth/operadores/${opForm.id}`, {
                          method: "PUT",
                          body: JSON.stringify({
                            username: opForm.username,
                            rol: opForm.rol,
                            lote: opForm.lote || null,
                            activo: opForm.activo,
                            ...(opForm.password ? { password: opForm.password } : {}),
                          }),
                        });
                      } else {
                        await engine("/api/auth/operadores", {
                          method: "POST",
                          body: JSON.stringify({
                            username: opForm.username,
                            password: opForm.password,
                            rol: opForm.rol,
                            lote: opForm.lote || null,
                          }),
                        });
                      }
                      setOpForm({ id: 0, username: "", password: "", rol: "vigilador", lote: "", activo: true });
                      await reload();
                      setMsg("Usuario guardado.");
                    } catch (err) {
                      setMsg(err instanceof Error ? err.message : "No se pudo guardar el usuario");
                    }
                  }}
                >
                  Guardar usuario
                </button>
              </div>
            </section>
          </div>
          <section className="card overflow-hidden">
            <div className="card-h">Listado de cuentas y operadores</div>
            <table className="w-full text-sm">
              <thead className="text-left text-muted">
                <tr>
                  <th className="px-4 py-2">Usuario</th>
                  <th>Rol</th>
                  <th>Lote</th>
                  <th>Estado</th>
                  <th className="pr-4 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {ops.map((o) => (
                  <tr key={o.id} className="border-t border-line">
                    <td className="px-4 py-2 font-semibold text-accent">{o.username}</td>
                    <td className="uppercase">{o.rol}</td>
                    <td>{o.lote || "—"}</td>
                    <td>
                      <span className={`badge ${o.activo ? "badge-green" : "badge-gray"}`}>{o.activo ? "Activa" : "Inactiva"}</span>
                    </td>
                    <td className="pr-4 text-right">
                      <button
                        type="button"
                        className="btn-ghost mr-1"
                        onClick={() => setOpForm({ id: o.id, username: o.username, password: "", rol: o.rol, lote: o.lote ?? "", activo: o.activo })}
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        onClick={async () => {
                          await engine(`/api/auth/operadores/${o.id}`, {
                            method: "PUT",
                            body: JSON.stringify({ activo: !o.activo }),
                          });
                          await reload();
                        }}
                      >
                        {o.activo ? "Desactivar" : "Activar"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function shortSrc(src?: string) {
  if (!src) return "";
  const m = src.match(/@([^/:]+)/) || src.match(/\/\/([^/:]+)/);
  return m?.[1] ?? src.slice(0, 28);
}

function LanePanel({
  title,
  accent,
  hint,
  rows,
}: {
  title: string;
  accent: "in" | "out";
  hint?: string;
  rows: { led?: boolean; name: string; detail: string; checked: boolean; onToggle: (v: boolean) => void; disabled?: boolean }[];
}) {
  return (
    <section className="lane-card">
      <div className={`lane-card-h ${accent === "in" ? "text-accent" : "text-warn"}`}>
        <span>{title}</span>
      </div>
      <div className="space-y-2 p-3">
        {hint ? <p className="text-[11px] text-muted">{hint}</p> : null}
        {rows.map((r) => (
          <SubRow
            key={r.name}
            led={r.led}
            name={r.name}
            detail={r.detail}
            checked={r.checked}
            onToggle={r.onToggle}
            disabled={r.disabled}
          />
        ))}
      </div>
    </section>
  );
}

function SubRow({
  led,
  name,
  detail,
  checked,
  onToggle,
  disabled,
}: {
  led?: boolean;
  name: string;
  detail: string;
  checked: boolean;
  onToggle: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`subsys-row ${disabled ? "opacity-55" : ""}`}>
      <span className={`subsys-led ${led ? "led-green" : "led-red"}`} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-tight">{name}</p>
        <p className="truncate text-[11px] text-muted">{detail}</p>
      </div>
      <label className={`toggle-switch ${disabled ? "pointer-events-none" : ""}`}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} />
        <span className="toggle-slider" />
      </label>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="cfg-label">
      {label}
      <input className="cfg-input" type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function BarrierForm({
  title,
  accent,
  cfg,
  suffix,
  ports,
  onChange,
  onTest,
}: {
  title: string;
  accent: "in" | "out";
  cfg: Cfg;
  suffix: string;
  ports: Port[];
  onChange: (k: string, v: unknown) => void;
  onTest: (a: "open" | "close") => void;
}) {
  const type = str(cfg, `barrier_type_${suffix}`, "simulated");
  return (
    <div className={accent === "out" ? "" : "lg:border-r lg:border-line lg:pr-5"}>
      <h4 className={`mb-3 font-semibold ${accent === "in" ? "text-accent" : "text-warn"}`}>{title}</h4>
      <label className="cfg-label mb-3">
        Modo
        <select className="cfg-input" value={type} onChange={(e) => onChange(`barrier_type_${suffix}`, e.target.value)}>
          <option value="disabled">Desactivada</option>
          <option value="simulated">Simulada</option>
          <option value="com">Puerto COM (Arduino / Serial)</option>
          <option value="ip">IP Relay Controller (TCP / HTTP)</option>
        </select>
      </label>
      {type === "com" ? (
        <div className="mb-3 grid grid-cols-2 gap-2 rounded-md bg-black/20 p-2">
          <label className="cfg-label">
            Puerto
            <select className="cfg-input" value={str(cfg, `barrier_port_${suffix}`)} onChange={(e) => onChange(`barrier_port_${suffix}`, e.target.value)}>
              <option value="">(simulado)</option>
              {ports.map((p) => (
                <option key={p.port} value={p.port}>
                  {p.port}
                </option>
              ))}
            </select>
          </label>
          <Field label="Baudios" value={str(cfg, `barrier_baudrate_${suffix}`, "9600")} onChange={(v) => onChange(`barrier_baudrate_${suffix}`, Number(v))} />
        </div>
      ) : null}
      {type === "ip" ? (
        <div className="mb-3 space-y-2 rounded-md bg-black/20 p-2">
          <div className="grid grid-cols-2 gap-2">
            <Field label="IP" value={str(cfg, `barrier_ip_${suffix}`)} onChange={(v) => onChange(`barrier_ip_${suffix}`, v)} />
            <Field label="Puerto IP" value={str(cfg, `barrier_ip_port_${suffix}`, "80")} onChange={(v) => onChange(`barrier_ip_port_${suffix}`, Number(v))} />
          </div>
          <label className="cfg-label">
            Protocolo
            <select className="cfg-input" value={str(cfg, `barrier_ip_protocol_${suffix}`, "tcp")} onChange={(e) => onChange(`barrier_ip_protocol_${suffix}`, e.target.value)}>
              <option value="tcp">TCP Socket (raw)</option>
              <option value="http">HTTP GET</option>
            </select>
          </label>
          <Field label="Comando ABRIR" value={str(cfg, `barrier_ip_cmd_open_${suffix}`)} onChange={(v) => onChange(`barrier_ip_cmd_open_${suffix}`, v)} />
          <Field label="Comando CERRAR" value={str(cfg, `barrier_ip_cmd_close_${suffix}`)} onChange={(v) => onChange(`barrier_ip_cmd_close_${suffix}`, v)} />
        </div>
      ) : null}
      <Field
        label="Cierre automático (watchdog, seg)"
        value={str(cfg, `barrier_max_open_sec_${suffix}`, "0")}
        onChange={(v) => onChange(`barrier_max_open_sec_${suffix}`, Number(v))}
      />
      <p className="mt-1 text-[11px] text-muted">0 = desactivado. Tiempo para auto-cerrar en emergencia.</p>
      <div className="mt-3 flex gap-2">
        <button type="button" className="flex-1 rounded-[10px] border border-accent px-2 py-1.5 text-sm text-accent" onClick={() => onTest("open")}>
          Test abrir
        </button>
        <button type="button" className="btn-ghost flex-1" onClick={() => onTest("close")}>
          Test cerrar
        </button>
      </div>
    </div>
  );
}

function EvidenceCard({
  side,
  cfg,
  setCfg,
  engineUrl,
}: {
  side: "in" | "out";
  cfg: Cfg;
  setCfg: (c: Cfg) => void;
  engineUrl: string;
}) {
  const key = `snapshot_camera_source_${side}`;
  const rtsp = parseRtsp(str(cfg, key));
  const enabled = bool(cfg, `snapshot_enabled_${side}`);
  return (
    <section className="card">
      <div className="card-h">Evidencia — {side === "in" ? "Ingreso" : "Salida"}</div>
      <div className="space-y-3 p-4">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setCfg({ ...cfg, [`snapshot_enabled_${side}`]: e.target.checked })}
          />
          Habilitar (mostrar en registro)
        </label>
        {enabled ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Host" value={rtsp.host} onChange={(v) => setRtsp(cfg, setCfg, side, { ...rtsp, host: v }, "snapshot")} />
              <Field label="Canal" value={rtsp.channel} onChange={(v) => setRtsp(cfg, setCfg, side, { ...rtsp, channel: v }, "snapshot")} />
            </div>
            <label className="cfg-label">
              Disparo
              <select
                className="cfg-input"
                value={str(cfg, `snapshot_trigger_${side}`, "patente")}
                onChange={(e) => setCfg({ ...cfg, [`snapshot_trigger_${side}`]: e.target.value })}
              >
                <option value="ambos">Patente o DNI</option>
                <option value="patente">Solo patente</option>
                <option value="dni">Solo DNI</option>
              </select>
            </label>
            <img className="aspect-video w-full rounded-md bg-black object-cover" src={`${engineUrl}/video_feed_evidence/${side}`} alt="" />
          </>
        ) : (
          <p className="text-[12px] text-muted">Deshabilitada: no se captura ni se muestra en el detalle de detecciones.</p>
        )}
      </div>
    </section>
  );
}

type Rtsp = { host: string; port: string; user: string; pass: string; path: string; channel: string; full: string };

function emptyRtsp(): Rtsp {
  return { host: "", port: "554", user: "", pass: "", path: "/cam/realmonitor", channel: "1", full: "" };
}

function fromCam(cam: (Partial<Rtsp> & { password?: string }) | undefined, masked: string): Rtsp {
  if (cam?.host) {
    return {
      host: String(cam.host),
      port: String(cam.port ?? 554),
      user: String(cam.user ?? ""),
      pass: "",
      path: String(cam.path ?? "/cam/realmonitor"),
      channel: String(cam.channel ?? 1),
      full: masked,
    };
  }
  return parseRtsp(masked);
}

function parseRtsp(url: string): Rtsp {
  const empty = { ...emptyRtsp(), full: url };
  if (!url || !url.startsWith("rtsp")) return { ...empty, host: url || "" };
  try {
    const u = new URL(url);
    const pass = decodeURIComponent(u.password || "");
    return {
      host: u.hostname,
      port: u.port || "554",
      user: decodeURIComponent(u.username || ""),
      pass: pass === "****" || pass === "***" ? "" : pass,
      path: u.pathname || "/cam/realmonitor",
      channel: u.searchParams.get("channel") || "1",
      full: url.replace(/:([^:@]+)@/, ":****@"),
    };
  } catch {
    return empty;
  }
}

function buildRtsp(p: Rtsp) {
  const creds = p.user ? `${p.user}${p.pass ? `:${p.pass}` : ""}@` : "";
  return `rtsp://${creds}${p.host}:${p.port || "554"}${p.path || "/cam/realmonitor"}?channel=${p.channel || "1"}&subtype=0`;
}

function setRtsp(cfg: Cfg, setCfg: (c: Cfg) => void, side: "in" | "out", p: Rtsp, kind: "camera" | "snapshot" = "camera") {
  const key = kind === "camera" ? `camera_source_${side}` : `snapshot_camera_source_${side}`;
  const next = { ...p, full: p.pass ? buildRtsp(p) : p.full };
  setCfg({ ...cfg, [key]: next.full });
}

function str(c: Cfg, k: string, d = "") {
  const v = c[k];
  return v == null ? d : String(v);
}
function bool(c: Cfg, k: string, d = false) {
  const v = c[k];
  return typeof v === "boolean" ? v : d;
}
function stripMasked(c: Cfg) {
  const out: Cfg = {};
  for (const [k, v] of Object.entries(c)) {
    if (typeof v === "string" && (v.includes("****") || v.includes(":***@"))) continue;
    out[k] = v;
  }
  return out;
}
function pickBarrier(c: Cfg) {
  const keys = Object.keys(c).filter((k) => k.startsWith("barrier_"));
  return Object.fromEntries(keys.map((k) => [k, c[k]]));
}
function pickAlpr(c: Cfg, side: "in" | "out") {
  return {
    [`hud_overlay_enabled_${side}`]: c[`hud_overlay_enabled_${side}`],
    [`hud_overlay_position_${side}`]: c[`hud_overlay_position_${side}`],
    [`motion_detection_enabled_${side}`]: c[`motion_detection_enabled_${side}`],
    [`motion_threshold_${side}`]: c[`motion_threshold_${side}`],
    [`motion_cooldown_sec_${side}`]: c[`motion_cooldown_sec_${side}`],
  };
}
function pickEvi(c: Cfg) {
  return Object.fromEntries(Object.entries(c).filter(([k, v]) => k.startsWith("snapshot_") && !(typeof v === "string" && v.includes("****"))));
}
function pickDni(c: Cfg) {
  return Object.fromEntries(Object.entries(c).filter(([k]) => k.startsWith("qr_")));
}
function pickMotor(c: Cfg) {
  const keys = [
    "auth_mode",
    "auto_register",
    "inference_every_n",
    "ocr_device",
    "filter_min_ocr_conf",
    "filter_min_detector_conf",
    "dedup_window_sec",
    "plate_filter_enabled",
    "plate_filter_countries",
  ];
  return Object.fromEntries(keys.map((k) => [k, c[k]]));
}
function pickPerms(c: Cfg) {
  return {
    vigilador_manual_trigger: c.vigilador_manual_trigger,
    propietario_auth_visits: c.propietario_auth_visits,
    barrier_auto_open_in: c.barrier_auto_open_in,
    barrier_auto_open_out: c.barrier_auto_open_out,
  };
}
