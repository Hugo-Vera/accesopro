/** Lectura cruda de DNI argentino (PDF417 dorso o QR). */

export type ParsedDniScan = {
  dni: string;
  tramite: string;
  lastName: string;
  firstName: string;
  gender: string;
  birthDate: string;
  raw: string;
};

function toIsoDate(raw: string) {
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

function genderCode(raw: string) {
  const g = raw.trim().toUpperCase().slice(0, 1);
  return g === "M" || g === "F" || g === "X" ? g : "";
}

/** Renaper: [tramite]@apellido@nombre@sexo@dni@ejemplar@fechaNac@... */
export function parseDniScan(raw: string): ParsedDniScan | null {
  const text = raw.trim();
  if (!text || !text.includes("@")) return null;
  const parts = text.split("@").map((p) => p.trim());
  while (parts.length && parts[0] === "") parts.shift();
  if (parts.length < 5) return null;
  const dni = parts.find((c) => /^\d{7,8}$/.test(c)) || "";
  const lastName = parts[1] || "";
  const firstName = parts[2] || "";
  if (!dni && !lastName) return null;
  return {
    dni,
    tramite: parts[0] || "",
    lastName,
    firstName,
    gender: genderCode(parts[3] || ""),
    birthDate: toIsoDate(parts[6] || ""),
    raw: text.slice(0, 400),
  };
}
