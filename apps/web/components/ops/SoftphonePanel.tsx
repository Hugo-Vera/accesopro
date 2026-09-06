"use client";

import { IconPhone, IconPhoneCall, IconStar, IconBackspace, IconShield } from "@/components/DashboardIcons";

const PHONE_CONTACTS = [
  { id: "sindico", name: "Síndico / Admin", ext: "100" },
  { id: "portero", name: "Interfono Ingreso", ext: "101" },
  { id: "egreso", name: "Interfono Egreso", ext: "102" },
  { id: "zelador", name: "Intendencia / Mant.", ext: "103" },
  { id: "eclusa", name: "Eclusa Peatonal", ext: "104" },
  { id: "garaje", name: "Garaje / Cochera", ext: "105" },
  { id: "dtmf", name: "DTMF Apertura", ext: "106" },
  { id: "peatonal", name: "Peatonal Calle", ext: "107" },
];

/** Softphone UI gated until FreePBX/SIP (docs/PENDING.md). */
export function SoftphonePanel({ tenantName }: { tenantName: string | null }) {
  return (
    <div className="ops-panel relative flex min-h-[420px] flex-col justify-between overflow-hidden">
      <div
        className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/80 px-4 text-center backdrop-blur-[1px] dark:bg-[#07131e]/75"
        aria-live="polite"
      >
        <p className="ops-brand text-[12px]">AccesoPhone</p>
        <p className="mt-2 text-[13px] font-semibold text-slate-800 dark:text-white">Próximamente</p>
        <p className="mt-1 max-w-[220px] text-[11px] text-slate-600 dark:text-[#8fa7b8]">
          Telefonía SIP / FreePBX local todavía no está integrada. Los botones de emergencia no
          simulan llamadas.
        </p>
      </div>

      <div className="pointer-events-none select-none opacity-40" aria-hidden>
        <div className="ops-phone-toolbar">
          <button type="button" className="ops-phone-toolbtn active" tabIndex={-1}>
            <IconPhone className="h-3.5 w-3.5" />
          </button>
          <button type="button" className="ops-phone-toolbtn" tabIndex={-1}>
            <IconStar className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-bold text-slate-800 dark:border-[#142838] dark:bg-[#0a1b2a] dark:text-white">
          {tenantName ? `Cond. ${tenantName}` : "Cond. —"}
        </div>

        <div className="ops-contact-list">
          <ul>
            {PHONE_CONTACTS.map((c) => (
              <li key={c.id} className="ops-contact-row">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="h-2 w-2 flex-shrink-0 rounded-full bg-slate-400" />
                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-bold tracking-tight text-slate-800 dark:text-[#67c8e8]">
                      {c.name}
                    </p>
                    <p className="font-mono text-[9px] text-slate-500 dark:text-[#4a7a92]">
                      interno {c.ext}
                    </p>
                  </div>
                </div>
                <span className="ops-call-btn-round">
                  <IconPhone className="h-3 w-3 text-white" />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="pointer-events-none select-none opacity-40" aria-hidden>
        <div className="border-t border-slate-200 bg-slate-50 p-2.5 dark:border-[#142838] dark:bg-[#071522]">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="ops-brand text-[10px]">AccesoPhone</span>
            <span className="font-mono text-[9px] font-bold text-slate-500">OFFLINE</span>
          </div>
          <div className="ops-dial-lcd mb-2">
            <span className="font-mono text-[9.5px] text-slate-500 dark:text-[#4a6b82]">DESTINO:</span>
            <span className="truncate pl-2">—</span>
          </div>
          <div className="ops-keypad-layout">
            <div className="ops-keypad-3x4">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((k) => (
                <span key={k} className="ops-key-round">
                  {k}
                </span>
              ))}
            </div>
            <div className="ops-keypad-right">
              <span className="ops-btn-discar-vertical">
                <IconPhoneCall className="h-4 w-4" />
                <span>LLAMAR</span>
              </span>
              <span className="ops-key-round backspace ops-key-bksp">
                <IconBackspace className="h-4 w-4" />
              </span>
            </div>
          </div>
        </div>

        <div className="ops-emerg-bar">
          <span className="ops-emerg-btn opacity-70">POLICÍA 911</span>
          <span className="ops-emerg-btn opacity-70">SAME 107</span>
          <span className="ops-emerg-btn opacity-70">BOMBEROS 100</span>
        </div>
      </div>
    </div>
  );
}

type StatusProps = {
  planName: string | null;
  agentOnline: boolean;
  engineOnline: boolean;
  deviceCount: number;
  actuatorCount: number;
  userName: string | null;
  compact?: boolean;
};

/** Solo telemetría real del barrio — sin dirección ni sensores inventados. */
export function OpsStatusPanels({
  planName,
  agentOnline,
  engineOnline,
  deviceCount,
  actuatorCount,
  userName,
  compact,
}: StatusProps) {
  if (compact) {
    return (
      <div className="ops-status-compact">
        <span className="ops-sensor-chip ok">{planName ?? "Sin plan"}</span>
        <span className={`ops-sensor-chip ${agentOnline ? "ok" : "danger"}`}>
          Dahua · {agentOnline ? "OK" : "OFF"}
        </span>
        <span className={`ops-sensor-chip ${engineOnline ? "ok" : "warn"}`}>
          ALPR · {engineOnline ? "OK" : "STBY"}
        </span>
        <span className="ops-sensor-chip">ASI · {deviceCount}</span>
        <span className="ops-sensor-chip">Relés · {actuatorCount}</span>
        <span className="ops-sensor-chip">{userName || "Operador"}</span>
      </div>
    );
  }

  return (
    <div className="ops-subpanel flex h-full min-h-0 flex-col justify-center gap-2">
      <p className="ops-section-title">PLAN · SERVICIO · GUARDIA</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="ops-sensor-chip ok">{planName ?? "Sin plan"}</span>
        <span className={`ops-sensor-chip ${agentOnline ? "ok" : "danger"}`}>
          Dahua · {agentOnline ? "ONLINE" : "OFFLINE"}
        </span>
        <span className={`ops-sensor-chip ${engineOnline ? "ok" : "warn"}`}>
          ALPR · {engineOnline ? "ONLINE" : "STANDBY"}
        </span>
        <span className="ops-sensor-chip">Lectores · {deviceCount}</span>
        <span className="ops-sensor-chip">Relés · {actuatorCount}</span>
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 dark:border-[#1f374c] dark:bg-[#081624]">
        <div className="grid h-7 w-7 flex-shrink-0 place-items-center rounded-md bg-blue-100 text-blue-700 dark:bg-[#162c3e] dark:text-[#2bb8d9]">
          <IconShield className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-bold text-slate-800 dark:text-slate-100">
            {userName || "Operador"}
          </p>
          <p className="text-[9px] font-bold text-emerald-600 dark:text-[#3dcf7a]">Sesión activa</p>
        </div>
      </div>
    </div>
  );
}
