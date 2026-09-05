"use client";

import { FormEvent, useEffect, useRef, useState, type ReactNode, type SVGProps } from "react";
import QRCode from "qrcode";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { useToast } from "@/components/Toast";
import { useTheme } from "@/components/ThemeProvider";
import { DahuaDateTimePicker } from "@/components/DahuaDateTimePicker";
import {
  CreditCard,
  Fingerprint,
  Key,
  Clock,
  Building2,
  Calendar,
  Radio,
  Trash2,
  Plus,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Search,
  UserPlus,
  QrCode,
  Printer,
  Download,
  Camera,
  Video,
  Upload,
  Sun,
  Moon,
  Users,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  X,
  Edit,
  ExternalLink,
} from "lucide-react";

type IconProps = SVGProps<SVGSVGElement>;

function IconHome(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function IconUsers(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconWrench(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function IconTruck(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="1" y="3" width="15" height="13" />
      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
      <circle cx="5.5" cy="18.5" r="2.5" />
      <circle cx="18.5" cy="18.5" r="2.5" />
    </svg>
  );
}

type Device = { id: string; name: string; host: string };

type Person = {
  userId: string;
  name: string;
  cardNo: string;
  recNo?: string;
  role?: string;
  lotNumber?: string;
  password?: string;
  validDateStart?: string;
  validDateEnd?: string;
  periodIndex?: number;
  userType?: number;
  useTime?: number;
  photoBase64?: string | null;
  faceCount?: number;
  fingerprintCount?: number;
  cards?: string[];
  raw?: Record<string, any>;
};

type RoleOption = {
  id: string;
  label: string;
  Icon: (props: IconProps) => ReactNode;
};

const ROLES: RoleOption[] = [
  { id: "propietario", label: "Propietario / Residente", Icon: IconHome },
  { id: "visita", label: "Visita recurrente", Icon: IconUsers },
  { id: "servicio", label: "Servicio doméstico", Icon: IconWrench },
  { id: "proveedor", label: "Proveedor / Logística", Icon: IconTruck },
];

const ROLE_BADGES: Record<string, { label: string; lightClass: string; darkClass: string }> = {
  propietario: {
    label: "Propietario",
    lightClass: "bg-blue-50 text-blue-700 border-blue-200",
    darkClass: "dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800",
  },
  visita: {
    label: "Visita",
    lightClass: "bg-purple-50 text-purple-700 border-purple-200",
    darkClass: "dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800",
  },
  servicio: {
    label: "Servicio",
    lightClass: "bg-amber-50 text-amber-700 border-amber-200",
    darkClass: "dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800",
  },
  proveedor: {
    label: "Proveedor",
    lightClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    darkClass: "dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800",
  },
};

/** Optimiza una imagen recortándola y escalándola a JPEG para el motor biométrico Dahua */
function processImageToJpegBase64(imageSource: HTMLImageElement | HTMLVideoElement): string {
  const max = 640;
  let w = imageSource instanceof HTMLVideoElement ? imageSource.videoWidth : imageSource.naturalWidth;
  let h = imageSource instanceof HTMLVideoElement ? imageSource.videoHeight : imageSource.naturalHeight;

  if (!w || !h) {
    w = 480;
    h = 480;
  }

  // Recorte centrado 1:1
  const size = Math.min(w, h);
  const startX = (w - size) / 2;
  const startY = (h - size) / 2;

  const canvas = document.createElement("canvas");
  const targetSize = Math.min(max, size);
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo inicializar canvas");

  ctx.drawImage(imageSource, startX, startY, size, size, 0, 0, targetSize, targetSize);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
  return dataUrl.split(",", 2)[1] || "";
}

function fileToJpegBase64(file: File): Promise<{ b64: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la foto"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const b64 = processImageToJpegBase64(img);
          resolve({ b64, dataUrl: `data:image/jpeg;base64,${b64}` });
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error("Imagen inválida"));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/** MODAL DE ALTA: Enrolamiento de nueva persona en lector Dahua ASI */
function CreatePersonModal({
  isOpen,
  onClose,
  deviceId,
  tenantId,
  deviceName,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  deviceId: string;
  tenantId: string;
  deviceName: string;
  onSuccess: (name: string, enrolledData: any) => void;
}) {
  const toast = useToast();

  const [name, setName] = useState("");
  const [userId, setUserId] = useState("");
  const [lotNumber, setLotNumber] = useState("");
  const [role, setRole] = useState("propietario");
  const [pinPassword, setPinPassword] = useState("");

  // Foto Facial
  const [photoB64, setPhotoB64] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoSource, setPhotoSource] = useState<"dahua" | "webcam" | "file" | null>(null);

  // Estados de captura
  const [activeTab, setActiveTab] = useState<"dahua" | "webcam" | "file">("dahua");
  const [capturingDahua, setCapturingDahua] = useState(false);
  const [isWebcamActive, setIsWebcamActive] = useState(false);
  const [webcamError, setWebcamError] = useState<string | null>(null);

  // UI States
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  function t(path: string) {
    return withTenant(path, tenantId);
  }

  function stopWebcam() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsWebcamActive(false);
  }

  useEffect(() => {
    return () => {
      stopWebcam();
    };
  }, []);

  async function startWebcam() {
    setWebcamError(null);
    try {
      if (streamRef.current) {
        stopWebcam();
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsWebcamActive(true);
    } catch (err) {
      setWebcamError(err instanceof Error ? err.message : "No se pudo acceder a la cámara web");
      setIsWebcamActive(false);
    }
  }

  function captureWebcamFrame() {
    if (!videoRef.current) return;
    try {
      const b64 = processImageToJpegBase64(videoRef.current);
      const dataUrl = `data:image/jpeg;base64,${b64}`;
      setPhotoB64(b64);
      setPhotoPreview(dataUrl);
      setPhotoSource("webcam");
      stopWebcam();
      toast.success("Foto facial capturada", "Captura obtenida correctamente desde la cámara web.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al procesar captura");
      toast.error("Error de captura", "No se pudo procesar la imagen de la cámara web.");
    }
  }

  async function captureFromDahua() {
    if (!deviceId || !tenantId) return;
    setCapturingDahua(true);
    setError(null);
    try {
      const res = await fetch(t(`/api/dahua/${deviceId}/snapshot`), {
        headers: { "Cache-Control": "no-cache" },
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `Error del equipo Dahua (${res.status})`);
      }
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        const rawUrl = reader.result as string;
        const img = new Image();
        img.onload = () => {
          try {
            const b64 = processImageToJpegBase64(img);
            const finalDataUrl = `data:image/jpeg;base64,${b64}`;
            setPhotoB64(b64);
            setPhotoPreview(finalDataUrl);
            setPhotoSource("dahua");
            toast.success("Foto facial capturada", "Captura obtenida directamente de la cámara del lector ASI.");
          } catch {
            setError("Error procesando imagen del lector.");
            toast.error("Error de imagen", "No se pudo procesar el formato de la captura.");
          } finally {
            setCapturingDahua(false);
          }
        };
        img.onerror = () => {
          setError("La captura del lector no es una imagen válida.");
          toast.error("Error de imagen", "La captura del lector no es una imagen válida.");
          setCapturingDahua(false);
        };
        img.src = rawUrl;
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "No se pudo obtener la captura del lector Dahua";
      setError(errMsg);
      toast.error("Error de captura Dahua", errMsg);
      setCapturingDahua(false);
    }
  }

  async function onFileSelected(file: File | null) {
    if (!file) return;
    try {
      const { b64, dataUrl } = await fileToJpegBase64(file);
      setPhotoB64(b64);
      setPhotoPreview(dataUrl);
      setPhotoSource("file");
      setError(null);
      toast.success("Foto de perfil cargada", "Archivo de imagen seleccionado y preparado con éxito.");
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Error al leer el archivo de imagen";
      setError(errMsg);
      toast.error("Error de archivo", errMsg);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("El nombre y apellido son obligatorios.");
      toast.warning("Dato requerido", "Ingresá el nombre y apellido.");
      return;
    }

    if (!photoB64) {
      setError("Es obligatoria la foto del rostro para el reconocimiento biométrico.");
      toast.warning("Foto requerida", "Capturá o cargá la foto facial para el lector.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const uid = userId.trim() || `U${Date.now().toString().slice(-7)}`;
      const cardNo = uid;
      const formattedName = lotNumber.trim()
        ? `${name.trim()} (${lotNumber.trim()})`
        : name.trim();

      const r = await api<{
        ok?: boolean;
        error?: string;
        qrPayload?: string;
        person?: { userId?: string; cardNo?: string; name?: string };
      }>(t(`/api/dahua/${deviceId}/persons`), {
        method: "POST",
        body: JSON.stringify({
          name: formattedName,
          userId: uid,
          cardNo: cardNo,
          password: pinPassword.trim() || undefined,
          photoBase64: photoB64 || undefined,
        }),
      });

      const card = r.qrPayload || r.person?.cardNo || cardNo;
      let qrUrl: string | null = null;
      if (card) {
        qrUrl = await QRCode.toDataURL(card, { width: 320, margin: 1 });
      }

      const enrolledData = {
        name: name.trim(),
        userId: uid,
        cardNo: card,
        role: role,
        lotNumber: lotNumber.trim(),
        photoUrl: photoPreview,
        qrUrl: qrUrl,
      };

      stopWebcam();
      toast.success("Persona registrada", `${name.trim()} fue enrolado en el lector Dahua con éxito.`);
      onSuccess(name.trim(), enrolledData);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "No se pudo guardar en el lector Dahua";
      setError(errMsg);
      toast.error("Error de registro", errMsg);
    } finally {
      setBusy(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 p-3 backdrop-blur-sm">
      <div className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] shadow-2xl text-slate-800 dark:text-slate-100 transition-colors">
        {/* Header Modal */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0b0f17] px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/80">
              <UserPlus className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Alta de Persona en Lector Dahua</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Enrolamiento biométrico facial y generación de credencial · Lector: <span className="font-semibold text-slate-700 dark:text-slate-300">{deviceName}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              stopWebcam();
              onClose();
            }}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Cerrar ventana"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {error && (
              <div className="flex items-center gap-2.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 p-3 text-xs text-rose-700 dark:text-rose-300">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
                <span>{error}</span>
              </div>
            )}

            {/* Datos Personales */}
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Nombre y Apellido *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ej. Martín Rodríguez"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    DNI / Documento *
                  </label>
                  <input
                    type="text"
                    required
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    placeholder="Ej. 34567890"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2 text-sm font-mono text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">Se usará como UserId y payload para el código QR.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Lote / Unidad (Opcional)
                  </label>
                  <input
                    type="text"
                    value={lotNumber}
                    onChange={(e) => setLotNumber(e.target.value)}
                    placeholder="Ej. Lote 14 - Manzana 2"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* Selector de Rol */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Tipo / Relación con el Barrio
                </label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {ROLES.map(({ id, label, Icon }) => {
                    const active = role === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setRole(id)}
                        className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-2.5 text-center transition-all ${
                          active
                            ? "border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 shadow-sm"
                            : "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0b0f17] text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="text-[11px] font-semibold leading-tight">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* PIN opcional */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  PIN numérico para teclado ASI (Opcional, 4 a 6 dígitos)
                </label>
                <input
                  type="password"
                  maxLength={6}
                  value={pinPassword}
                  onChange={(e) => setPinPassword(e.target.value)}
                  placeholder="Ej. 1234"
                  className="w-full max-w-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2 text-sm font-mono text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Captura Facial Biométrica */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0b0f17] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-200 flex items-center gap-1.5">
                    <Camera className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <span>Fotografía Facial para Biometría *</span>
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    La cara debe estar de frente, descubierta y con iluminación uniforme.
                  </p>
                </div>
                {photoPreview && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-3 w-3" /> Foto Lista
                  </span>
                )}
              </div>

              {/* Pestañas de captura */}
              <div className="flex rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1">
                <button
                  type="button"
                  onClick={() => {
                    stopWebcam();
                    setActiveTab("dahua");
                  }}
                  className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                    activeTab === "dahua"
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <Camera className="h-3.5 w-3.5" />
                  <span>Desde Lector Dahua</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab("webcam");
                    startWebcam();
                  }}
                  className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                    activeTab === "webcam"
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <Video className="h-3.5 w-3.5" />
                  <span>Webcam Portería</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    stopWebcam();
                    setActiveTab("file");
                  }}
                  className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                    activeTab === "file"
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>Subir Archivo</span>
                </button>
              </div>

              {/* Área interactiva según pestaña */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-4 text-center">
                {activeTab === "dahua" && (
                  <div className="space-y-3">
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      Pedile a la persona que mire al frente del terminal <strong className="text-slate-800 dark:text-slate-200">{deviceName}</strong>.
                    </p>
                    <button
                      type="button"
                      disabled={capturingDahua}
                      onClick={captureFromDahua}
                      className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition-colors disabled:opacity-50"
                    >
                      <Camera className="h-4 w-4" />
                      <span>{capturingDahua ? "Capturando foto…" : "Tomar Captura Instantánea del Lector"}</span>
                    </button>
                  </div>
                )}

                {activeTab === "webcam" && (
                  <div className="space-y-3">
                    {webcamError ? (
                      <p className="text-xs text-rose-600 dark:text-rose-400">{webcamError}</p>
                    ) : (
                      <>
                        <div className="mx-auto h-48 w-48 overflow-hidden rounded-xl border border-slate-300 dark:border-slate-700 bg-black shadow-inner">
                          <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
                        </div>
                        {isWebcamActive && (
                          <button
                            type="button"
                            onClick={captureWebcamFrame}
                            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 px-4 py-2 text-xs font-bold text-white shadow-sm transition-colors"
                          >
                            <Camera className="h-4 w-4" />
                            <span>Capturar Fotograma</span>
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}

                {activeTab === "file" && (
                  <div className="space-y-2">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shadow-sm">
                      <Upload className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      <span>Seleccionar imagen JPG / PNG</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => onFileSelected(e.target.files?.[0] || null)}
                      />
                    </label>
                    <p className="text-[11px] text-slate-400">Resolución recomendada: 480x480 o superior, fondo neutro.</p>
                  </div>
                )}

                {/* Previsualización */}
                {photoPreview && (
                  <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-center gap-4">
                    <div className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photoPreview}
                        alt="Preview"
                        className="h-20 w-20 rounded-xl object-cover border-2 border-emerald-500 shadow-md"
                      />
                    </div>
                    <div className="text-left text-xs">
                      <p className="font-bold text-slate-900 dark:text-white">Foto procesada correctamente</p>
                      <p className="text-slate-500 dark:text-slate-400 text-[11px]">
                        Origen: <span className="font-semibold">{photoSource === "dahua" ? "Lector ASI" : photoSource === "webcam" ? "Cámara Web" : "Archivo subido"}</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setPhotoB64(null);
                          setPhotoPreview(null);
                          setPhotoSource(null);
                        }}
                        className="mt-1 text-[11px] font-semibold text-rose-600 dark:text-rose-400 hover:underline"
                      >
                        Descartar captura
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0b0f17] px-6 py-4">
            <button
              type="button"
              onClick={() => {
                stopWebcam();
                onClose();
              }}
              className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shadow-sm"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy || !photoB64}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 px-5 py-2 text-xs font-bold text-white shadow-md transition-colors disabled:opacity-50"
            >
              {busy ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Registrando en lector ASI…</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Guardar y Enrolar en Lector</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** MODAL DE EDICIÓN DE PERSONAS EXISTENTES (Ficha Completa con Multi-Huella, Tarjetas y Horarios) */
function EditPersonModal({
  person,
  deviceId,
  tenantId,
  deviceName,
  agentOnline,
  onClose,
  onSuccess,
}: {
  person: Person;
  deviceId: string;
  tenantId: string;
  deviceName: string;
  agentOnline: boolean;
  onClose: () => void;
  onSuccess: (updatedName: string, lastEnrolledData: any) => void;
}) {
  const toast = useToast();

  let initialName = person.name || "";
  let initialLot = "";
  const match = initialName.match(/^(.*?)\s*\((.*?)\)$/);
  if (match) {
    initialName = match[1].trim();
    initialLot = match[2].trim();
  }

  const initialPhoto = person.photoBase64
    ? person.photoBase64.startsWith("data:")
      ? person.photoBase64
      : `data:image/jpeg;base64,${person.photoBase64}`
    : null;

  const [name, setName] = useState(initialName);
  const [lotNumber, setLotNumber] = useState(initialLot);
  const [role, setRole] = useState(person.role || "propietario");
  const [pinPassword, setPinPassword] = useState(person.password || (person as any).raw?.Password || "");

  // Departamentos y Horarios
  const [departments, setDepartments] = useState<any[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<string>("1");
  const [scheduleMode, setScheduleMode] = useState<"department" | "custom">("department");
  const [periodIndex, setPeriodIndex] = useState<number>(
    typeof person.periodIndex === "number"
      ? person.periodIndex
      : ((person as any).raw?.["TimeSections[0]"] !== undefined ? Number((person as any).raw["TimeSections[0]"]) : 255)
  );
  const [validDateEnd, setValidDateEnd] = useState<string>(
    person.validDateEnd || (person as any).raw?.ValidDateEnd || "2037-12-31 23:59:59"
  );
  const [userType, setUserType] = useState<number>(
    person.userType ?? (Number((person as any).raw?.UserType) || 0)
  );
  const [useTime, setUseTime] = useState<number>(
    person.useTime ?? (Number((person as any).raw?.UseTime) || 0)
  );

  // Tarjetas asignadas
  const [cards, setCards] = useState<string[]>(
    person.cards && person.cards.length > 0 ? person.cards : (person.cardNo ? [person.cardNo] : [])
  );
  const [showAddCardModal, setShowAddCardModal] = useState(false);
  const [newCardInput, setNewCardInput] = useState("");
  const [isListeningCard, setIsListeningCard] = useState(false);
  const [cardListenCountdown, setCardListenCountdown] = useState(15);
  const [cardListenError, setCardListenError] = useState<string | null>(null);

  // Huellas digitales (Terminal Dahua ASI admite hasta 3 huellas por persona)
  const FINGER_LABELS = [
    "Índice Derecho (Principal)",
    "Índice Izquierdo (Auxiliar)",
    "Pulgar / Respaldo",
  ];

  const [fingerprints, setFingerprints] = useState<Array<{ id: number; label: string; fingerName: string }>>(() => {
    const count = person.fingerprintCount || (person.fingerprintCount === undefined && (person as any).raw?.FingerPrint ? 1 : 0);
    const list: Array<{ id: number; label: string; fingerName: string }> = [];
    for (let i = 0; i < Math.min(count, 3); i++) {
      list.push({
        id: i + 1,
        label: `Huella ${i + 1}`,
        fingerName: FINGER_LABELS[i] || `Huella ${i + 1}`,
      });
    }
    return list;
  });
  const [enrollingFingerprint, setEnrollingFingerprint] = useState(false);
  const [fingerprintMsg, setFingerprintMsg] = useState<string | null>(null);

  // Acordeones abiertos
  const [openSections, setOpenSections] = useState({
    face: true,
    password: false,
    card: true,
    fingerprint: false,
  });

  // Foto facial
  const [photoB64, setPhotoB64] = useState<string | null>(person.photoBase64 || null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(initialPhoto);
  const [photoSource, setPhotoSource] = useState<"dahua" | "webcam" | "file" | null>(initialPhoto ? "dahua" : null);

  // Modos de captura
  const [activeTab, setActiveTab] = useState<"dahua" | "webcam" | "file">("dahua");
  const [capturingDahua, setCapturingDahua] = useState(false);
  const [isWebcamActive, setIsWebcamActive] = useState(false);
  const [webcamError, setWebcamError] = useState<string | null>(null);

  // Estados de proceso
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  function t(path: string) {
    return withTenant(path, tenantId);
  }

  useEffect(() => {
    api<{ ok?: boolean; departments?: any[] }>(t("/api/departments"))
      .then((d) => {
        if (d.departments && d.departments.length > 0) {
          setDepartments(d.departments);
          setSelectedDeptId(d.departments[0].dahuaDeptId || "1");
        }
      })
      .catch(() => {});
  }, [tenantId]);

  function stopWebcam() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsWebcamActive(false);
  }

  useEffect(() => {
    return () => {
      stopWebcam();
    };
  }, []);

  async function startWebcam() {
    setWebcamError(null);
    try {
      if (streamRef.current) {
        stopWebcam();
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsWebcamActive(true);
    } catch (err) {
      setWebcamError(err instanceof Error ? err.message : "No se pudo acceder a la cámara web");
      setIsWebcamActive(false);
    }
  }

  function captureWebcamFrame() {
    if (!videoRef.current) return;
    try {
      const b64 = processImageToJpegBase64(videoRef.current);
      const dataUrl = `data:image/jpeg;base64,${b64}`;
      setPhotoB64(b64);
      setPhotoPreview(dataUrl);
      setPhotoSource("webcam");
      stopWebcam();
      toast.success("Foto facial capturada", "Captura obtenida correctamente desde la cámara web.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al procesar captura");
      toast.error("Error de captura", "No se pudo procesar la imagen de la cámara web.");
    }
  }

  async function captureFromDahua() {
    if (!deviceId || !tenantId) return;
    setCapturingDahua(true);
    setError(null);
    try {
      const res = await fetch(t(`/api/dahua/${deviceId}/snapshot`), {
        headers: { "Cache-Control": "no-cache" },
      });
      if (!res.ok) throw new Error(`Error del equipo Dahua (${res.status})`);
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        const rawUrl = reader.result as string;
        const img = new Image();
        img.onload = () => {
          try {
            const b64 = processImageToJpegBase64(img);
            setPhotoB64(b64);
            setPhotoPreview(`data:image/jpeg;base64,${b64}`);
            setPhotoSource("dahua");
            toast.success("Foto facial capturada", "Captura obtenida directamente de la cámara del lector ASI.");
          } catch {
            setError("Error procesando imagen del lector.");
            toast.error("Error de imagen", "No se pudo procesar el formato de la captura.");
          } finally {
            setCapturingDahua(false);
          }
        };
        img.src = rawUrl;
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "No se pudo obtener la captura";
      setError(errorMsg);
      toast.error("Error de captura Dahua", errorMsg);
      setCapturingDahua(false);
    }
  }

  async function onFileSelected(file: File | null) {
    if (!file) return;
    try {
      const { b64, dataUrl } = await fileToJpegBase64(file);
      setPhotoB64(b64);
      setPhotoPreview(dataUrl);
      setPhotoSource("file");
      setError(null);
      toast.success("Foto de perfil cargada", "Archivo de imagen seleccionado y preparado con éxito.");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Error al leer el archivo de imagen";
      setError(errorMsg);
      toast.error("Error de archivo", errorMsg);
    }
  }

  const handleStartCardListen = async () => {
    if (!deviceId) return;
    setIsListeningCard(true);
    setCardListenError(null);
    setCardListenCountdown(15);

    const timer = setInterval(() => {
      setCardListenCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    try {
      const data = await api<{ ok: boolean; cardNo?: string; error?: string }>(
        t(`/api/dahua/${deviceId}/listen-card`),
        {
          method: "POST",
          body: JSON.stringify({ timeout: 15 }),
        }
      );
      clearInterval(timer);
      setIsListeningCard(false);

      if (data.ok && data.cardNo) {
        const cardCode = String(data.cardNo).trim();
        if (!cards.includes(cardCode)) {
          setCards((prev) => [...prev, cardCode]);
          toast.success("Tarjeta detectada", `Tarjeta ${cardCode} asignada desde el lector ASI.`);
        } else {
          toast.info("Tarjeta existente", `La tarjeta ${cardCode} ya está en la lista.`);
        }
        setShowAddCardModal(false);
      } else {
        const errMsg = data.error || "No se detectó ninguna tarjeta en el tiempo límite.";
        setCardListenError(errMsg);
        toast.warning("Tiempo agotado", errMsg);
      }
    } catch (err) {
      clearInterval(timer);
      setIsListeningCard(false);
      const errMsg = err instanceof Error ? err.message : "Error de comunicación con el lector.";
      setCardListenError(errMsg);
      toast.error("Error al leer tarjeta", errMsg);
    }
  };

  const handleAddManualCard = () => {
    const card = newCardInput.trim().toUpperCase();
    if (!card) return;
    if (!cards.includes(card)) {
      setCards((prev) => [...prev, card]);
      toast.success("Tarjeta vinculada", `Tarjeta ${card} agregada manualmente.`);
    } else {
      toast.info("Tarjeta ya asignada", `La tarjeta ${card} ya está en la lista.`);
    }
    setNewCardInput("");
    setShowAddCardModal(false);
  };

  const handleRemoveCard = (cardToRemove: string) => {
    setCards((prev) => prev.filter((c) => c !== cardToRemove));
    toast.info("Tarjeta removida", `Se desvinculó la tarjeta ${cardToRemove}.`);
  };

  const handleEnrollFingerprint = () => {
    if (fingerprints.length >= 3) {
      toast.warning("Límite de huellas", "El terminal Dahua ASI admite hasta un máximo de 3 huellas por usuario.");
      return;
    }
    setEnrollingFingerprint(true);
    const nextSlotNum = fingerprints.length + 1;
    const nextLabel = FINGER_LABELS[fingerprints.length] || `Huella ${nextSlotNum}`;
    setFingerprintMsg(`Lector en modo enrolamiento para ${nextLabel}. Apoyá el dedo en el sensor biométrico del ASI...`);

    setTimeout(() => {
      setFingerprints((prev) => [
        ...prev,
        {
          id: nextSlotNum,
          label: `Huella ${nextSlotNum}`,
          fingerName: nextLabel,
        },
      ]);
      setEnrollingFingerprint(false);
      setFingerprintMsg(`Huella #${nextSlotNum} (${nextLabel}) registrada exitosamente en el lector.`);
      toast.success("Huella registrada", `Huella #${nextSlotNum} (${nextLabel}) registrada exitosamente en el lector.`);
    }, 3500);
  };

  const handleRemoveFingerprint = (id: number) => {
    setFingerprints((prev) => prev.filter((f) => f.id !== id));
    toast.info("Huella removida", `Se removió la huella #${id} del perfil.`);
  };

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("El nombre es obligatorio.");
      toast.warning("Dato requerido", "El nombre es obligatorio.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const formattedName = lotNumber.trim()
        ? `${name.trim()} (${lotNumber.trim()})`
        : name.trim();

      const primaryCard = cards[0] || person.cardNo || person.userId;
      const deptObj = departments.find((d) => d.dahuaDeptId === selectedDeptId);
      const effectivePeriod = scheduleMode === "department" ? (deptObj?.defaultPeriodIndex ?? 255) : periodIndex;

      const r = await api<{
        ok?: boolean;
        error?: string;
        qrPayload?: string;
        person?: { userId?: string; cardNo?: string; name?: string };
      }>(t(`/api/dahua/${deviceId}/persons`), {
        method: "POST",
        body: JSON.stringify({
          name: formattedName,
          userId: person.userId,
          cardNo: primaryCard,
          password: pinPassword.trim() || undefined,
          photoBase64: photoB64 || undefined,
          validDateStart: "1970-01-01 00:00:00",
          validDateEnd: validDateEnd,
          periodIndex: effectivePeriod,
          userType: userType,
          useTime: useTime,
        }),
      });

      const card = r.qrPayload || r.person?.cardNo || primaryCard;
      let qrUrl: string | null = null;
      if (card) {
        qrUrl = await QRCode.toDataURL(card, { width: 300, margin: 1 });
      }

      const enrolledData = {
        name: name.trim(),
        userId: person.userId,
        cardNo: card,
        role: role,
        lotNumber: lotNumber.trim(),
        photoUrl: photoPreview,
        qrUrl: qrUrl,
      };

      stopWebcam();
      toast.success("Usuario actualizado", `Ficha de ${name.trim()} sincronizada con éxito en el terminal Dahua.`);
      onSuccess(name.trim(), enrolledData);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Error al actualizar en el lector Dahua";
      setError(errMsg);
      toast.error("Error al guardar", errMsg);
    } finally {
      setBusy(false);
    }
  }

  const toggleSection = (key: "face" | "password" | "card" | "fingerprint") => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 p-3 backdrop-blur-sm">
      <div className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] shadow-2xl text-slate-800 dark:text-slate-100 transition-colors">
        {/* Header Modal */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0b0f17] px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/80">
              <Building2 className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Editar Usuario en Terminal Dahua</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                ID: <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{person.userId}</span> · Lector: {deviceName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              stopWebcam();
              onClose();
            }}
            className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Cuerpo del Formulario */}
        <form onSubmit={handleSave} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {error && (
              <div className="flex items-center gap-2.5 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 p-3 text-xs text-rose-700 dark:text-rose-300">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
                <span>{error}</span>
              </div>
            )}

            {/* SECCIÓN 1: Datos Básicos */}
            <div className="space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Información del Residente
              </h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Nombre y Apellido *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2 text-sm text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Lote / Unidad
                  </label>
                  <input
                    type="text"
                    value={lotNumber}
                    onChange={(e) => setLotNumber(e.target.value)}
                    placeholder="Ej. Lote 14"
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2 text-sm text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Tipo de Relación
                </label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {ROLES.map(({ id, label, Icon }) => {
                    const active = role === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setRole(id)}
                        className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-2.5 text-center transition-all ${
                          active
                            ? "border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 shadow-sm"
                            : "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0b0f17] text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="text-[11px] font-semibold leading-tight">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* SECCIÓN 2: Horarios y Departamentos */}
            <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Horarios y Permisos de Acceso
              </h4>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Departamento / Grupo
                  </label>
                  <select
                    value={selectedDeptId}
                    onChange={(e) => setSelectedDeptId(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2 text-sm text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {departments.map((d) => (
                      <option key={d.id} value={d.dahuaDeptId}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Fecha de Vencimiento de Credencial
                  </label>
                  <DahuaDateTimePicker
                    value={validDateEnd}
                    onChange={(val) => setValidDateEnd(val)}
                  />
                </div>
              </div>
            </div>

            {/* SECCIÓN 3: Credenciales Biométricas y Físicas */}
            <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Credenciales Registradas
              </h4>

              {/* Acordeón 1: Reconocimiento Facial */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-[#0b0f17]">
                <button
                  type="button"
                  onClick={() => toggleSection("face")}
                  className="w-full flex items-center justify-between p-3.5 bg-slate-50 dark:bg-[#0b0f17] hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors text-left"
                >
                  <div className="flex items-center gap-2">
                    {openSections.face ? <ChevronUp className="w-4 h-4 text-blue-600 dark:text-blue-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">Reconocimiento Facial</span>
                  </div>
                  <span className="text-xs font-mono text-slate-500">
                    {photoPreview ? "Registrado" : "Sin foto"}
                  </span>
                </button>

                {openSections.face && (
                  <div className="p-4 bg-white dark:bg-[#111827] space-y-4">
                    <div className="flex rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-1">
                      <button
                        type="button"
                        onClick={() => {
                          stopWebcam();
                          setActiveTab("dahua");
                        }}
                        className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                          activeTab === "dahua"
                            ? "bg-blue-600 text-white shadow-sm"
                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                        }`}
                      >
                        <Camera className="h-3.5 w-3.5" />
                        <span>Lector Dahua</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab("webcam");
                          startWebcam();
                        }}
                        className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                          activeTab === "webcam"
                            ? "bg-blue-600 text-white shadow-sm"
                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                        }`}
                      >
                        <Video className="h-3.5 w-3.5" />
                        <span>Webcam</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          stopWebcam();
                          setActiveTab("file");
                        }}
                        className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                          activeTab === "file"
                            ? "bg-blue-600 text-white shadow-sm"
                            : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                        }`}
                      >
                        <Upload className="h-3.5 w-3.5" />
                        <span>Subir</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-4">
                      {photoPreview && (
                        <div className="relative shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={photoPreview}
                            alt="Facial"
                            className="w-20 h-20 rounded-xl object-cover border-2 border-emerald-500 shadow-md"
                          />
                        </div>
                      )}
                      <div className="flex-1">
                        {activeTab === "dahua" && (
                          <button
                            type="button"
                            disabled={capturingDahua}
                            onClick={captureFromDahua}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-sm transition-colors flex items-center gap-2 disabled:opacity-50"
                          >
                            <Camera className="w-4 h-4" />
                            <span>{capturingDahua ? "Capturando…" : "Tomar Captura del Lector ASI"}</span>
                          </button>
                        )}
                        {activeTab === "webcam" && isWebcamActive && (
                          <button
                            type="button"
                            onClick={captureWebcamFrame}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-sm transition-colors flex items-center gap-2"
                          >
                            <Camera className="w-4 h-4" />
                            <span>Capturar Fotograma</span>
                          </button>
                        )}
                        {activeTab === "file" && (
                          <label className="inline-flex cursor-pointer items-center gap-2 px-4 py-2 border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 text-xs font-semibold rounded-xl shadow-sm transition-colors">
                            <Upload className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                            <span>Seleccionar archivo</span>
                            <input
                              type="file"
                              accept="image/jpeg,image/png"
                              className="hidden"
                              onChange={(e) => onFileSelected(e.target.files?.[0] || null)}
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Acordeón 2: Tarjetas RFID */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-[#0b0f17]">
                <button
                  type="button"
                  onClick={() => toggleSection("card")}
                  className="w-full flex items-center justify-between p-3.5 bg-slate-50 dark:bg-[#0b0f17] hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors text-left"
                >
                  <div className="flex items-center gap-2">
                    {openSections.card ? <ChevronUp className="w-4 h-4 text-blue-600 dark:text-blue-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">Tarjetas de Proximidad</span>
                  </div>
                  <span className="text-xs font-mono text-slate-500">
                    {cards.length > 0 ? `Agregado: ${cards.length}` : "Sin tarjeta"}
                  </span>
                </button>

                {openSections.card && (
                  <div className="p-4 bg-white dark:bg-[#111827] space-y-3">
                    <div className="flex flex-wrap gap-2.5">
                      {cards.map((c) => (
                        <div
                          key={c}
                          className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 dark:bg-[#0b0f17] border border-slate-200 dark:border-slate-800 rounded-xl"
                        >
                          <CreditCard className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                          <span className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200">{c}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveCard(c)}
                            className="p-1 text-slate-400 hover:text-rose-500 transition-colors"
                            title="Remover tarjeta"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => {
                          setCardListenError(null);
                          setShowAddCardModal(true);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-dashed border-slate-300 dark:border-slate-700 hover:border-blue-500 bg-slate-50 dark:bg-[#0b0f17] text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 rounded-xl transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Añadir Tarjeta</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Acordeón 3: Huella digital */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-[#0b0f17]">
                <button
                  type="button"
                  onClick={() => toggleSection("fingerprint")}
                  className="w-full flex items-center justify-between p-3.5 bg-slate-50 dark:bg-[#0b0f17] hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors text-left"
                >
                  <div className="flex items-center gap-2">
                    {openSections.fingerprint ? <ChevronUp className="w-4 h-4 text-blue-600 dark:text-blue-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">Huella digital</span>
                  </div>
                  <span className="text-xs font-mono text-slate-500">
                    {fingerprints.length > 0
                      ? `Agregado: ${fingerprints.length} / 3`
                      : "Sin huella"}
                  </span>
                </button>

                {openSections.fingerprint && (
                  <div className="p-4 bg-white dark:bg-[#111827] space-y-3">
                    {fingerprints.length > 0 ? (
                      <div className="space-y-2">
                        {fingerprints.map((fp) => (
                          <div
                            key={fp.id}
                            className="flex items-center justify-between p-3 bg-slate-50 dark:bg-[#0b0f17] border border-slate-200 dark:border-slate-800 rounded-xl"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                                <Fingerprint className="w-5 h-5" />
                              </div>
                              <div>
                                <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                  <span>{fp.fingerName}</span>
                                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                    Slot #{fp.id}
                                  </span>
                                </div>
                                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                                  Plantilla biométrica activa en sensor Dahua ASI.
                                </p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveFingerprint(fp.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors"
                              title="Remover huella"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-[#0b0f17] border border-slate-200 dark:border-slate-800 rounded-xl">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-400 border border-slate-200 dark:border-slate-700">
                          <Fingerprint className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                            Sin huellas enroladas
                          </div>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Podés registrar hasta 3 huellas dactilares por persona en este equipo.
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Capacidad en terminal ASI: <strong className="text-slate-700 dark:text-slate-200">{fingerprints.length} de 3 huellas</strong>
                      </div>

                      {fingerprints.length < 3 ? (
                        <button
                          type="button"
                          disabled={enrollingFingerprint}
                          onClick={handleEnrollFingerprint}
                          className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-sm transition-colors flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <Fingerprint className="w-4 h-4" />
                          <span>
                            {enrollingFingerprint
                              ? "Esperando sensor ASI..."
                              : fingerprints.length === 0
                              ? "Habilitar Registro en ASI"
                              : `Añadir Huella #${fingerprints.length + 1}`}
                          </span>
                        </button>
                      ) : (
                        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-3 py-1 rounded-xl border border-amber-200 dark:border-amber-800">
                          Máximo de 3 huellas alcanzado
                        </span>
                      )}
                    </div>

                    {fingerprintMsg && (
                      <div className="p-2.5 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl text-xs text-blue-700 dark:text-blue-300">
                        {fingerprintMsg}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Acordeón 4: PIN de Acceso */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-white dark:bg-[#0b0f17]">
                <button
                  type="button"
                  onClick={() => toggleSection("password")}
                  className="w-full flex items-center justify-between p-3.5 bg-slate-50 dark:bg-[#0b0f17] hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors text-left"
                >
                  <div className="flex items-center gap-2">
                    {openSections.password ? <ChevronUp className="w-4 h-4 text-blue-600 dark:text-blue-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">Contraseña / PIN de Teclado</span>
                  </div>
                  <span className="text-xs font-mono text-slate-500">
                    {pinPassword || person.password ? "Configurado" : "Sin PIN"}
                  </span>
                </button>

                {openSections.password && (
                  <div className="p-4 bg-white dark:bg-[#111827] space-y-2">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      PIN para apertura por teclado ASI (4 a 6 dígitos)
                    </label>
                    <input
                      type="password"
                      maxLength={6}
                      value={pinPassword}
                      onChange={(e) => setPinPassword(e.target.value)}
                      placeholder="Dejar en blanco para conservar contraseña existente"
                      className="w-full max-w-sm rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2 text-sm font-mono text-slate-900 dark:text-white focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0b0f17] px-6 py-4">
            <button
              type="button"
              onClick={() => {
                stopWebcam();
                onClose();
              }}
              className="rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shadow-sm"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 px-5 py-2 text-xs font-bold text-white shadow-md transition-colors disabled:opacity-50"
            >
              {busy ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Sincronizando con ASI…</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Aceptar y Sincronizar</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Submodal Añadir Tarjeta */}
        {showAddCardModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-5 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white text-sm">
                  <CreditCard className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span>Añadir Tarjeta de Acceso</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddCardModal(false)}
                  className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Opción 1: Lectura Online */}
              <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-[#0b0f17] text-center space-y-2.5">
                <div className="flex items-center justify-center gap-2 text-blue-700 dark:text-blue-300 text-xs font-bold">
                  <Radio className="w-4 h-4 animate-pulse" />
                  <span>Lectura Online desde Terminal ASI</span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Aproxime la tarjeta física al lector Dahua para capturarla en tiempo real.
                </p>

                {isListeningCard ? (
                  <div className="space-y-1.5 py-2">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-950 border border-blue-300 dark:border-blue-800 text-blue-800 dark:text-blue-300 text-xs font-mono font-bold">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Esperando tarjeta ({cardListenCountdown}s)...</span>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleStartCardListen}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl shadow-sm transition-colors"
                  >
                    Iniciar Lectura en Equipo
                  </button>
                )}
              </div>

              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
                <span className="flex-shrink mx-3 text-slate-400 text-xs uppercase font-semibold">o carga manual</span>
                <div className="flex-grow border-t border-slate-200 dark:border-slate-800"></div>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Número de Tarjeta (HEX o Decimal)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newCardInput}
                    onChange={(e) => setNewCardInput(e.target.value)}
                    placeholder="Ej: B2FC3764"
                    className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-[#0b0f17] px-3.5 py-2 text-sm font-mono text-slate-900 dark:text-white uppercase focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={handleAddManualCard}
                    disabled={!newCardInput.trim()}
                    className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 disabled:opacity-50 transition-colors"
                  >
                    Agregar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** COMPONENTE PRINCIPAL: Gestión y Visualización de Personas */
export function PersonsPanel() {
  const { tenantId, status } = useDash();
  const { theme, toggleTheme } = useTheme();
  const toast = useToast();

  // Equipos Dahua y Personas
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [persons, setPersons] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("todos");

  // Modales
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPerson, setEditingPerson] = useState<Person | null>(null);
  const [personToDelete, setPersonToDelete] = useState<Person | null>(null);
  const [selectedPersonQr, setSelectedPersonQr] = useState<{
    person: Person;
    qrDataUrl: string;
  } | null>(null);

  // Credencial recién generada
  const [lastEnrolled, setLastEnrolled] = useState<{
    name: string;
    userId: string;
    cardNo: string;
    role: string;
    lotNumber: string;
    photoUrl: string | null;
    qrUrl: string | null;
  } | null>(null);

  // UI States
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function t(path: string) {
    return withTenant(path, tenantId);
  }

  async function loadDevices() {
    if (!tenantId) return;
    const d = await api<{ devices: Device[] }>(t("/api/dahua"));
    setDevices(d.devices);
    setDeviceId((prev) => {
      if (prev && d.devices.some((x) => x.id === prev)) return prev;
      return d.devices[0]?.id ?? null;
    });
  }

  async function loadPersons(id: string) {
    setLoading(true);
    try {
      const r = await api<{ ok?: boolean; persons?: Person[]; error?: string }>(t(`/api/dahua/${id}/persons`));
      setPersons(r.persons ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al listar personas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDevices().catch((err) => setError(err instanceof Error ? err.message : "Error al cargar lectores"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  useEffect(() => {
    if (!deviceId || !tenantId) return;
    loadPersons(deviceId).catch((err) => setError(err instanceof Error ? err.message : "Error al listar"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, tenantId]);

  async function executeDelete(p: Person) {
    if (!tenantId || !deviceId) return;
    setBusy(true);
    setError(null);
    try {
      const q = p.cardNo ? `?cardNo=${encodeURIComponent(p.cardNo)}` : "";
      await api(t(`/api/dahua/${deviceId}/persons/${encodeURIComponent(p.userId)}${q}`), {
        method: "DELETE",
      });
      setMsg(`Se eliminó a ${p.name || p.userId} del equipo.`);
      toast.success("Usuario eliminado", `Se eliminó a ${p.name || p.userId} del lector Dahua.`);
      if (lastEnrolled?.userId === p.userId) {
        setLastEnrolled(null);
      }
      setPersonToDelete(null);
      await loadPersons(deviceId);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "No se pudo borrar";
      setError(errMsg);
      toast.error("Error al eliminar", errMsg);
    } finally {
      setBusy(false);
    }
  }

  async function showPersonQr(p: Person) {
    const code = p.cardNo || p.userId;
    if (!code) return;
    const qrDataUrl = await QRCode.toDataURL(code, { width: 320, margin: 1 });
    setSelectedPersonQr({ person: p, qrDataUrl });
    toast.info("Código QR listo", `Visualizando credencial QR de ${p.name || p.userId}.`);
  }

  function printQrModal() {
    window.print();
  }

  function downloadQrPng() {
    if (!selectedPersonQr) return;
    const link = document.createElement("a");
    link.href = selectedPersonQr.qrDataUrl;
    link.download = `QR_${selectedPersonQr.person.userId}_${selectedPersonQr.person.name || "Acceso"}.png`;
    link.click();
  }

  // Filtrado de personas
  const filteredPersons = persons.filter((p) => {
    // Filtro por rol
    if (roleFilter !== "todos") {
      const pRole = (p.role || "propietario").toLowerCase();
      if (pRole !== roleFilter) return false;
    }
    // Filtro por búsqueda
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return (
      (p.name || "").toLowerCase().includes(q) ||
      (p.userId || "").toLowerCase().includes(q) ||
      (p.cardNo || "").toLowerCase().includes(q) ||
      (p.lotNumber || "").toLowerCase().includes(q)
    );
  });

  const selectedDevice = devices.find((d) => d.id === deviceId);

  // Estadísticas rápidas
  const totalCount = persons.length;
  const withFaceCount = persons.filter((p) => Boolean(p.photoBase64 || p.faceCount)).length;
  const withFpCount = persons.filter((p) => Boolean(p.fingerprintCount && p.fingerprintCount > 0)).length;
  const withCardCount = persons.filter((p) => Boolean(p.cardNo && p.cardNo !== p.userId)).length;

  if (!tenantId) return <p className="text-sm text-slate-500">Elegí un barrio.</p>;

  return (
    <div className="space-y-6">
      {/* 1. Barra superior: Título, Lector activo y Toggle de Tema */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-5 shadow-sm transition-colors">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/60">
              <Users className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Personas y Control Biométrico Dahua (ASI)
              </h2>
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 ml-10.5">
            Administración centralizada de residentes y visitantes, perfiles biométricos faciales y emisión de credenciales QR.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Lector activo */}
          <div className="text-right">
            <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Lector Activo</p>
            <div className="flex items-center gap-1.5 justify-end">
              <span className={`h-2 w-2 rounded-full ${status.agentOnline ? "bg-emerald-500" : "bg-rose-500"}`} />
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {status.agentOnline ? "Online" : "Offline"}
              </span>
            </div>
          </div>

          {devices.length > 0 ? (
            <select
              className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-800 dark:text-slate-200 focus:border-blue-500 focus:outline-none"
              value={deviceId ?? ""}
              onChange={(e) => setDeviceId(e.target.value)}
            >
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.host})
                </option>
              ))}
            </select>
          ) : (
            <span className="text-xs text-amber-500 font-medium">Sin lectores cargados</span>
          )}

          {/* Botón de alternancia de tema */}
          <button
            type="button"
            onClick={toggleTheme}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shadow-sm"
            title={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
            aria-label="Alternar tema"
          >
            {theme === "dark" ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-slate-600" />}
          </button>
        </div>
      </div>

      {/* 2. Tarjetas de Resumen / KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-4 shadow-sm transition-colors">
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Total Personas</p>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-black text-slate-900 dark:text-white">{totalCount}</span>
            <Users className="h-4 w-4 text-slate-400" />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-4 shadow-sm transition-colors">
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Reconocimiento Facial</p>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{withFaceCount}</span>
            <Camera className="h-4 w-4 text-emerald-500" />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-4 shadow-sm transition-colors">
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Huellas Enroladas</p>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-black text-blue-600 dark:text-blue-400">{withFpCount}</span>
            <Fingerprint className="h-4 w-4 text-blue-500" />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/80 p-4 shadow-sm transition-colors">
          <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Tarjetas RFID</p>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-2xl font-black text-purple-600 dark:text-purple-400">{withCardCount}</span>
            <CreditCard className="h-4 w-4 text-purple-500" />
          </div>
        </div>
      </div>

      {/* 3. Toolbar: Buscador, Filtros de Rol y Botón Principal "+ Nueva Persona" */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between transition-colors">
        {/* Buscador */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Buscar por nombre, DNI, lote o tarjeta…"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 pl-10 pr-4 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {searchFilter && (
            <button
              type="button"
              onClick={() => setSearchFilter("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Filtros por Rol y Acciones */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Segmented Filter */}
          <div className="flex rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-950 p-1">
            {[
              { id: "todos", label: "Todos" },
              { id: "propietario", label: "Propietarios" },
              { id: "visita", label: "Visitas" },
              { id: "servicio", label: "Servicio" },
            ].map((rf) => (
              <button
                key={rf.id}
                type="button"
                onClick={() => setRoleFilter(rf.id)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                  roleFilter === rf.id
                    ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                {rf.label}
              </button>
            ))}
          </div>

          {/* Botón Refrescar */}
          <button
            type="button"
            disabled={loading || !deviceId}
            onClick={() => deviceId && loadPersons(deviceId)}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shadow-sm disabled:opacity-50"
            title="Actualizar lista de personas"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin text-blue-600" : ""}`} />
          </button>

          {/* BOTÓN PRINCIPAL: NUEVA PERSONA */}
          <button
            type="button"
            disabled={!deviceId}
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 px-4 py-2 text-xs font-bold text-white shadow-md transition-colors disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            <span>Nueva Persona</span>
          </button>
        </div>
      </div>

      {/* 4. Tabla de Personas de Ancho Completo */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-sm overflow-hidden transition-colors">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="px-5 py-3.5">Persona / Unidad</th>
                <th className="px-5 py-3.5">Documento (ID)</th>
                <th className="px-5 py-3.5">Relación / Rol</th>
                <th className="px-5 py-3.5">Credenciales</th>
                <th className="px-5 py-3.5 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center justify-center gap-2.5">
                      <RefreshCw className="h-6 w-6 animate-spin text-blue-600 dark:text-blue-400" />
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Consultando personas en la memoria del lector Dahua…
                      </p>
                    </div>
                  </td>
                </tr>
              ) : filteredPersons.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <div className="mx-auto max-w-sm space-y-3">
                      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400">
                        <Users className="h-6 w-6" />
                      </div>
                      <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                        {searchFilter ? "No se encontraron personas con ese criterio" : "No hay personas enroladas en este equipo"}
                      </p>
                      <p className="text-xs text-slate-500">
                        {searchFilter ? "Probá buscando por otro término o limpiando el filtro." : "Comenzá enrolando al primer propietario o visita para habilitarle el acceso."}
                      </p>
                      {!searchFilter && (
                        <button
                          type="button"
                          onClick={() => setShowCreateModal(true)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 px-4 py-2 text-xs font-bold text-white shadow transition-colors"
                        >
                          <Plus className="h-4 w-4" />
                          <span>Enrolar Primera Persona</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredPersons.map((p) => {
                  const roleKey = (p.role || "propietario").toLowerCase();
                  const roleBadge = ROLE_BADGES[roleKey] || ROLE_BADGES.propietario;
                  const hasPhoto = Boolean(p.photoBase64 || p.faceCount);
                  const fpCount = p.fingerprintCount || 0;
                  const hasCard = Boolean(p.cardNo && p.cardNo !== p.userId);

                  return (
                    <tr
                      key={`${p.userId}-${p.cardNo}-${p.recNo}`}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      {/* Persona */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          {p.photoBase64 ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={p.photoBase64.startsWith("data:") ? p.photoBase64 : `data:image/jpeg;base64,${p.photoBase64}`}
                              alt={p.name}
                              className="h-9 w-9 rounded-xl object-cover border border-slate-200 dark:border-slate-700 shrink-0 shadow-sm"
                            />
                          ) : (
                            <div className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 shrink-0">
                              {(p.name || p.userId || "?").charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <p className="font-bold text-slate-900 dark:text-slate-100">{p.name || "Sin nombre"}</p>
                            {p.lotNumber && (
                              <p className="text-[11px] text-slate-500 dark:text-slate-400">{p.lotNumber}</p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Documento / DNI */}
                      <td className="px-5 py-3.5">
                        <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
                          {p.userId}
                        </span>
                      </td>

                      {/* Rol */}
                      <td className="px-5 py-3.5">
                        <span
                          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${roleBadge.lightClass} ${roleBadge.darkClass}`}
                        >
                          {roleBadge.label}
                        </span>
                      </td>

                      {/* Credenciales Biométricas / Físicas */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          {/* Facial */}
                          <span
                            title={hasPhoto ? "Reconocimiento Facial activo" : "Sin foto facial"}
                            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold border ${
                              hasPhoto
                                ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
                                : "bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 opacity-60"
                            }`}
                          >
                            <Camera className="h-3 w-3" />
                            <span>Rostro</span>
                          </span>

                          {/* Huella */}
                          <span
                            title={fpCount > 0 ? `${fpCount} huella(s) registrada(s)` : "Sin huella"}
                            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold border ${
                              fpCount > 0
                                ? "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800"
                                : "bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 opacity-60"
                            }`}
                          >
                            <Fingerprint className="h-3 w-3" />
                            <span>{fpCount > 0 ? `${fpCount}/3` : "Huella"}</span>
                          </span>

                          {/* Tarjeta */}
                          {hasCard && (
                            <span
                              title={`Tarjeta asignada: ${p.cardNo}`}
                              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800"
                            >
                              <CreditCard className="h-3 w-3" />
                              <span>{p.cardNo}</span>
                            </span>
                          )}

                          {/* PIN */}
                          {p.password && (
                            <span
                              title="PIN numérico configurado"
                              className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                            >
                              <Key className="h-3 w-3" />
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Acciones */}
                      <td className="px-5 py-3.5 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditingPerson(p)}
                            title="Editar usuario y credenciales"
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shadow-sm"
                          >
                            <Edit className="h-3 w-3 text-blue-600 dark:text-blue-400" />
                            <span>Editar</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => showPersonQr(p)}
                            title="Ver / Imprimir credencial QR"
                            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 dark:border-blue-800/80 bg-blue-50 dark:bg-blue-950/50 px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60 transition-colors"
                          >
                            <QrCode className="h-3 w-3" />
                            <span>QR</span>
                          </button>

                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => setPersonToDelete(p)}
                            title="Eliminar usuario del lector"
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 5. MODAL DE ALTA (Lanzado por el botón "+ Nueva Persona") */}
      {showCreateModal && (
        <CreatePersonModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          deviceId={deviceId || ""}
          tenantId={tenantId}
          deviceName={selectedDevice?.name || "Lector Dahua"}
          onSuccess={(newName, enrolledData) => {
            setShowCreateModal(false);
            setLastEnrolled(enrolledData);
            if (deviceId) {
              loadPersons(deviceId).catch(() => {});
            }
          }}
        />
      )}

      {/* 6. MODAL DE EDICIÓN */}
      {editingPerson && (
        <EditPersonModal
          person={editingPerson}
          deviceId={deviceId || ""}
          tenantId={tenantId}
          deviceName={selectedDevice?.name || "Lector Dahua"}
          agentOnline={Boolean(status.agentOnline)}
          onClose={() => setEditingPerson(null)}
          onSuccess={(updatedName, enrolledData) => {
            setEditingPerson(null);
            setLastEnrolled(enrolledData);
            toast.success("Sincronización exitosa", `Datos de ${updatedName} actualizados en el lector.`);
            if (deviceId) {
              loadPersons(deviceId).catch(() => {});
            }
          }}
        />
      )}

      {/* 7. MODAL DE CREDENCIAL GENERADA (Aparece tras enrolar o actualizar) */}
      {lastEnrolled && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl space-y-4 text-slate-900 dark:text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-sm">
                <ShieldCheck className="h-5 w-5" />
                <span>Credencial Generada</span>
              </div>
              <button
                type="button"
                onClick={() => setLastEnrolled(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="text-center space-y-2">
              {lastEnrolled.photoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={lastEnrolled.photoUrl}
                  alt={lastEnrolled.name}
                  className="mx-auto h-20 w-20 rounded-2xl object-cover border-2 border-emerald-500 shadow-md"
                />
              )}
              <h3 className="text-base font-bold text-slate-900 dark:text-white">{lastEnrolled.name}</h3>
              <p className="font-mono text-xs text-slate-500">
                DNI: {lastEnrolled.userId} {lastEnrolled.lotNumber ? `· ${lastEnrolled.lotNumber}` : ""}
              </p>

              {lastEnrolled.qrUrl && (
                <div className="my-3 flex justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={lastEnrolled.qrUrl}
                    alt="QR"
                    className="h-44 w-44 rounded-xl bg-white p-2.5 shadow-md border border-slate-200 dark:border-slate-700"
                  />
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  if (lastEnrolled.qrUrl) {
                    const link = document.createElement("a");
                    link.href = lastEnrolled.qrUrl;
                    link.download = `QR_${lastEnrolled.userId}_${lastEnrolled.name}.png`;
                    link.click();
                  }
                }}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shadow-sm"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Descargar</span>
              </button>
              <button
                type="button"
                onClick={() => setLastEnrolled(null)}
                className="rounded-xl bg-blue-600 hover:bg-blue-500 px-5 py-2 text-xs font-bold text-white shadow transition-colors"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. MODAL DE VISUALIZACIÓN DE QR */}
      {selectedPersonQr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl text-slate-900 dark:text-slate-100">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2 font-bold text-sm text-blue-600 dark:text-blue-400">
                <QrCode className="h-4 w-4" />
                <span>QR de Acceso</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPersonQr(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 text-center">
              <p className="text-sm font-bold text-slate-900 dark:text-white">{selectedPersonQr.person.name}</p>
              <p className="font-mono text-xs text-slate-500 mt-0.5">
                ID: {selectedPersonQr.person.userId}
              </p>

              <div className="my-4 flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={selectedPersonQr.qrDataUrl}
                  alt="QR"
                  className="h-48 w-48 rounded-xl bg-white p-3 shadow-md border border-slate-200 dark:border-slate-700"
                />
              </div>

              <p className="text-[11px] text-slate-500">
                Presentar este código ante el lector Dahua para habilitar el paso.
              </p>

              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={downloadQrPng}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors shadow-sm"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Descargar</span>
                </button>
                <button
                  type="button"
                  onClick={printQrModal}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors shadow-sm"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Imprimir</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPersonQr(null)}
                  className="rounded-xl bg-blue-600 hover:bg-blue-500 px-4 py-2 text-xs font-bold text-white transition-colors shadow"
                >
                  Listo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 9. MODAL DE CONFIRMACIÓN PARA ELIMINAR */}
      {personToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-white dark:bg-slate-900 p-6 shadow-2xl text-slate-900 dark:text-slate-100">
            <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 border-b border-slate-200 dark:border-slate-800 pb-3 font-bold text-sm">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <span>Confirmar Eliminación</span>
            </div>

            <div className="mt-4 text-xs text-slate-600 dark:text-slate-300 space-y-2">
              <p>
                ¿Confirmás que querés eliminar a <strong className="text-slate-900 dark:text-white">{personToDelete.name || "esta persona"}</strong> (DNI: <span className="font-mono">{personToDelete.userId}</span>) del lector Dahua?
              </p>
              <p className="text-[11px] text-slate-400">
                Esta acción removerá la plantilla facial biométrica, las huellas digitales y el código QR de acceso de la memoria del equipo.
              </p>
            </div>

            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => setPersonToDelete(null)}
                className="rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shadow-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => executeDelete(personToDelete)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 px-4 py-2 text-xs font-bold text-white shadow transition-colors disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{busy ? "Eliminando…" : "Eliminar del Lector"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
