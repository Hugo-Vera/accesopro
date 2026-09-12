"use client";

import { useState, useEffect } from "react";
import { api, withTenant } from "@/lib/api";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import {
  IdCard,
  Home,
  Car,
  ShieldCheck,
  Award,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  X,
  ScanLine,
  Search,
  UserCheck,
  Building2,
  Calendar,
  Layers,
  KeyRound,
  FileCheck,
  FileWarning,
} from "lucide-react";

export const ARGENTINA_INSURANCE_COMPANIES = [
  "Federación Patronal",
  "La Segunda Seguros",
  "San Cristóbal Seguros",
  "Sancor Seguros",
  "Seguros Rivadavia",
  "Zurich Argentina",
  "Allianz Argentina",
  "Mercantil Andina",
  "La Caja Seguros",
  "Mapfre Argentina",
  "Provincia Seguros",
  "Río Uruguay Seguros (RUS)",
  "Berkley Argentina",
  "Chubb Seguros",
  "Experta Seguros",
  "Nación Seguros",
  "Segurcoop",
  "Triunfo Seguros",
  "Paraná Seguros",
  "Orbis Seguros",
  "Otra Compañía",
];

type PropertyItem = {
  id: string;
  lotNumber: string;
  label: string;
};

type ActuatorItem = {
  id: string;
  name: string;
};

