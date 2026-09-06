"use client";

import { ActIcon } from "@/components/ops/ActIcon";
import type { RelaySlot } from "@/components/ops/relayPresets";

type Props = {
  slots: RelaySlot[];
  busy: string | null;
  onToggle: (slot: RelaySlot) => void;
  title?: string;
  emptyHint?: string;
};

export function RelayMatrix({
  slots,
  busy,
  onToggle,
  title = "ACCIONAMIENTO DE ACTUADORES Y RELÉS",
  emptyHint = "Sin actuadores en este carril",
}: Props) {
  return (
    <div className="ops-relay-strip flex-shrink-0">
      <p className="ops-relay-strip-label">{title}</p>
      {slots.length === 0 ? (
        <p className="px-0.5 py-2 text-[11px] text-slate-500 dark:text-[#6b8498]">{emptyHint}</p>
      ) : (
        <div className="ops-relay-grid">
          {slots.map((slot, i) => {
            const a = slot.actuator;
            const emerg = Boolean(slot.danger);
            const open = a?.open === true;
            const bound = Boolean(a);

            return (
              <button
                key={`${slot.label}-${i}`}
                type="button"
                className={`ops-relay-btn ${open ? "open" : ""} ${emerg ? "danger-tone" : ""} ${
                  !bound ? "unbound" : ""
                }`}
                disabled={!!busy || !bound}
                aria-pressed={bound ? open : undefined}
                title={
                  !bound
                    ? `Pulsador ${slot.label} — Asignar en Actuadores`
                    : open
                      ? "Abierto — click para cerrar"
                      : "Cerrado — click para accionar"
                }
                onClick={() => onToggle(slot)}
              >
                {slot.cam ? <span className="ops-relay-cam" title="Cámara asociada" /> : null}
                <span className="ops-relay-icon">
                  <ActIcon kind={slot.kind} />
                </span>
                <span className="ops-relay-label">
                  {a && (busy === `open-${a.id}` || busy === `close-${a.id}`)
                    ? "ACCIONANDO…"
                    : slot.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
