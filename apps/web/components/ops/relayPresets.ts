export type Actuator = {
  id: string;
  name: string;
  kind: string;
  driver: string;
  open: boolean | null;
  triggerManual?: boolean;
  dahuaDeviceId?: string | null;
};

export type RelaySlot = {
  label: string;
  kind: string;
  danger?: boolean;
  cam?: boolean;
  actuator: Actuator | null;
};

/** Presets es-AR para barrios cerrados; el nombre libre del actuador manda. */
export const RELAY_PRESETS: {
  label: string;
  match: RegExp;
  kind: string;
  danger?: boolean;
  cam?: boolean;
}[] = [
  { label: "Portería", match: /porter|guarita|cabina/i, kind: "house" },
  { label: "Sirena", match: /siren|alarma/i, kind: "siren", danger: true },
  { label: "Basura", match: /basura|recicl/i, kind: "trash" },
  { label: "Emergencia", match: /emerg|pánico|panico/i, kind: "emerg", danger: true },
  { label: "Iluminación", match: /\biluminac|panel|central|luz/i, kind: "light" },
  { label: "Reflector", match: /reflec|per[ií]metro|farol/i, kind: "floodlight", cam: true },
  { label: "Portón / Barrera", match: /portón|porton|eclusa|cancela|barrera|\bin\b/i, kind: "gate", cam: true },
  { label: "Cocheras / Garaje", match: /garage|garaje|cochera/i, kind: "garage", cam: true },
  { label: "Puerta Peatonal", match: /peaton|puerta|\bout\b|sótano|sotano/i, kind: "underground", cam: true },
  { label: "Riego Jardín", match: /riego|irrig|jard/i, kind: "water" },
];

export function buildRelaySlots(manualActs: Actuator[]): RelaySlot[] {
  const remaining = [...manualActs];
  const slots: RelaySlot[] = [];

  for (const preset of RELAY_PRESETS) {
    const idx = remaining.findIndex((a) => preset.match.test(a.name) || preset.match.test(a.kind));
    const actuator = idx >= 0 ? remaining.splice(idx, 1)[0]! : null;
    slots.push({
      label: actuator?.name ?? preset.label,
      kind: preset.kind,
      danger: preset.danger,
      cam: preset.cam,
      actuator,
    });
  }

  for (const extra of remaining) {
    slots.push({
      label: extra.name,
      kind: extra.kind || "gate",
      actuator: extra,
      cam: /barrera|portón|porton|garaje|peaton/i.test(extra.name),
      danger: /siren|emerg|pánico|panico/i.test(extra.name),
    });
  }

  return slots;
}
