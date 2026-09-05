"use client";

import React, { useState, useEffect } from "react";
import { FeatureGate, PageHeader } from "@/components/PageHeader";
import { QrCode, Shield, CheckCircle2, AlertCircle, RefreshCw, Smartphone, Key, Settings, Zap } from "lucide-react";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { useToast } from "@/components/Toast";
import { useTheme } from "@/components/ThemeProvider";

export default function DahuaQrPage() {
  const { tenantId } = useDash();
  const { theme } = useTheme();
  const toast = useToast();
  const [device, setDevice] = useState<{ id: string; name: string } | null>(null);
  const [qrConfig, setQrConfig] = useState<{ transmissionEnable: boolean; validTime: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Test QR generator state
  const [testPayload, setTestPayload] = useState("B2FC3764");
  const [qrSvgUrl, setQrSvgUrl] = useState<string>("");

  function t(path: string) {
    return withTenant(path, tenantId);
  }

  useEffect(() => {
    if (tenantId) {
      loadDeviceAndConfig();
    }
  }, [tenantId]);

  useEffect(() => {
    if (testPayload.trim()) {
      // Generate QR code SVG data URL or dynamic URL adaptive to theme
      const encoded = encodeURIComponent(testPayload.trim());
      const isDark = theme === "dark";
      const color = isDark ? "00f0ff" : "0f172a";
      const bgcolor = isDark ? "0b0f17" : "ffffff";
      setQrSvgUrl(`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encoded}&format=svg&color=${color}&bgcolor=${bgcolor}`);
    }
  }, [testPayload, theme]);

  const [devices, setDevices] = useState<Array<{ id: string; name: string; host?: string; deviceType?: string }>>([]);

  const loadDeviceAndConfig = async (targetDeviceId?: string) => {
    if (!tenantId) return;
    setLoading(true);
    setMessage(null);
    try {
      const devData = await api<{ devices?: Array<{ id: string; name: string; host?: string; deviceType?: string }> }>(t("/api/hardware/dahua"));
      const accessDevs = (devData.devices || []).filter((d) => d.deviceType !== "camera_ip");
      setDevices(accessDevs);
      const chosen = accessDevs.find((d) => d.id === targetDeviceId) || accessDevs[0];
      if (!chosen) {
        setMessage("No se encontró ningún terminal de acceso Dahua (lector facial / ASI) configurado.");
        setDevice(null);
        setLoading(false);
        return;
      }
      setDevice(chosen);

      const cfg = await api<{ transmissionEnable?: boolean; validTime?: number }>(
        t(`/api/hardware/dahua/${chosen.id}/qr-config`)
      );
      setQrConfig({
        transmissionEnable: Boolean(cfg.transmissionEnable),
        validTime: Number(cfg.validTime) || 15,
      });
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Error al consultar configuración");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = async (newEnable: boolean, newTime: number) => {
    if (!device || !tenantId) return;
    setSaving(true);
    setMessage(null);
    try {
      const data = await api<{ ok: boolean; error?: string }>(t(`/api/hardware/dahua/${device.id}/qr-config`), {
        method: "POST",
        body: JSON.stringify({
          transmissionEnable: newEnable,
          validTime: newTime,
        }),
      });
      if (!data.ok) throw new Error(data.error || "No se pudo actualizar la configuración");
      setQrConfig({ transmissionEnable: newEnable, validTime: newTime });
      setMessage("Configuración del lector QR guardada exitosamente en el terminal Dahua.");
      toast.success("Configuración guardada", "Parámetros del lector QR aplicados en el terminal ASI.");
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Error al guardar";
      setMessage(errMsg);
      toast.error("Error de guardado", errMsg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <FeatureGate feature="dahua.qr" capability="dahua.qr">
      <PageHeader
        title="Control de Códigos QR"
        subtitle="Habilitación, validación y prueba de lectura de códigos QR en el terminal ASI."
      />

      <div className="space-y-6 max-w-5xl">
        {message && (
          <div className="p-4 rounded-xl border border-cyan-200 dark:border-cyan-800/40 bg-cyan-50 dark:bg-cyan-950/30 text-cyan-900 dark:text-cyan-200 text-sm flex items-center justify-between">
            <span>{message}</span>
            <button onClick={() => setMessage(null)} className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline">
              Cerrar
            </button>
          </div>
        )}

        {/* Hardware Status & Controls */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <div className="md:col-span-6 bg-white dark:bg-[#111827] border border-slate-200 dark:border-[#1f2937] rounded-xl p-5 shadow-sm flex flex-col justify-between transition-colors">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-[#1f2937]">
                <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold">
                  <Settings className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
                  <span>Configuración en Lector ASI</span>
                </div>
                <button
                  onClick={() => loadDeviceAndConfig()}
                  disabled={loading}
                  className="p-1.5 text-slate-400 hover:text-slate-800 dark:hover:text-white rounded hover:bg-slate-100 dark:hover:bg-[#1f2937] transition-colors"
                  title="Recargar"
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>

              <div className="space-y-5 mt-5">
                {devices.length > 1 ? (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Terminal seleccionada:
                    </label>
                    <select
                      value={device?.id ?? ""}
                      onChange={(e) => loadDeviceAndConfig(e.target.value)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    >
                      {devices.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.host})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                {/* Transmission Switch */}
                <div className="flex items-start justify-between gap-4 p-3 bg-slate-50 dark:bg-[#0b0f17] border border-slate-200 dark:border-[#1f2937] rounded-lg transition-colors">
                  <div>
                    <div className="font-medium text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      Lectura y Transmisión de QR
                      {qrConfig?.transmissionEnable ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-950/50 px-2 py-0.5 rounded-full border border-emerald-300 dark:border-emerald-800/50">
                          <CheckCircle2 className="w-3 h-3" /> ACTIVO
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/50 px-2 py-0.5 rounded-full border border-amber-300 dark:border-amber-800/50">
                          <AlertCircle className="w-3 h-3" /> INACTIVO
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Habilita el procesador óptico de la cámara para capturar y cotejar códigos QR contra las tarjetas autorizadas.
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={saving || !qrConfig}
                    onClick={() => handleSaveConfig(!qrConfig?.transmissionEnable, qrConfig?.validTime || 15)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      qrConfig?.transmissionEnable ? "bg-cyan-600" : "bg-slate-300 dark:bg-slate-700"
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        qrConfig?.transmissionEnable ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* Valid Time Input */}
                <div className="p-3 bg-slate-50 dark:bg-[#0b0f17] border border-slate-200 dark:border-[#1f2937] rounded-lg transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                      Tiempo de Validez de Lectura (segundos)
                    </label>
                    <span className="text-xs font-mono font-bold text-cyan-600 dark:text-cyan-400">
                      {qrConfig?.validTime || 15}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min="5"
                    max="60"
                    step="5"
                    value={qrConfig?.validTime || 15}
                    onChange={(e) =>
                      setQrConfig((prev) => prev ? { ...prev, validTime: Number(e.target.value) } : null)
                    }
                    className="w-full h-2 bg-slate-200 dark:bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-600"
                  />
                  <div className="flex justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    <span>5 seg</span>
                    <span>15 seg (recomendado)</span>
                    <span>60 seg</span>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    disabled={saving || !qrConfig}
                    onClick={() => handleSaveConfig(qrConfig?.transmissionEnable || false, qrConfig?.validTime || 15)}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium rounded-lg transition-colors shadow disabled:opacity-50 flex items-center gap-1.5"
                  >
                    <Zap className="w-4 h-4" />
                    {saving ? "Guardando en Dahua..." : "Aplicar al terminal"}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-200 dark:border-[#1f2937] text-xs text-slate-500 dark:text-slate-400 space-y-1">
              <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300 font-medium">
                <Shield className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                <span>Mapeo Técnico</span>
              </div>
              <p>
                El lector ASI lee el contenido del QR y busca coincidencia con el campo <strong className="text-slate-900 dark:text-slate-200">CardNo</strong> del usuario. Si coincide y el período está vigente, ejecuta la apertura del relé.
              </p>
            </div>
          </div>

          {/* QR Code Generator & Tester */}
          <div className="md:col-span-6 bg-white dark:bg-[#111827] border border-slate-200 dark:border-[#1f2937] rounded-xl p-5 shadow-sm flex flex-col justify-between transition-colors">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-[#1f2937]">
                <div className="flex items-center gap-2 text-slate-900 dark:text-white font-semibold">
                  <QrCode className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
                  <span>Generador y Probador de QR</span>
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400">Prueba en vivo</span>
              </div>

              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Payload del Código QR (CardNo o Token)
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={testPayload}
                      onChange={(e) => setTestPayload(e.target.value)}
                      placeholder="Ej: B2FC3764"
                      className="w-full bg-slate-50 dark:bg-[#0b0f17] border border-slate-300 dark:border-[#2b354c] rounded-lg px-3 py-2 text-sm text-slate-900 dark:text-white font-mono focus:outline-none focus:border-cyan-500 transition-colors"
                    />
                    <Key className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Ingrese el número de tarjeta del usuario para verificar la apertura frente al lente.
                  </p>
                </div>

                <div className="flex flex-col items-center justify-center p-6 bg-slate-50 dark:bg-[#0b0f17] border border-slate-200 dark:border-[#1f2937] rounded-xl transition-colors">
                  {qrSvgUrl ? (
                    <div className="p-3 bg-white rounded-xl shadow-md border border-slate-200 dark:border-cyan-900/50">
                      <img
                        src={qrSvgUrl}
                        alt="Código QR de Prueba"
                        className="w-48 h-48 rounded"
                      />
                    </div>
                  ) : (
                    <div className="w-48 h-48 flex items-center justify-center text-xs text-slate-400">
                      Ingrese un valor para generar el QR
                    </div>
                  )}

                  <div className="mt-3 text-center">
                    <div className="text-xs font-mono font-bold text-cyan-700 dark:text-cyan-400">{testPayload}</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Presentar este código a 20-30 cm de la cámara del ASI
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-200 dark:border-[#1f2937] flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
              <span className="flex items-center gap-1">
                <Smartphone className="w-4 h-4 text-slate-400" /> Compatible con pantalla de celular
              </span>
              <a
                href={qrSvgUrl}
                target="_blank"
                rel="noreferrer"
                className="text-cyan-600 dark:text-cyan-400 hover:underline font-medium"
              >
                Abrir en pantalla completa
              </a>
            </div>
          </div>
        </div>
      </div>
    </FeatureGate>
  );
}
