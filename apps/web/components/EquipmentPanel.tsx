"use client";

import { FormEvent, useEffect, useState } from "react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import {
  Plus,
  Settings,
  Activity,
  Trash2,
  X,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Radio,
  Lock,
  Unlock,
  Camera,
  Eye,
  EyeOff,
  Server,
  DoorClosed,
  Check,
  Wifi,
  WifiOff,
  Video,
  ScanFace,
  MapPin,
  Layers,
  Sparkles,
  Play,
} from "lucide-react";

type DeviceType = "asi_facial" | "camera_ip" | "vto_intercom" | "access_controller";

type Device = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  deviceType?: DeviceType;
  model?: string | null;
  serialNumber?: string | null;
  location?: string | null;
  lastStatus?: "online" | "offline" | "unknown";
  lastSeenAt?: string | null;
  rtspUrl?: string | null;
  sentido?: "in" | "out" | string | null;
  laneSector?: "vehicular" | "peatonal" | string | null;
  useLive?: boolean;
  useLocalRelay?: boolean;
};

type Actuator = {
  id: string;
  name: string;
  kind: string;
  driver: string;
  dahuaDeviceId: string | null;
};

type FormState = {
  name: string;
  deviceType: DeviceType;
  model: string;
  serialNumber: string;
  location: string;
  host: string;
  port: string;
  username: string;
  password: string;

  // Campos específicos Cámara IP
  rtspPort: string;
  rtspChannel: string;
  rtspSubtype: string;
  rtspUrl: string;
  customRtsp: boolean;
  linkActuatorForAlpr: boolean;

  // Campos Actuador (ASI / VTO / ALPR)
  actuatorName: string;
  kind: string;
  sentido: "in" | "out";
  laneSector: "vehicular" | "peatonal";
  useLive: boolean;
  useLocalRelay: boolean;
};

function buildRtspUrl(
  user: string,
  pass: string,
  host: string,
  rtspPort = "554",
  channel = "1",
  subtype = "0",
) {
  const h = host.trim() || "192.168.1.100";
  const p = rtspPort.trim() || "554";
  const u = user.trim() || "admin";
  const pw = pass ? encodeURIComponent(pass) : "clave";
  return `rtsp://${u}:${pw}@${h}:${p}/cam/realmonitor?channel=${channel}&subtype=${subtype}`;
}

const emptyForm = (): FormState => ({
  name: "",
  deviceType: "asi_facial",
  model: "ASI-6214S-PW",
  serialNumber: "",
  location: "",
  host: "",
  port: "80",
  username: "admin",
  password: "",
  rtspPort: "554",
  rtspChannel: "1",
  rtspSubtype: "0",
  rtspUrl: "",
  customRtsp: false,
  linkActuatorForAlpr: false,
  actuatorName: "",
  kind: "barrier",
  sentido: "in",
  laneSector: "vehicular",
  useLive: true,
  useLocalRelay: true,
});

type TestResult = {
  action: string;
  ok: boolean;
  detail: string;
  imageSrc?: string;
  timestamp: string;
};

