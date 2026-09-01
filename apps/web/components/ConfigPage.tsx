"use client";

import { useEffect, useState } from "react";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { PageHeader } from "@/components/PageHeader";

type Tab =
  | "modulos"
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

const TABS: { id: Tab; label: string }[] = [
  { id: "barreras", label: "Control Barreras" },
  { id: "alpr", label: "ALPR (Cámaras)" },
  { id: "evidencia", label: "Cámara Evidencia" },
  { id: "dni", label: "Lector DNI" },
  { id: "motor", label: "Motor y Lógica" },
  { id: "almacenamiento", label: "Almacenamiento" },
  { id: "operadores", label: "Gestión Operadores/Propietarios" },
  { id: "modulos", label: "Módulos AccesoPro" },
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
  const { tenantId, modules, isPlatform, toggleModule, status } = useDash();
  const [tab, setTab] = useState<Tab>("barreras");
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
  const engineUrl = (status.engineUrl ?? "http://192.168.33.13:5051").replace(/\/$/, "");

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
    reload().catch((err) => setMsg(err instanceof Error ? err.message : "No se pudo leer el motor"));
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

  return (
    <div>
      <PageHeader title="Configuración de sistema" subtitle="Misma estructura que AccesoSeguro. Los cambios van al motor de LAN." />
      {msg ? <p className="mb-3 text-sm text-accent">{msg}</p> : null}

      <div className="mb-4 flex flex-wrap gap-2 border-b border-line pb-2.5">
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

      {tab === "modulos" ? (
        <section className="card p-5">
          <p className="mb-4 text-sm text-muted">
            {isPlatform
              ? "Lo que tildes es lo que el barrio ve en el menú. El núcleo no se apaga."
              : "Solo se muestran los módulos contratados."}
          </p>
          <ul className="divide-y divide-line">
            {modules
              .filter((m) => isPlatform || m.enabled)
              .map((m) => (
                <li key={m.key} className="flex items-start justify-between gap-4 py-3">
                  <div>
                    <p className="font-medium">{m.name}</p>
                    <p className="text-sm text-muted">{m.summary}</p>
                  </div>
                  {isPlatform ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={m.enabled}
                        disabled={m.alwaysOn}
                        onChange={(e) => toggleModule(m.key, e.target.checked)}
                      />
                      {m.alwaysOn ? "Siempre" : m.enabled ? "On" : "Off"}
                    </label>
                  ) : (
                    <span className="text-accent text-sm">On</span>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ) : null}

      {tab === "barreras" ? (
        <div className="space-y-4">
          <section className="card">
            <div className="card-h flex items-center justify-between">
              <span>Panel de subsistemas</span>
              <button type="button" className="btn-ghost" onClick={() => reload()}>
                Actualizar
              </button>
            </div>
            <div className="space-y-4 p-4">
              <p className="text-xs text-muted">Activá o apagá cada pieza sin reiniciar el servidor.</p>
              <h4 className="border-b border-line pb-1 font-semibold text-accent">Barrera de ingreso (IN)</h4>
              <SubRow
                led={sub?.alpr_in?.running}
                name="ALPR — Reconocimiento de patentes"
                detail={sub?.alpr_in?.running ? `Activo — ${sub.alpr_in.source}` : sub?.alpr_in?.last_error || "Detenido"}
                checked={!!sub?.alpr_in?.running}
                onToggle={(v) => toggleSub("alpr_in", v)}
              />
              <SubRow
                led={sub?.qr_in?.running}
                name="Lector QR / DNI"
                detail={sub?.qr_in?.running ? `Tipo: ${sub.qr_in.type}` : sub?.qr_in?.last_error || "Detenido"}
                checked={!!sub?.qr_in?.running}
                onToggle={(v) => toggleSub("qr_in", v)}
              />
              <SubRow
                led={!!sub?.snapshot_enabled_in}
                name="Cámara de evidencia"
                detail={sub?.snapshot_enabled_in ? "Habilitada" : "Deshabilitada"}
                checked={!!sub?.snapshot_enabled_in}
                onToggle={(v) => toggleSub("snapshot_in", v)}
              />
              <h4 className="border-b border-line pb-1 pt-2 font-semibold text-warn">Barrera de salida (OUT)</h4>
              <SubRow
                led={sub?.alpr_out?.running}
                name="ALPR — Reconocimiento de patentes"
                detail={sub?.alpr_out?.running ? `Activo — ${sub.alpr_out.source}` : sub?.alpr_out?.last_error || "Detenido"}
                checked={!!sub?.alpr_out?.running}
                onToggle={(v) => toggleSub("alpr_out", v)}
              />
              <SubRow
                led={sub?.qr_out?.running}
                name="Lector QR / DNI"
                detail={sub?.qr_out?.running ? `Tipo: ${sub.qr_out.type}` : "Detenido"}
                checked={!!sub?.qr_out?.running}
                onToggle={(v) => toggleSub("qr_out", v)}
              />
              <SubRow
                led={!!sub?.snapshot_enabled_out}
                name="Cámara de evidencia"
                detail={sub?.snapshot_enabled_out ? "Habilitada" : "Deshabilitada"}
                checked={!!sub?.snapshot_enabled_out}
                onToggle={(v) => toggleSub("snapshot_out", v)}
              />
            </div>
          </section>

          <section className="card">
            <div className="card-h">Configuración de barreras físicas</div>
            <div className="grid gap-5 p-4 lg:grid-cols-2">
              <BarrierForm
                title="Barrera de ingreso (IN)"
                accent="in"
                cfg={cfg}
                suffix="in"
                ports={ports}
                onChange={(k, v) => setCfg({ ...cfg, [k]: v })}
                onTest={(a) => testBarrier("in", a)}
              />
              <BarrierForm
                title="Barrera de salida (OUT)"
                accent="out"
                cfg={cfg}
                suffix="out"
                ports={ports}
                onChange={(k, v) => setCfg({ ...cfg, [k]: v })}
                onTest={(a) => testBarrier("out", a)}
              />
            </div>
            <div className="flex justify-end border-t border-line p-4">
              <button type="button" disabled={busy} className="rounded-[10px] bg-accent px-4 py-2 text-sm text-white" onClick={() => savePartial(pickBarrier(cfg))}>
                Guardar barreras
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {tab === "alpr" ? (
        <div className="space-y-4">
          <div className="flex gap-2">
            <button type="button" className={`cfg-tab ${alprSide === "in" ? "active" : ""}`} onClick={() => setAlprSide("in")}>
              Ingreso (IN)
            </button>
            <button type="button" className={`cfg-tab ${alprSide === "out" ? "active" : ""}`} onClick={() => setAlprSide("out")}>
              Salida (OUT)
            </button>
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
            <div className="flex justify-end border-t border-line p-4">
              <button
                type="button"
                disabled={busy}
                className="rounded-[10px] bg-accent px-4 py-2 text-sm text-white"
                onClick={() => saveAlpr()}
              >
                Guardar ALPR
              </button>
            </div>
          </section>
          <section className="card p-4">
            <p className="text-sm text-muted">
              El recuadro ROI se dibuja sobre el live de AccesoSeguro. Acá queda el live de referencia.
            </p>
            <img
              className="mt-3 w-full max-w-3xl rounded-[10px] border border-line bg-black"
              src={`${engineUrl}/video_feed/${alprSide}`}
              alt="ROI"
            />
          </section>
        </div>
      ) : null}

      {tab === "evidencia" ? (
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <EvidenceCard side="in" cfg={cfg} setCfg={setCfg} engineUrl={engineUrl} />
            <EvidenceCard side="out" cfg={cfg} setCfg={setCfg} engineUrl={engineUrl} />
          </div>
          <div className="flex justify-end">
            <button type="button" disabled={busy} className="rounded-[10px] bg-accent px-4 py-2 text-sm text-white" onClick={() => savePartial(pickEvi(cfg))}>
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
              <button type="button" disabled={busy} className="rounded-[10px] bg-accent px-4 py-2 text-sm text-white" onClick={() => savePartial(pickDni(cfg))}>
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
            <button type="button" disabled={busy} className="rounded-[10px] bg-accent px-4 py-2 text-sm text-white" onClick={() => savePartial(pickMotor(cfg))}>
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
              className="mt-4 w-full rounded-[10px] bg-accent py-2 text-sm text-white"
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
                <button type="button" className="rounded-[10px] bg-accent px-4 py-2 text-sm text-white" onClick={() => savePartial(pickPerms(cfg))}>
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
                  className="rounded-[10px] bg-accent px-4 py-2 text-sm text-white"
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

function SubRow({
  led,
  name,
  detail,
  checked,
  onToggle,
}: {
  led?: boolean;
  name: string;
  detail: string;
  checked: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div className="subsys-row">
      <span className={`subsys-led ${led ? "led-green" : "led-red"}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{name}</p>
        <p className="truncate text-xs text-muted">{detail}</p>
      </div>
      <label className="toggle-switch">
        <input type="checkbox" checked={checked} onChange={(e) => onToggle(e.target.checked)} />
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
  return (
    <section className="card">
      <div className="card-h">Cámara evidencia — {side === "in" ? "Ingreso" : "Salida"}</div>
      <div className="space-y-3 p-4">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={bool(cfg, `snapshot_enabled_${side}`)}
            onChange={(e) => setCfg({ ...cfg, [`snapshot_enabled_${side}`]: e.target.checked })}
          />
          Habilitar
        </label>
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
        <img className="aspect-video w-full rounded-[8px] bg-black object-cover" src={`${engineUrl}/video_feed_evidence/${side}`} alt="" />
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