type Props = {
  tenantId: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

export function VisitorCheckinModal({ tenantId, isOpen, onClose, onSuccess }: Props) {
  useEscapeKey(onClose, isOpen);

  // Pasos: 1 = DNI, 2 = Destino, 3 = Modalidad (Vehicular o Peatonal), 4 = Vehículo & Seguro, 5 = Licencia, 6 = Resumen
  const [step, setStep] = useState<number>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Datos externos (Lotes y Actuadores)
  const [properties, setProperties] = useState<PropertyItem[]>([]);
  const [actuators, setActuators] = useState<ActuatorItem[]>([]);

  // Paso 1: DNI Argentino
  const [dniNumber, setDniNumber] = useState("");
  const [tramiteNumber, setTramiteNumber] = useState("");
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [gender, setGender] = useState("M");
  const [birthDate, setBirthDate] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [rawPdf417, setRawPdf417] = useState("");
  const [isDniSearching, setIsDniSearching] = useState(false);
  const [dniFound, setDniFound] = useState(false);
  const [showPdf417Input, setShowPdf417Input] = useState(false);

  // Paso 2: Destino y Autorización
  const [propertyId, setPropertyId] = useState("");
  const [authorizedBy, setAuthorizedBy] = useState("");
  const [visitType, setVisitType] = useState<"social" | "service" | "contractor" | "delivery">("social");
  const [notes, setNotes] = useState("");

  // Paso 3: Modalidad
  const [isVehicular, setIsVehicular] = useState<boolean>(true);

  // Paso 4: Vehículo & Seguro Automotor Argentina
  const [plate, setPlate] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [color, setColor] = useState("");
  const [vehicleType, setVehicleType] = useState<"car" | "pickup" | "suv" | "motorcycle" | "van" | "truck">("car");
  const [isVehicleSearching, setIsVehicleSearching] = useState(false);
  const [vehicleFound, setVehicleFound] = useState(false);

  // Seguro
  const [insuranceCompany, setInsuranceCompany] = useState("Federación Patronal");
  const [customInsuranceCompany, setCustomInsuranceCompany] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [insuranceValidUntil, setInsuranceValidUntil] = useState("");
  const [coverageType, setCoverageType] = useState<"responsabilidad_civil" | "terceros" | "todo_riesgo">("responsabilidad_civil");

  // Paso 5: Licencia de Conducir
  const [licenseNumber, setLicenseNumber] = useState("");
  const [licenseClass, setLicenseClass] = useState("B.1");
  const [licenseJurisdiction, setLicenseJurisdiction] = useState("");
  const [licenseValidUntil, setLicenseValidUntil] = useState("");

  // Paso 6: Resumen y Apertura
  const [openRelay, setOpenRelay] = useState(true);
  const [actuatorId, setActuatorId] = useState("");

  // Cargar propiedades y actuadores al abrir
  useEffect(() => {
    if (!isOpen || !tenantId) return;
    // Cargar propiedades del barrio
    api<{ properties: PropertyItem[] }>(withTenant("/api/visitors/properties", tenantId))
      .then((d) => {
        setProperties(d.properties || []);
        if (d.properties?.length > 0 && !propertyId) {
          setPropertyId(d.properties[0].id);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "No se pudieron cargar los lotes");
      });

    // Cargar actuadores
    api<{ actuators: ActuatorItem[] }>(withTenant("/api/actuators", tenantId))
      .then((d) => {
        setActuators(d.actuators || []);
        if (d.actuators?.length > 0) {
          setActuatorId(d.actuators[0].id);
        }
      })
      .catch(() => {});
  }, [isOpen, tenantId]);

  // Búsqueda automática de DNI al tipear 7 u 8 dígitos
  const handleDniBlurOrSearch = async () => {
    const cleanDni = dniNumber.replace(/\D/g, "");
    if (cleanDni.length < 7) return;

    setIsDniSearching(true);
    try {
      const res = await api<{ found: boolean; identity?: any; license?: any }>(
        withTenant(`/api/visitors/search-identity?dni=${cleanDni}`, tenantId)
      );
      if (res.found && res.identity) {
        setLastName(res.identity.lastName || "");
        setFirstName(res.identity.firstName || "");
        setGender(res.identity.gender || "M");
        setBirthDate(res.identity.birthDate || "");
        setTramiteNumber(res.identity.tramiteNumber || "");
        setPhone(res.identity.phone || "");
        setAddress(res.identity.address || "");
        setDniFound(true);

        if (res.license) {
          setLicenseNumber(res.license.licenseNumber || cleanDni);
          setLicenseClass(res.license.classes || "B.1");
          setLicenseJurisdiction(res.license.jurisdiction || "");
          if (res.license.validUntil) {
            setLicenseValidUntil(new Date(res.license.validUntil).toISOString().split("T")[0]);
          }
        }
      } else {
        setDniFound(false);
      }
    } catch {
      setDniFound(false);
    } finally {
      setIsDniSearching(false);
    }
  };

  // Parsear código de barras PDF417 de DNI argentino
  const handleParsePdf417 = (raw: string) => {
    setRawPdf417(raw);
    const parts = raw.split("@");
    if (parts.length >= 8) {
      // Formato Renaper típico: N° Trámite @ Apellido @ Nombre @ Sexo @ DNI @ Ejemplar @ F.Nac @ F.Emisión
      const parsedTramite = parts[0]?.trim();
      const parsedLastName = parts[1]?.trim();
      const parsedFirstName = parts[2]?.trim();
      const parsedGender = parts[3]?.trim().toUpperCase();
      const parsedDni = parts[4]?.trim().replace(/\D/g, "");
      const parsedBirth = parts[6]?.trim();

      if (parsedDni) setDniNumber(parsedDni);
      if (parsedTramite) setTramiteNumber(parsedTramite);
      if (parsedLastName) setLastName(parsedLastName);
      if (parsedFirstName) setFirstName(parsedFirstName);
      if (parsedGender) setGender(parsedGender);
      if (parsedBirth) {
        // Puede venir DD/MM/AAAA o AAAA-MM-DD
        if (parsedBirth.includes("/")) {
          const [d, m, y] = parsedBirth.split("/");
          if (d && m && y) setBirthDate(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
        } else {
          setBirthDate(parsedBirth);
        }
      }
      setDniFound(true);
      setShowPdf417Input(false);
    }
  };

  // Búsqueda de Vehículo por Patente
  const handlePlateBlurOrSearch = async () => {
    const cleanPlate = plate.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (cleanPlate.length < 6) return;

    setIsVehicleSearching(true);
    try {
      const res = await api<{ found: boolean; vehicle?: any; insurance?: any }>(
        withTenant(`/api/visitors/search-vehicle?plate=${cleanPlate}`, tenantId)
      );
      if (res.found && res.vehicle) {
        setBrand(res.vehicle.brand || "");
        setModel(res.vehicle.model || "");
        setColor(res.vehicle.color || "");
        setVehicleType(res.vehicle.vehicleType || "car");
        setVehicleFound(true);

        if (res.insurance) {
          setInsuranceCompany(res.insurance.company || "Federación Patronal");
          setPolicyNumber(res.insurance.policyNumber || "");
          setCoverageType(res.insurance.coverageType || "responsabilidad_civil");
          if (res.insurance.validUntil) {
            setInsuranceValidUntil(new Date(res.insurance.validUntil).toISOString().split("T")[0]);
          }
        }
      } else {
        setVehicleFound(false);
      }
    } catch {
      setVehicleFound(false);
    } finally {
      setIsVehicleSearching(false);
    }
  };

  // Validación de paso
  const canGoNext = () => {
    if (step === 1) {
      return dniNumber.trim().length >= 7 && lastName.trim() && firstName.trim();
    }
    if (step === 2) {
      return propertyId && authorizedBy.trim();
    }
    if (step === 3) {
      return true;
    }
    if (step === 4) {
      if (!isVehicular) return true;
      const comp = insuranceCompany === "Otra Compañía" ? customInsuranceCompany.trim() : insuranceCompany;
      return plate.trim().length >= 6 && comp && policyNumber.trim() && insuranceValidUntil;
    }
    if (step === 5) {
      if (!isVehicular) return true;
      return licenseValidUntil;
    }
    return true;
  };

  const handleNext = () => {
    setError(null);
    if (!canGoNext()) {
      setError("Completá todos los campos requeridos para continuar.");
      return;
    }
    if (step === 3 && !isVehicular) {
      // Salto directo a resumen si es ingreso peatonal
      setStep(6);
    } else {
      setStep((prev) => Math.min(prev + 1, 6));
    }
  };

  const handlePrev = () => {
    setError(null);
    if (step === 6 && !isVehicular) {
      setStep(3);
    } else {
      setStep((prev) => Math.max(prev - 1, 1));
    }
  };

  // Envío final del registro consolidado
  const handleSubmitCheckin = async () => {
    setLoading(true);
    setError(null);

    const finalCompany = insuranceCompany === "Otra Compañía" ? customInsuranceCompany.trim() : insuranceCompany;

    const payload = {
      identity: {
        dniNumber: dniNumber.trim(),
        tramiteNumber: tramiteNumber.trim() || undefined,
        lastName: lastName.trim(),
        firstName: firstName.trim(),
        gender,
        birthDate: birthDate || undefined,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        rawPdf417: rawPdf417 || undefined,
      },
      destination: {
        propertyId,
        authorizedBy: authorizedBy.trim(),
        visitType,
        notes: notes.trim() || undefined,
      },
      isVehicular,
      vehicle: isVehicular
        ? {
            plate: plate.toUpperCase().trim(),
            brand: brand.trim() || undefined,
            model: model.trim() || undefined,
            color: color.trim() || undefined,
            vehicleType,
          }
        : undefined,
      insurance: isVehicular
        ? {
            company: finalCompany,
            policyNumber: policyNumber.trim(),
            validUntil: insuranceValidUntil,
            coverageType,
          }
        : undefined,
      driverLicense: isVehicular
        ? {
            licenseNumber: licenseNumber.trim() || dniNumber.trim(),
            classes: licenseClass,
            jurisdiction: licenseJurisdiction.trim() || undefined,
            validUntil: licenseValidUntil,
          }
        : undefined,
      openRelay,
      actuatorId: openRelay ? actuatorId : undefined,
    };

    try {
      const res = await api<{ ok: boolean; message?: string }>(withTenant("/api/visitors/checkin", tenantId), {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        onSuccess();
        onClose();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al registrar la visita");
    } finally {
      setLoading(false);
    }
  };

  // Indicador de vencimiento de seguro
  const isInsuranceExpired = () => {
    if (!insuranceValidUntil) return false;
    return new Date(insuranceValidUntil).getTime() < Date.now();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl transition-all">
        {/* Cabecera del Modal */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800/80">
              <IdCard className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Registro de Ingreso de Visita
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Acreditación modular de identidad, vehículo, seguro y habilitación de conducir.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Barra de Progreso de Pasos (1 al 6) */}
        <div className="my-5 border-b border-slate-100 dark:border-slate-800/80 pb-4">
          <div className="flex items-center justify-between text-[11px] font-bold text-slate-400">
            <span className={step >= 1 ? "text-blue-600 dark:text-blue-400 font-extrabold" : ""}>
              1. DNI
            </span>
            <span className={step >= 2 ? "text-blue-600 dark:text-blue-400 font-extrabold" : ""}>
              2. Destino
            </span>
            <span className={step >= 3 ? "text-blue-600 dark:text-blue-400 font-extrabold" : ""}>
              3. Modalidad
            </span>
            {isVehicular && (
              <>
                <span className={step >= 4 ? "text-blue-600 dark:text-blue-400 font-extrabold" : ""}>
                  4. Vehículo & Seguro
                </span>
                <span className={step >= 5 ? "text-blue-600 dark:text-blue-400 font-extrabold" : ""}>
                  5. Licencia
                </span>
              </>
            )}
            <span className={step === 6 ? "text-emerald-600 dark:text-emerald-400 font-extrabold" : ""}>
              {isVehicular ? "6." : "4."} Confirmar
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-blue-600 dark:bg-blue-500 transition-all duration-300"
              style={{
                width: isVehicular ? `${(step / 6) * 100}%` : `${(step === 6 ? 4 : step) / 4 * 100}%`,
              }}
            />
          </div>
        </div>

        {/* Notificación de Error */}
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/30 p-3 text-xs text-rose-800 dark:text-rose-300 shadow-xs">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* CONTENIDO DEL PASO */}
        <div className="min-h-[280px]">
          {/* PASO 1: DNI ARGENTINO */}
          {step === 1 && (
            <div className="space-y-4 animate-in fade-in">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                  Datos Filiatorios (DNI Argentino)
                </span>
                <button
                  type="button"
                  onClick={() => setShowPdf417Input(!showPdf417Input)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline"
                >
                  <ScanLine className="h-3.5 w-3.5" />
                  <span>{showPdf417Input ? "Ocultar lector" : "Escanear código PDF417"}</span>
                </button>
              </div>

              {/* Entrada rápida PDF417 */}
              {showPdf417Input && (
                <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/20 p-3">
                  <label className="block text-[11px] font-bold text-blue-900 dark:text-blue-300 mb-1">
                    Pistola de código de barras o pegar cadena PDF417:
                  </label>
                  <input
                    type="text"
                    placeholder="Pegá aquí la lectura cruda del código de barras del DNI..."
                    value={rawPdf417}
                    onChange={(e) => handleParsePdf417(e.target.value)}
                    className="w-full rounded-lg border border-blue-300 dark:border-blue-800 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-white"
                  />
                  <p className="mt-1 text-[10px] text-blue-700 dark:text-blue-400">
                    Autocompleta de inmediato Apellido, Nombre, DNI, Trámite y Nacimiento.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Número de DNI *
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Ej. 34567890"
                      value={dniNumber}
                      onChange={(e) => setDniNumber(e.target.value)}
                      onBlur={handleDniBlurOrSearch}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-mono font-bold text-slate-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                    {isDniSearching && (
                      <Search className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-blue-500" />
                    )}
                  </div>
                  {dniFound && (
                    <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                      <UserCheck className="h-3 w-3" /> Persona recurrente en el predio
                    </span>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    N° de Trámite
                  </label>
                  <input
                    type="text"
                    placeholder="11 dígitos del DNI tarjeta"
                    value={tramiteNumber}
                    onChange={(e) => setTramiteNumber(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-mono text-slate-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Sexo registral
                  </label>
                  <select
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="M">Masculino (M)</option>
                    <option value="F">Femenino (F)</option>
                    <option value="X">No binario (X)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Apellido(s) *
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. González"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Nombre(s) *
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. Martín Alejandro"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Fecha de Nacimiento
                  </label>
                  <input
                    type="date"
                    value={birthDate}
                    onChange={(e) => setBirthDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Teléfono de Contacto
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. 11 4455 6677"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs text-slate-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Domicilio
                  </label>
                  <input
                    type="text"
                    placeholder="Localidad / Domicilio"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs text-slate-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>
              </div>
            </div>
          )}

          {/* PASO 2: DESTINO Y AUTORIZACIÓN */}
          {step === 2 && (
            <div className="space-y-4 animate-in fade-in">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Destino y Motivo de Visita
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Lote / Unidad Destino *
                  </label>
                  <select
                    value={propertyId}
                    onChange={(e) => setPropertyId(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="">Seleccionar lote...</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        Lote {p.lotNumber} — {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Quién Autoriza (Propietario / Residente) *
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. Roberto García"
                    value={authorizedBy}
                    onChange={(e) => setAuthorizedBy(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Categoría de Visita
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { key: "social", label: "Social / Familiar" },
                    { key: "service", label: "Servicio / Técnico" },
                    { key: "contractor", label: "Obra / Contratista" },
                    { key: "delivery", label: "Delivery / Paquete" },
                  ].map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setVisitType(t.key as any)}
                      className={`py-2 px-3 rounded-xl border text-xs font-bold transition-all ${
                        visitType === t.key
                          ? "border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-700"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Observaciones / Notas de Portería
                </label>
                <textarea
                  rows={2}
                  placeholder="Ej. Viene a reparar pileta, ingresa con herramientas."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>
            </div>
          )}

          {/* PASO 3: MODALIDAD DE INGRESO */}
          {step === 3 && (
            <div className="space-y-6 text-center py-4 animate-in fade-in">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  ¿Cómo ingresa la persona al barrio?
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Seleccioná la modalidad para determinar las validaciones de seguro y habilitación.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg mx-auto">
                <button
                  type="button"
                  onClick={() => setIsVehicular(false)}
                  className={`p-5 rounded-2xl border-2 text-center transition-all ${
                    !isVehicular
                      ? "border-blue-600 bg-blue-50/70 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 shadow-md"
                      : "border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/50 text-slate-700 dark:text-slate-300"
                  }`}
                >
                  <div className="grid h-12 w-12 place-items-center rounded-xl bg-blue-100 dark:bg-blue-900/60 mx-auto text-blue-600 dark:text-blue-300 mb-3">
                    <UserCheck className="h-6 w-6" />
                  </div>
                  <p className="font-bold text-sm">Ingreso Peatonal</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    A pie, taxi o remis que no ingresa al predio. No requiere seguro ni carnet.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setIsVehicular(true)}
                  className={`p-5 rounded-2xl border-2 text-center transition-all ${
                    isVehicular
                      ? "border-blue-600 bg-blue-50/70 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 shadow-md"
                      : "border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/50 text-slate-700 dark:text-slate-300"
                  }`}
                >
                  <div className="grid h-12 w-12 place-items-center rounded-xl bg-indigo-100 dark:bg-indigo-900/60 mx-auto text-indigo-600 dark:text-indigo-300 mb-3">
                    <Car className="h-6 w-6" />
                  </div>
                  <p className="font-bold text-sm">Ingreso Vehicular</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Auto, camioneta o moto. Requiere validar patente, seguro obligatorio y licencia.
                  </p>
                </button>
              </div>
            </div>
          )}

          {/* PASO 4: VEHÍCULO & SEGURO AUTOMOTOR ARGENTINA */}
          {step === 4 && isVehicular && (
            <div className="space-y-4 animate-in fade-in">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Datos del Vehículo y Póliza de Seguro (Ley 24.449)
              </span>

              {/* Fila Patente y Búsqueda */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Patente / Dominio Mercosur *
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Ej. AA 123 BB o ABC 123"
                      value={plate}
                      onChange={(e) => setPlate(e.target.value.toUpperCase())}
                      onBlur={handlePlateBlurOrSearch}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 font-mono text-sm font-bold text-slate-900 tracking-wider shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                    {isVehicleSearching && (
                      <Search className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-blue-500" />
                    )}
                  </div>
                  {vehicleFound && (
                    <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                      <CheckCircle2 className="h-3 w-3" /> Vehículo reconocido previamente
                    </span>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Tipo de Vehículo
                  </label>
                  <select
                    value={vehicleType}
                    onChange={(e) => setVehicleType(e.target.value as any)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="car">Automóvil</option>
                    <option value="pickup">Camioneta / Pick-Up</option>
                    <option value="suv">SUV / Utilitario</option>
                    <option value="motorcycle">Motocicleta</option>
                    <option value="van">Furgón</option>
                    <option value="truck">Camión de Carga</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Color
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. Blanco"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Marca del Vehículo
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. Toyota"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs text-slate-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Modelo
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. Hilux SRX"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs text-slate-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>
              </div>

              {/* Bloque Seguro Automotor */}
              <div className="rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <span className="text-xs font-bold text-blue-900 dark:text-blue-300 uppercase tracking-wider">
                    Póliza de Seguro Automotor en Argentina
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Compañía Aseguradora *
                    </label>
                    <select
                      value={insuranceCompany}
                      onChange={(e) => setInsuranceCompany(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    >
                      {ARGENTINA_INSURANCE_COMPANIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    {insuranceCompany === "Otra Compañía" && (
                      <input
                        type="text"
                        placeholder="Escribí el nombre de la aseguradora..."
                        value={customInsuranceCompany}
                        onChange={(e) => setCustomInsuranceCompany(e.target.value)}
                        className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 shadow-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      />
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      N° de Póliza / Certificado *
                    </label>
                    <input
                      type="text"
                      placeholder="Ej. 104-5892340-01"
                      value={policyNumber}
                      onChange={(e) => setPolicyNumber(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 font-mono text-xs font-bold text-slate-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Vencimiento de Cobertura *
                    </label>
                    <input
                      type="date"
                      value={insuranceValidUntil}
                      onChange={(e) => setInsuranceValidUntil(e.target.value)}
                      className={`w-full rounded-xl border px-3 py-1.5 text-xs font-bold shadow-xs ${
                        isInsuranceExpired()
                          ? "border-rose-500 bg-rose-50 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                          : "border-slate-300 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      }`}
                    />
                    {isInsuranceExpired() && (
                      <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-rose-600 dark:text-rose-400 mt-1">
                        <FileWarning className="h-3.5 w-3.5" /> Póliza vencida: no se recomienda el ingreso vehicular
                      </span>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Tipo de Cobertura
                    </label>
                    <select
                      value={coverageType}
                      onChange={(e) => setCoverageType(e.target.value as any)}
                      className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 shadow-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    >
                      <option value="responsabilidad_civil">Responsabilidad Civil (Contra Terceros)</option>
                      <option value="terceros">Terceros Completo</option>
                      <option value="todo_riesgo">Todo Riesgo con Franquicia</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* PASO 5: LICENCIA DE CONDUCIR */}
          {step === 5 && isVehicular && (
            <div className="space-y-4 animate-in fade-in">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Licencia Nacional de Conducir (Conductor)
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    N° de Licencia
                  </label>
                  <input
                    type="text"
                    placeholder={dniNumber || "Número de carnet"}
                    value={licenseNumber || dniNumber}
                    onChange={(e) => setLicenseNumber(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 font-mono text-xs font-bold text-slate-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">Por defecto coincide con el DNI del conductor.</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Clase / Categoría Habilitante
                  </label>
                  <select
                    value={licenseClass}
                    onChange={(e) => setLicenseClass(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    <option value="B.1">B.1 — Automóviles y camionetas hasta 3.500 kg</option>
                    <option value="B.2">B.2 — Camionetas con acoplado hasta 750 kg</option>
                    <option value="A.1">A.1 — Motocicletas hasta 150cc</option>
                    <option value="A.2">A.2 — Motocicletas de más de 150cc</option>
                    <option value="C">C — Camiones sin acoplado</option>
                    <option value="E.1">E.1 — Camiones articulados</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Fecha de Vencimiento de Licencia *
                  </label>
                  <input
                    type="date"
                    value={licenseValidUntil}
                    onChange={(e) => setLicenseValidUntil(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Jurisdicción Emisora (Municipio / Provincia)
                  </label>
                  <input
                    type="text"
                    placeholder="Ej. Pilar, Prov. de Buenos Aires"
                    value={licenseJurisdiction}
                    onChange={(e) => setLicenseJurisdiction(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs text-slate-900 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>
              </div>
            </div>
          )}

          {/* PASO 6: RESUMEN Y CONFIRMACIÓN */}
          {step === 6 && (
            <div className="space-y-4 animate-in fade-in">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                Resumen Ejecutivo y Acreditación de Ingreso
              </span>

              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-4 divide-y divide-slate-200 dark:divide-slate-700/60 text-xs">
                {/* Fila Persona */}
                <div className="pb-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase">Visitante</p>
                    <p className="font-bold text-slate-900 dark:text-white text-sm">
                      {lastName}, {firstName}
                    </p>
                    <p className="font-mono text-slate-500">DNI: {dniNumber}</p>
                  </div>
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" /> DNI Verificado
                  </span>
                </div>

                {/* Fila Destino */}
                <div className="py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase">Destino</p>
                    <p className="font-bold text-slate-800 dark:text-slate-200">
                      {properties.find((p) => p.id === propertyId)?.label || "Lote seleccionado"}
                    </p>
                    <p className="text-[11px] text-slate-500">Autoriza: {authorizedBy}</p>
                  </div>
                  <span className="px-2 py-0.5 rounded-md font-bold text-[11px] bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300">
                    {visitType.toUpperCase()}
                  </span>
                </div>

                {/* Fila Vehicular si aplica */}
                {isVehicular && (
                  <div className="pt-2.5 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase">Vehículo</p>
                        <p className="font-mono font-bold text-slate-900 dark:text-white">
                          {plate} {brand && `(${brand} ${model})`}
                        </p>
                      </div>
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
                        <Car className="h-4 w-4" /> Patente Mercosur
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-100 dark:border-slate-800">
                      <div>
                        <span className="text-slate-500">Seguro: </span>
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          {insuranceCompany === "Otra Compañía" ? customInsuranceCompany : insuranceCompany} (Póliza {policyNumber})
                        </span>
                      </div>
                      <span
                        className={`font-bold ${
                          isInsuranceExpired() ? "text-rose-600" : "text-emerald-600 dark:text-emerald-400"
                        }`}
                      >
                        {isInsuranceExpired() ? "PÓLIZA VENCIDA" : "VIGENTE"}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Opción de Accionamiento de Barrera */}
              {actuators.length > 0 && (
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20 p-3 flex items-center justify-between">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={openRelay}
                      onChange={(e) => setOpenRelay(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <div>
                      <p className="text-xs font-bold text-slate-900 dark:text-white">
                        Abrir barrera / portón de acceso al confirmar
                      </p>
                      <p className="text-[10.5px] text-slate-500">
                        Acciona el relé de entrada de forma automática.
                      </p>
                    </div>
                  </label>

                  {openRelay && (
                    <select
                      value={actuatorId}
                      onChange={(e) => setActuatorId(e.target.value)}
                      className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    >
                      {actuators.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Botones de Navegación del Wizard */}
        <div className="mt-6 flex items-center justify-between border-t border-slate-200 dark:border-slate-800 pt-4">
          <button
            type="button"
            onClick={step === 1 ? onClose : handlePrev}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >
            {step === 1 ? "Cancelar" : <><ArrowLeft className="h-4 w-4" /> Anterior</>}
          </button>

          {step < 6 ? (
            <button
              type="button"
              onClick={handleNext}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 px-5 py-2 text-xs font-bold text-white shadow-sm transition-colors"
            >
              <span>Siguiente</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmitCheckin}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-6 py-2 text-xs font-bold text-white shadow-md transition-colors disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>{loading ? "Registrando..." : "Registrar Ingreso y Finalizar"}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