export function EquipmentPanel() {
  const { tenantId, can, status } = useDash();
  const [devices, setDevices] = useState<Device[]>([]);
  const [actuators, setActuators] = useState<Actuator[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectSuccess, setDetectSuccess] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Estados de Modales
  const [modalMode, setModalMode] = useState<"create" | "edit" | null>(null);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [showPassword, setShowPassword] = useState(false);

  // Modal de Pruebas
  const [testingDevice, setTestingDevice] = useState<Device | null>(null);
  const [tests, setTests] = useState<TestResult[]>([]);

  const canEdit = can("core.config");
  const canOpen = can("dahua.open") || can("ops.relay");

  useEscapeKey(closeModal, modalMode !== null);
  useEscapeKey(closeTestingModal, testingDevice !== null);

  const t = (path: string) => withTenant(path, tenantId);

  async function load() {
    if (!tenantId) return;
    try {
      setLoading(true);
      const [d, a] = await Promise.all([
        api<{ devices: Device[] }>(t("/api/dahua")),
        api<{ actuators: Actuator[] }>(t("/api/actuators")).catch(() => ({ actuators: [] as Actuator[] })),
      ]);
      setDevices(d.devices || []);
      setActuators((a.actuators || []).filter((x) => x.driver === "dahua"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar equipos");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  function openCreateModal() {
    setModalMode("create");
    setEditingDevice(null);
    const initial = emptyForm();
    setForm(initial);
    setShowPassword(false);
    setDetectSuccess(null);
    setError(null);
  }

  function openEditModal(d: Device) {
    const act = actuators.find((a) => a.dahuaDeviceId === d.id);
    const dt = d.deviceType || "asi_facial";
    setModalMode("edit");
    setEditingDevice(d);
    setForm({
      name: d.name,
      deviceType: dt,
      model: d.model || "",
      serialNumber: d.serialNumber || "",
      location: d.location || "",
      host: d.host,
      port: String(d.port || 80),
      username: d.username,
      password: "",
      rtspPort: "554",
      rtspChannel: "1",
      rtspSubtype: "0",
      rtspUrl: d.rtspUrl || (dt === "camera_ip" ? buildRtspUrl(d.username, "", d.host) : ""),
      customRtsp: Boolean(d.rtspUrl && !d.rtspUrl.includes("/cam/realmonitor")),
      linkActuatorForAlpr: Boolean(act),
      actuatorName: act?.name ?? (dt === "camera_ip" ? "Barrera Entrada" : d.name),
      kind: act?.kind ?? (d.laneSector === "peatonal" && dt !== "camera_ip" ? "door" : "barrier"),
      sentido: d.sentido === "out" ? "out" : "in",
      laneSector: d.laneSector === "peatonal" ? "peatonal" : "vehicular",
      useLive: d.useLive !== false,
      useLocalRelay: dt === "camera_ip" ? false : d.useLocalRelay !== false,
    });
    setShowPassword(false);
    setDetectSuccess(null);
    setError(null);
  }

  function closeModal() {
    setModalMode(null);
    setEditingDevice(null);
    setForm(emptyForm());
    setDetectSuccess(null);
  }

  function openTestingModal(d: Device) {
    setTestingDevice(d);
    setTests([]);
  }

  function closeTestingModal() {
    setTestingDevice(null);
  }

  // Auto-completado inteligente de RTSP al cambiar host, user, pass o canal
  function handleCameraFieldChange(updates: Partial<FormState>) {
    const next = { ...form, ...updates };
    if (next.deviceType === "camera_ip" && !next.customRtsp) {
      next.rtspUrl = buildRtspUrl(
        next.username,
        next.password,
        next.host,
        next.rtspPort,
        next.rtspChannel,
        next.rtspSubtype,
      );
    }
    setForm(next);
  }

  // Auto-detección en vivo de Modelo y Serial Number (SN)
  async function handleAutoDetect() {
    if (!tenantId) return;
    if (!form.host || !form.username) {
      setError("Ingresá al menos IP y usuario para detectar el equipo");
      return;
    }
    if (modalMode === "create" && !form.password) {
      setError("Ingresá la clave del equipo para autenticar en la detección");
      return;
    }
    setDetecting(true);
    setError(null);
    setDetectSuccess(null);
    try {
      let resObj: { deviceType?: string; serial?: string } | undefined;
      if (modalMode === "edit" && editingDevice) {
        const r = await api<{
          ok: boolean;
          error?: string;
          result?: { deviceType?: string; serial?: string };
        }>(t(`/api/dahua/${editingDevice.id}/probe`), { method: "POST" });
        if (!r.ok) throw new Error(r.error || "No hubo respuesta del equipo");
        resObj = r.result;
      } else {
        const r = await api<{
          ok: boolean;
          error?: string;
          result?: { deviceType?: string; serial?: string };
        }>(t("/api/dahua/probe-transient"), {
          method: "POST",
          body: JSON.stringify({
            host: form.host.trim(),
            port: Number(form.port) || 80,
            username: form.username.trim(),
            password: form.password,
          }),
        });
        if (!r.ok) throw new Error(r.error || "No se pudo conectar al equipo");
        resObj = r.result;
      }

      if (resObj) {
        const modelFound = resObj.deviceType || form.model;
        const serialFound = resObj.serial || form.serialNumber;
        setForm((prev) => ({
          ...prev,
          model: modelFound,
          serialNumber: serialFound,
        }));
        setDetectSuccess(
          `¡Equipo detectado! Modelo: ${modelFound || "Genérico"} · S/N: ${serialFound || "No reportado"}`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fallo en la detección");
    } finally {
      setDetecting(false);
    }
  }

  async function checkDeviceOnline(device: Device) {
    if (!tenantId) return;
    setCheckingId(device.id);
    try {
      const res = await api<{
        ok: boolean;
        status: "online" | "offline";
        result?: { deviceType?: string; serial?: string };
      }>(t(`/api/dahua/${device.id}/check-online`), { method: "POST" });

      setDevices((prev) =>
        prev.map((d) =>
          d.id === device.id
            ? {
                ...d,
                lastStatus: res.status,
                lastSeenAt: res.status === "online" ? new Date().toISOString() : d.lastSeenAt,
                model: res.result?.deviceType || d.model,
                serialNumber: res.result?.serial || d.serialNumber,
              }
            : d,
        ),
      );
    } catch {
      setDevices((prev) =>
        prev.map((d) => (d.id === device.id ? { ...d, lastStatus: "offline" } : d)),
      );
    } finally {
      setCheckingId(null);
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!tenantId || !canEdit) return;
    setBusy("save");
    setError(null);
    setMsg(null);
    try {
      const isCam = form.deviceType === "camera_ip";
      const payload = {
        name: form.name.trim(),
        deviceType: form.deviceType,
        model: form.model.trim() || null,
        serialNumber: form.serialNumber.trim() || null,
        location: form.location.trim() || null,
        rtspUrl: isCam ? form.rtspUrl.trim() || null : null,
        host: form.host.trim(),
        port: Number(form.port) || 80,
        username: form.username.trim(),
        password: form.password ? form.password : undefined,
        sentido: form.sentido,
        laneSector: form.laneSector,
        useLive: form.useLive,
        useLocalRelay: isCam ? false : form.useLocalRelay,
        actuatorName: isCam
          ? form.linkActuatorForAlpr
            ? form.actuatorName.trim() || form.name.trim()
            : ""
          : form.useLocalRelay
            ? form.actuatorName.trim() || form.name.trim()
            : "",
        kind: isCam
          ? form.linkActuatorForAlpr
            ? form.kind
            : "door"
          : form.useLocalRelay
            ? form.kind
            : "door",
      };

      if (modalMode === "create") {
        await api(t("/api/dahua"), {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setMsg("Equipo registrado exitosamente.");
      } else if (modalMode === "edit" && editingDevice) {
        await api(t(`/api/dahua/${editingDevice.id}`), {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        setMsg("Equipo actualizado correctamente.");
      }
      closeModal();
      await load();
      setTimeout(() => setMsg(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setBusy(null);
    }
  }

  async function onDelete() {
    if (!tenantId || !editingDevice || !canEdit) return;
    if (!confirm(`¿Confirmás la eliminación del equipo «${editingDevice.name}» y su configuración vinculada?`)) return;
    setBusy("delete");
    setError(null);
    try {
      await api(t(`/api/dahua/${editingDevice.id}`), { method: "DELETE" });
      setMsg("Equipo eliminado del sistema.");
      closeModal();
      await load();
      setTimeout(() => setMsg(null), 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar");
    } finally {
      setBusy(null);
    }
  }

  async function runTest(action: "probe" | "door_status" | "open" | "snapshot") {
    if (!tenantId || !testingDevice) return;
    if (action === "open" && !canOpen) {
      setError("Sin autorización para apertura");
      return;
    }
    setBusy(action);
    setError(null);
    try {
      const r = await api<{
        ok: boolean;
        error?: string;
        result?: {
          ok?: boolean;
          error?: string;
          deviceType?: string;
          serial?: string;
          status?: string;
          response?: string;
          imageBase64?: string;
          contentType?: string;
          bytes?: number;
        };
      }>(t(`/api/dahua/${testingDevice.id}/test`), {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      const res = r.result;
      let detail = r.error || res?.error || (r.ok ? "Respuesta OK" : "Falló");
      let imageSrc: string | undefined;
      if (action === "probe" && res?.deviceType) {
        detail = `${res.deviceType}${res.serial ? ` · S/N: ${res.serial}` : ""}`;
      }
      if (action === "door_status" && res?.status) detail = `Estado sensor: ${res.status}`;
      if (action === "open" && res?.response) detail = `Respuesta apertura: ${res.response}`;
      if (action === "snapshot" && res?.imageBase64) {
        detail = `Fotograma en vivo capturado (${res.bytes ?? "OK"} bytes)`;
        imageSrc = `data:${res.contentType || "image/jpeg"};base64,${res.imageBase64}`;
      }
      const now = new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setTests((prev) => [
        { action, ok: Boolean(r.ok && res?.ok !== false), detail, imageSrc, timestamp: now },
        ...prev,
      ].slice(0, 10));

      // Actualizar estado online del dispositivo en local
      setDevices((prev) =>
        prev.map((d) =>
          d.id === testingDevice.id
            ? {
                ...d,
                lastStatus: r.ok && res?.ok !== false ? "online" : "offline",
                lastSeenAt: r.ok ? new Date().toISOString() : d.lastSeenAt,
                model: res?.deviceType || d.model,
                serialNumber: res?.serial || d.serialNumber,
              }
            : d,
        ),
      );
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Fallo la prueba";
      const now = new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      setTests((prev) => [{ action, ok: false, detail, timestamp: now }, ...prev].slice(0, 10));
    } finally {
      setBusy(null);
    }
  }

  function getDeviceTypeInfo(type?: string) {
    switch (type) {
      case "camera_ip":
        return {
          label: "Cámara IP",
          icon: <Video className="h-3.5 w-3.5" />,
          color: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800",
        };
      case "vto_intercom":
        return {
          label: "Intercom VTO",
          icon: <Radio className="h-3.5 w-3.5" />,
          color: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
        };
      case "access_controller":
        return {
          label: "Controlador IP",
          icon: <Server className="h-3.5 w-3.5" />,
          color: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
        };
      case "asi_facial":
      default:
        return {
          label: "Terminal Facial ASI",
          icon: <ScanFace className="h-3.5 w-3.5" />,
          color: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",
        };
    }
  }

  if (!tenantId) return <p className="text-sm text-slate-500 dark:text-muted">Elegí un barrio.</p>;

  return (
    <div className="space-y-6">
      {/* Encabezado Principal */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/80 shadow-sm">
              <Layers className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                Equipos e Infraestructura
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Gestión de terminales de acceso, cámaras IP, intercomunicadores y hardware de predio.
              </p>
            </div>
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                status.agentOnline
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800"
                  : "bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${status.agentOnline ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`} />
              Agent LAN: {status.agentOnline ? "En línea (:8790)" : "Offline (Verificar servicio LAN)"}
            </span>
          </div>
        </div>

        {canEdit && (
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>Nuevo Dispositivo</span>
          </button>
        )}
      </div>

      {/* Alertas de Notificación */}
      {msg && (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 p-3.5 text-sm text-emerald-800 dark:text-emerald-300 shadow-sm animate-in fade-in">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>{msg}</span>
        </div>
      )}

      {error && !modalMode && (
        <div className="flex items-center gap-2.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 p-3.5 text-sm text-rose-800 dark:text-rose-300 shadow-sm animate-in fade-in">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Lista de Equipos */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
          <RefreshCw className="h-8 w-8 animate-spin text-blue-600 dark:text-blue-400" />
          <p className="mt-3 text-sm">Cargando infraestructura...</p>
        </div>
      ) : devices.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 p-12 text-center bg-slate-50/50 dark:bg-slate-900/30">
          <Server className="mx-auto h-12 w-12 text-slate-400 dark:text-slate-600" />
          <h3 className="mt-3 text-base font-semibold text-slate-800 dark:text-white">
            No hay equipos configurados
          </h3>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
            Registrá terminales de acceso, cámaras IP o intercomunicadores para el predio.
          </p>
          {canEdit && (
            <button
              type="button"
              onClick={openCreateModal}
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-4 w-4" />
              <span>Registrar primer equipo</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {devices.map((d) => {
            const act = actuators.find((a) => a.dahuaDeviceId === d.id);
            const kindLabel =
              act?.kind === "barrier" ? "Barrera" : act?.kind === "gate" ? "Portón" : "Puerta";
            const typeInfo = getDeviceTypeInfo(d.deviceType);
            const isChecking = checkingId === d.id;
            const isCam = d.deviceType === "camera_ip";

            return (
              <div
                key={d.id}
                className="group relative flex flex-col justify-between rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-5 shadow-sm hover:shadow-md transition-all duration-200"
              >
                <div>
                  {/* Top card: Header & Badges */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 font-bold border border-slate-200 dark:border-slate-700/60">
                        {d.deviceType === "camera_ip" ? (
                          <Video className="h-5 w-5" />
                        ) : d.deviceType === "vto_intercom" ? (
                          <Radio className="h-5 w-5" />
                        ) : (
                          <ScanFace className="h-5 w-5" />
                        )}
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-slate-900 dark:text-white leading-tight">
                          {d.name}
                        </h3>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs text-slate-500 dark:text-slate-400 font-semibold">
                            {d.host}:{d.port}
                          </span>
                          {d.model && (
                            <span className="rounded bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono font-medium text-slate-600 dark:text-slate-300">
                              {d.model}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Tipo de tecnología */}
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold border ${typeInfo.color}`}
                    >
                      {typeInfo.icon}
                      {typeInfo.label}
                    </span>
                  </div>

                  {/* Estado en Línea del Dispositivo Real (MONITOREO EN TARJETA) */}
                  <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 dark:bg-slate-800/40 p-2.5 border border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          d.lastStatus === "online"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-800"
                            : d.lastStatus === "offline"
                              ? "bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/60 dark:text-rose-400 dark:border-rose-800"
                              : "bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700"
                        }`}
                      >
                        {d.lastStatus === "online" ? (
                          <>
                            <Wifi className="h-3 w-3 text-emerald-500" />
                            <span>En línea</span>
                          </>
                        ) : d.lastStatus === "offline" ? (
                          <>
                            <WifiOff className="h-3 w-3 text-rose-500" />
                            <span>Sin conexión</span>
                          </>
                        ) : (
                          <>
                            <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                            <span>Sin verificar</span>
                          </>
                        )}
                      </span>
                      {d.lastSeenAt && (
                        <span className="text-[10px] text-slate-400 dark:text-slate-500">
                          {new Date(d.lastSeenAt).toLocaleTimeString("es-AR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={isChecking}
                      onClick={() => checkDeviceOnline(d)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-50"
                      title="Probar conexión en tiempo real vía Dahua Agent"
                    >
                      <RefreshCw className={`h-3 w-3 ${isChecking ? "animate-spin" : ""}`} />
                      <span>{isChecking ? "Chequeando..." : "Verificar"}</span>
                    </button>
                  </div>

                  {/* Detalles Técnicos */}
                  <div className="mt-3 rounded-xl bg-slate-50 dark:bg-slate-800/30 p-3 text-xs space-y-1.5 border border-slate-100 dark:border-slate-800">
                    <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                      <span className="text-slate-400 dark:text-slate-500">Portería:</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {d.sentido === "out" ? "Salida" : "Entrada"}
                        {" · "}
                        {d.laneSector === "peatonal" ? "Peatonal" : "Vehicular"}
                        {d.useLive !== false ? " · Live" : ""}
                        {!isCam && d.useLocalRelay !== false ? " · Relé local" : ""}
                      </span>
                    </div>

                    {d.location && (
                      <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                        <span className="flex items-center gap-1 text-slate-400 dark:text-slate-500">
                          <MapPin className="h-3 w-3" /> Ubicación:
                        </span>
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {d.location}
                        </span>
                      </div>
                    )}

                    {isCam && d.rtspUrl && (
                      <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                        <span className="text-slate-400 dark:text-slate-500">Stream RTSP:</span>
                        <span
                          className="font-mono text-[10px] text-slate-700 dark:text-slate-300 truncate max-w-[170px]"
                          title={d.rtspUrl}
                        >
                          {d.rtspUrl}
                        </span>
                      </div>
                    )}

                    {act ? (
                      <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                        <span className="text-slate-400 dark:text-slate-500">Actuador vinculado:</span>
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {act.name} ({kindLabel})
                        </span>
                      </div>
                    ) : isCam ? (
                      <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                        <span className="text-slate-400 dark:text-slate-500">Destino:</span>
                        <span className="font-medium text-purple-600 dark:text-purple-400">
                          Visualización Live & ALPR
                        </span>
                      </div>
                    ) : null}

                    <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                      <span className="text-slate-400 dark:text-slate-500">Usuario API:</span>
                      <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                        {d.username}
                      </span>
                    </div>

                    {d.serialNumber && (
                      <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                        <span className="text-slate-400 dark:text-slate-500">Nº Serie (S/N):</span>
                        <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                          {d.serialNumber}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Acciones de la tarjeta */}
                <div className="mt-5 flex items-center gap-2 pt-3 border-t border-slate-100 dark:border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => openTestingModal(d)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-300 transition-colors shadow-sm"
                  >
                    <Activity className="h-3.5 w-3.5 text-blue-500" />
                    <span>Diagnóstico</span>
                  </button>

                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => openEditModal(d)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-300 transition-colors shadow-sm"
                      title="Configurar y editar equipo"
                    >
                      <Settings className="h-3.5 w-3.5 text-slate-500" />
                      <span>Configurar</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL DE CREACIÓN / EDICIÓN CON CAMPOS CONTEXTUALES Y AUTO-COMPLETADO      */}
      {/* ========================================================================= */}
      {modalMode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={closeModal}
        >
          <div
            className="relative flex flex-col w-full max-w-xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f172a] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/80">
                  <Settings className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    {modalMode === "create" ? "Nuevo Dispositivo de Predio" : `Configuración: ${editingDevice?.name}`}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {form.deviceType === "camera_ip"
                      ? "Parámetros de stream RTSP para Live y reconocimiento LPR"
                      : "Parámetros de conexión y control de acceso biométrico"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="Cerrar ventana"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={onSave} className="flex flex-col">
              <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
                {error && (
                  <div className="flex items-center gap-2.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 p-3 text-xs text-rose-700 dark:text-rose-300">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
                    <span>{error}</span>
                  </div>
                )}

                {detectSuccess && (
                  <div className="flex items-center gap-2.5 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-xs text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span>{detectSuccess}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Tipo de Tecnología / Dispositivo */}
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Tipo de Dispositivo / Tecnología *
                    </label>
                    <select
                      value={form.deviceType}
                      onChange={(e) => {
                        const dt = e.target.value as DeviceType;
                        const isCam = dt === "camera_ip";
                        const updated: Partial<FormState> = {
                          deviceType: dt,
                          model:
                            dt === "asi_facial"
                              ? "ASI-6214S-PW"
                              : isCam
                                ? "IPC-HFW5241E-Z12E"
                                : dt === "vto_intercom"
                                  ? "VTO-2202F-P"
                                  : form.model,
                        };
                        if (isCam) {
                          updated.useLocalRelay = false;
                          updated.rtspUrl = buildRtspUrl(
                            form.username,
                            form.password,
                            form.host,
                            form.rtspPort,
                            form.rtspChannel,
                            form.rtspSubtype,
                          );
                        } else if (!form.useLocalRelay && form.deviceType === "camera_ip") {
                          updated.useLocalRelay = true;
                        }
                        setForm((prev) => ({ ...prev, ...updated }));
                      }}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2 text-sm text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="asi_facial">Terminal Facial ASI / Control Biométrico (Dahua ASI)</option>
                      <option value="camera_ip">Cámara IP / Lectura LPR - ANPR</option>
                      <option value="vto_intercom">Intercomunicador / Portero Visor (VTO Dahua)</option>
                      <option value="access_controller">Controlador de Acceso / Relé IP</option>
                    </select>
                  </div>

                  {/* Nombre */}
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Nombre Identificatorio *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder={
                        form.deviceType === "camera_ip"
                          ? "Ej. Cámara LPR Entrada Principal"
                          : "Ej. Lector Facial Entrada Principal"
                      }
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  {/* IP / Host */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Dirección IP / Host *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ej. 192.168.33.200"
                      value={form.host}
                      onChange={(e) => handleCameraFieldChange({ host: e.target.value })}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                    />
                  </div>

                  {/* Puerto HTTP */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Puerto HTTP (Web/API) *
                    </label>
                    <input
                      type="number"
                      required
                      placeholder="80"
                      value={form.port}
                      onChange={(e) => setForm({ ...form, port: e.target.value })}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                    />
                  </div>

                  {/* Usuario */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Usuario API / Cámara *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="admin"
                      value={form.username}
                      onChange={(e) => handleCameraFieldChange({ username: e.target.value })}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  {/* Contraseña */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      {modalMode === "edit" ? "Nueva Clave (opcional)" : "Clave del Equipo *"}
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        required={modalMode === "create"}
                        placeholder={modalMode === "edit" ? "Sin cambios" : "••••••••"}
                        value={form.password}
                        onChange={(e) => handleCameraFieldChange({ password: e.target.value })}
                        className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Modelo con botón de detección automática */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Modelo de Equipo
                      </label>
                      <button
                        type="button"
                        onClick={handleAutoDetect}
                        disabled={detecting || !form.host}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 disabled:opacity-40"
                        title="Consultar al equipo su modelo exacto y S/N en vivo"
                      >
                        <Sparkles className={`h-3 w-3 ${detecting ? "animate-spin" : ""}`} />
                        <span>{detecting ? "Detectando..." : "Auto-detectar"}</span>
                      </button>
                    </div>
                    <input
                      type="text"
                      placeholder="Ej. ASI-6214S-PW o IPC-HFW5241E"
                      value={form.model}
                      onChange={(e) => setForm({ ...form, model: e.target.value })}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                    />
                  </div>

                  {/* Número de Serie */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Nº de Serie (S/N)
                    </label>
                    <input
                      type="text"
                      placeholder="Auto-rellenable o manual"
                      value={form.serialNumber}
                      onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-xs"
                    />
                  </div>

                  {/* Ubicación / Sector */}
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Ubicación / Sector Físico
                    </label>
                    <input
                      type="text"
                      placeholder="Ej. Barrera principal, lote 1"
                      value={form.location}
                      onChange={(e) => setForm({ ...form, location: e.target.value })}
                      className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div className="sm:col-span-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 p-4 space-y-3">
                    <p className="text-xs font-bold text-slate-800 dark:text-slate-200">Rol en portería</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Un equipo trabaja en Entrada (carril 1) o en Salida (carril 2), y en vehicular o peatonal.
                      Desde que se guarda este rol, los pases nuevos se anotan en ese carril. Los anteriores
                      quedan donde se registraron. El ASI de salida se carga después, con esta misma ficha.
                    </p>
                    <div>
                      <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Sentido</p>
                      <div className="flex flex-wrap gap-2">
                      {([
                        ["in", "Entrada"],
                        ["out", "Salida"],
                      ] as const).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setForm({ ...form, sentido: key })}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                            form.sentido === key
                              ? "border-blue-500 bg-blue-50 text-blue-800 dark:border-blue-400 dark:bg-blue-950/50 dark:text-blue-200"
                              : "border-slate-300 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1.5">Tipo de carril</p>
                      <div className="flex flex-wrap gap-2">
                      {([
                        ["vehicular", "Vehicular"],
                        ["peatonal", "Peatonal"],
                      ] as const).map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() =>
                            setForm({
                              ...form,
                              laneSector: key,
                              kind:
                                key === "vehicular" && form.kind === "door"
                                  ? "barrier"
                                  : key === "peatonal" && form.kind === "barrier"
                                    ? "door"
                                    : form.kind,
                            })
                          }
                          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                            form.laneSector === key
                              ? "border-blue-500 bg-blue-50 text-blue-800 dark:border-blue-400 dark:bg-blue-950/50 dark:text-blue-200"
                              : "border-slate-300 bg-white text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                      </div>
                    </div>
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={form.useLive}
                        onChange={(e) => setForm({ ...form, useLive: e.target.checked })}
                      />
                      <span>
                        <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">Live</span>
                        <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                          Video en la consola de ese sentido. No cambia el ASI.
                        </span>
                      </span>
                    </label>
                    {form.deviceType !== "camera_ip" ? (
                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={form.useLocalRelay}
                          onChange={(e) => setForm({ ...form, useLocalRelay: e.target.checked })}
                        />
                        <span>
                          <span className="block text-xs font-semibold text-slate-800 dark:text-slate-200">
                            Relé local
                          </span>
                          <span className="block text-[11px] text-slate-500 dark:text-slate-400">
                            Botón de portería (openDoor). La cara sigue abriendo la chapa desde el firmware del ASI.
                          </span>
                        </span>
                      </label>
                    ) : null}
                  </div>

                  {/* ========================================================================= */}
                  {/* SECCIÓN EXCLUSIVA PARA CÁMARA IP: RTSP STREAM Y ALPR                      */}
                  {/* ========================================================================= */}
                  {form.deviceType === "camera_ip" ? (
                    <div className="sm:col-span-2 rounded-xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/40 p-4 space-y-3.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-purple-900 dark:text-purple-300 flex items-center gap-1.5">
                          <Video className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                          Configuración de Stream de Video RTSP (Live & ALPR)
                        </span>
                        <span className="text-[11px] font-semibold text-purple-600 dark:text-purple-400">
                          Auto-generado
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                            Puerto RTSP
                          </label>
                          <input
                            type="number"
                            value={form.rtspPort}
                            onChange={(e) => handleCameraFieldChange({ rtspPort: e.target.value })}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-2.5 py-1.5 text-xs font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                            Canal
                          </label>
                          <input
                            type="number"
                            value={form.rtspChannel}
                            onChange={(e) => handleCameraFieldChange({ rtspChannel: e.target.value })}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-2.5 py-1.5 text-xs font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                            Substream
                          </label>
                          <select
                            value={form.rtspSubtype}
                            onChange={(e) => handleCameraFieldChange({ rtspSubtype: e.target.value })}
                            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-2.5 py-1.5 text-xs"
                          >
                            <option value="0">0 (Principal HD)</option>
                            <option value="1">1 (Substream Fluido)</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                            URL RTSP para Live y Software ALPR (AccesoSeguro)
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              setForm({
                                ...form,
                                customRtsp: false,
                                rtspUrl: buildRtspUrl(
                                  form.username,
                                  form.password,
                                  form.host,
                                  form.rtspPort,
                                  form.rtspChannel,
                                  form.rtspSubtype,
                                ),
                              })
                            }
                            className="text-[10px] text-purple-600 hover:text-purple-700 dark:text-purple-400 font-semibold underline"
                          >
                            Reconstruir URL Dahua
                          </button>
                        </div>
                        <input
                          type="text"
                          required
                          value={form.rtspUrl}
                          onChange={(e) =>
                            setForm({ ...form, rtspUrl: e.target.value, customRtsp: true })
                          }
                          placeholder="rtsp://admin:clave@192.168.33.200:554/cam/realmonitor?channel=1&subtype=0"
                          className="w-full rounded-xl border border-purple-300 dark:border-purple-800 bg-white dark:bg-[#0b0f17] px-3 py-2 text-xs font-mono text-purple-950 dark:text-purple-200 focus:outline-none focus:ring-1 focus:ring-purple-500"
                        />
                      </div>

                      {/* Vinculación Opcional a Barrera para ALPR */}
                      <div className="pt-2 border-t border-purple-200 dark:border-purple-900/40">
                        <label className="flex items-center gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={form.linkActuatorForAlpr}
                            onChange={(e) =>
                              setForm({ ...form, linkActuatorForAlpr: e.target.checked })
                            }
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4"
                          />
                          <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                            Vincular a barrera / relé para apertura automática por ALPR
                          </span>
                        </label>

                        {form.linkActuatorForAlpr && (
                          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                            <div>
                              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                                Nombre del Actuador
                              </label>
                              <input
                                type="text"
                                placeholder="Ej. Barrera Entrada"
                                value={form.actuatorName}
                                onChange={(e) => setForm({ ...form, actuatorName: e.target.value })}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-2.5 py-1.5 text-xs"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                                Tipo de Actuador
                              </label>
                              <select
                                value={form.kind}
                                onChange={(e) => setForm({ ...form, kind: e.target.value })}
                                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-2.5 py-1.5 text-xs"
                              >
                                <option value="barrier">Barrera vehicular</option>
                                <option value="gate">Portón vehicular</option>
                                <option value="door">Puerta peatonal</option>
                              </select>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : form.useLocalRelay ? (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          Nombre del relé en portería
                        </label>
                        <input
                          type="text"
                          placeholder="Ej. Puerta peatonal o Barrera"
                          value={form.actuatorName}
                          onChange={(e) => setForm({ ...form, actuatorName: e.target.value })}
                          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          Tipo de dispositivo físico
                        </label>
                        <select
                          value={form.kind}
                          onChange={(e) => setForm({ ...form, kind: e.target.value })}
                          className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2 text-sm text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="door">Puerta peatonal</option>
                          <option value="gate">Portón vehicular</option>
                          <option value="barrier">Barrera de acceso</option>
                        </select>
                      </div>
                    </>
                  ) : (
                    <p className="sm:col-span-2 text-[11px] text-slate-500 dark:text-slate-400">
                      Sin relé local: la cara abre la chapa desde el firmware del ASI. El botón de
                      portería no dispara este equipo.
                    </p>
                  )}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 px-6 py-4">
                {modalMode === "edit" ? (
                  <button
                    type="button"
                    onClick={onDelete}
                    disabled={busy === "delete"}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 px-3.5 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/50 transition-colors disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    <span>{busy === "delete" ? "Borrando..." : "Borrar equipo"}</span>
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={closeModal}
                    className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shadow-sm"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={busy === "save"}
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    {busy === "save" ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="h-4 w-4" />
                    )}
                    <span>{modalMode === "create" ? "Registrar Dispositivo" : "Guardar Cambios"}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL DE PRUEBAS / DIAGNÓSTICO ADAPTADO AL TIPO DE TECNOLOGÍA              */}
      {/* ========================================================================= */}
      {testingDevice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={closeTestingModal}
        >
          <div
            className="relative flex flex-col w-full max-w-2xl max-h-[90vh] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f172a] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-6 py-4">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/80">
                  <Activity className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Diagnóstico: {testingDevice.name}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                    {testingDevice.host}:{testingDevice.port}{" "}
                    {testingDevice.model ? `· ${testingDevice.model}` : ""} · Agent{" "}
                    {status.agentOnline ? "Online" : "Offline"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeTestingModal}
                className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="Cerrar ventana"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Contenido */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Botonera de Pruebas según Tipo de Tecnología */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
                  Pruebas operativas disponibles
                </p>

                {testingDevice.deviceType === "camera_ip" ? (
                  /* ========================================================================= */
                  /* BOTONES DE PRUEBA EXCLUSIVOS PARA CÁMARAS IP                               */
                  /* ========================================================================= */
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      disabled={!!busy || !status.agentOnline}
                      onClick={() => runTest("probe")}
                      className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 hover:bg-blue-50 dark:hover:bg-blue-950/40 hover:border-blue-300 dark:hover:border-blue-800 text-slate-700 dark:text-slate-200 transition-all disabled:opacity-50"
                    >
                      <Radio className="h-6 w-6 text-blue-500 mb-2" />
                      <span className="text-xs font-semibold">1. Conexión y Modelo</span>
                      <span className="text-[10px] text-slate-400 mt-0.5">
                        Detectar modelo IPC y S/N en vivo
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={!!busy || !status.agentOnline}
                      onClick={() => runTest("snapshot")}
                      className="flex flex-col items-center justify-center p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 hover:bg-purple-50 dark:hover:bg-purple-950/40 hover:border-purple-300 dark:hover:border-purple-800 text-slate-700 dark:text-slate-200 transition-all disabled:opacity-50"
                    >
                      <Camera className="h-6 w-6 text-purple-500 mb-2" />
                      <span className="text-xs font-semibold">2. Fotograma en Vivo</span>
                      <span className="text-[10px] text-slate-400 mt-0.5">
                        Capturar snapshot del sensor de la cámara
                      </span>
                    </button>
                  </div>
                ) : (
                  /* ========================================================================= */
                  /* BOTONES DE PRUEBA PARA TERMINAL FACIAL Y OTROS ACCESOS                     */
                  /* ========================================================================= */
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <button
                      type="button"
                      disabled={!!busy || !status.agentOnline}
                      onClick={() => runTest("probe")}
                      className="flex flex-col items-center justify-center p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 hover:bg-blue-50 dark:hover:bg-blue-950/40 hover:border-blue-300 dark:hover:border-blue-800 text-slate-700 dark:text-slate-200 transition-all disabled:opacity-50"
                    >
                      <Radio className="h-5 w-5 text-blue-500 mb-1.5" />
                      <span className="text-xs font-semibold">1. Conexión</span>
                      <span className="text-[10px] text-slate-400">Modelo / SN</span>
                    </button>

                    <button
                      type="button"
                      disabled={!!busy || !status.agentOnline}
                      onClick={() => runTest("door_status")}
                      className="flex flex-col items-center justify-center p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 hover:bg-blue-50 dark:hover:bg-blue-950/40 hover:border-blue-300 dark:hover:border-blue-800 text-slate-700 dark:text-slate-200 transition-all disabled:opacity-50"
                    >
                      <Lock className="h-5 w-5 text-indigo-500 mb-1.5" />
                      <span className="text-xs font-semibold">2. Estado</span>
                      <span className="text-[10px] text-slate-400">Sensor puerta</span>
                    </button>

                    <button
                      type="button"
                      disabled={!!busy || !status.agentOnline || !canOpen}
                      onClick={() => runTest("open")}
                      className="flex flex-col items-center justify-center p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 hover:border-emerald-300 dark:hover:border-emerald-800 text-slate-700 dark:text-slate-200 transition-all disabled:opacity-50"
                    >
                      <Unlock className="h-5 w-5 text-emerald-500 mb-1.5" />
                      <span className="text-xs font-semibold">3. Apertura</span>
                      <span className="text-[10px] text-slate-400">Pulso relé</span>
                    </button>

                    <button
                      type="button"
                      disabled={!!busy || !status.agentOnline}
                      onClick={() => runTest("snapshot")}
                      className="flex flex-col items-center justify-center p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 hover:bg-purple-50 dark:hover:bg-purple-950/40 hover:border-purple-300 dark:hover:border-purple-800 text-slate-700 dark:text-slate-200 transition-all disabled:opacity-50"
                    >
                      <Camera className="h-5 w-5 text-purple-500 mb-1.5" />
                      <span className="text-xs font-semibold">4. Captura</span>
                      <span className="text-[10px] text-slate-400">Foto cámara</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Registro de Pruebas */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
                  Resultados del diagnóstico
                </p>
                {tests.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-8 text-center text-xs text-slate-400">
                    Presioná cualquiera de las pruebas anteriores para verificar el equipo.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {tests.map((trow, i) => (
                      <div
                        key={`${trow.action}-${i}`}
                        className={`rounded-xl border p-3.5 text-xs transition-colors ${
                          trow.ok
                            ? "border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/20"
                            : "border-rose-200 dark:border-rose-900/50 bg-rose-50/40 dark:bg-rose-950/20"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`inline-flex items-center gap-1 font-semibold ${
                              trow.ok ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
                            }`}
                          >
                            {trow.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                            {trow.ok ? "Prueba exitosa" : "Fallo en la prueba"} · {labelAction(trow.action, testingDevice.deviceType)}
                          </span>
                          <span className="text-slate-400 font-mono">{trow.timestamp}</span>
                        </div>
                        <p className="mt-1.5 text-slate-700 dark:text-slate-300 font-medium">
                          {trow.detail}
                        </p>
                        {trow.imageSrc && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={trow.imageSrc}
                            alt="Snapshot"
                            className="mt-3 max-h-56 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 px-6 py-4 flex justify-end">
              <button
                type="button"
                onClick={closeTestingModal}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shadow-sm"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function labelAction(action: string, deviceType?: string) {
  if (action === "probe") return deviceType === "camera_ip" ? "Conexión / Modelo IPC" : "1. Conexión / Modelo";
  if (action === "door_status") return "2. Estado de puerta";
  if (action === "open") return "3. Apertura de puerta";
  if (action === "snapshot") return deviceType === "camera_ip" ? "Captura fotograma en vivo" : "4. Captura de foto";
  return action;
}
