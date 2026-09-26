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

/** El PDF417 del DNI viene en Latin-1: si un lector lo decodificó como UTF-8, la Ñ llega como U+FFFD o mojibake. */
function fixNameEncoding(raw: string) {
  return raw
    .replace(/Ã\u0091|Ã‘/g, "Ñ")
    .replace(/Ã±/g, "ñ")
    .replace(/[\uFFFD]/g, "Ñ")
    .replace(/\s+/g, " ")
    .trim();
}

function fromAtFields(text: string): ParsedDniScan | null {
  const parts = text.split("@").map((p) => p.trim());
  while (parts.length && parts[0] === "") parts.shift();
  if (parts.length < 5) return null;
  const dni = parts.find((c) => /^\d{7,8}$/.test(c)) || "";
  const lastName = fixNameEncoding(parts[1] || "");
  const firstName = fixNameEncoding(parts[2] || "");
  if (!dni && !lastName) return null;
  const tramite = /^\d{7,8}$/.test(parts[0] || "") && parts[0] === dni ? "" : parts[0] || "";
  return {
    dni,
    tramite,
    lastName,
    firstName,
    gender: genderCode(parts[3] || ""),
    birthDate: toIsoDate(parts[6] || parts[5] || ""),
    raw: text.slice(0, 400),
  };
}

/** Renaper PDF417 (dorso) y QR del frente: [tramite]@apellido@nombre@sexo@dni@... */
export function parseDniScan(raw: string): ParsedDniScan | null {
  const text = raw.trim().replace(/\u0000/g, "");
  if (!text) return null;

  if (text.includes("@")) {
    const parsed = fromAtFields(text);
    if (parsed) return parsed;
    const embedded = text.match(/@[^@\n]+@[^@\n]+@[MFX]@\d{7,8}@/i);
    if (embedded) {
      const start = text.lastIndexOf("@", text.indexOf(embedded[0]));
      const parsedEmbedded = fromAtFields(text.slice(Math.max(0, start)));
      if (parsedEmbedded) return parsedEmbedded;
    }
  }

  try {
    const url = new URL(text);
    const dni = url.searchParams.get("dni") || url.searchParams.get("documento") || "";
    if (/^\d{7,8}$/.test(dni)) {
      return { dni, tramite: "", lastName: "", firstName: "", gender: "", birthDate: "", raw: text.slice(0, 400) };
    }
  } catch {
    /* no es URL */
  }

  if (/^\d{7,8}$/.test(text)) {
    return { dni: text, tramite: "", lastName: "", firstName: "", gender: "", birthDate: "", raw: text };
  }

  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const dni = String(json.dni ?? json.documento ?? json.nroDocumento ?? json.number ?? "");
    if (/^\d{7,8}$/.test(dni)) {
      return {
        dni,
        tramite: String(json.tramite ?? json.idTramite ?? ""),
        lastName: String(json.apellido ?? json.lastName ?? ""),
        firstName: String(json.nombre ?? json.firstName ?? ""),
        gender: genderCode(String(json.sexo ?? json.gender ?? "")),
        birthDate: toIsoDate(String(json.fechaNacimiento ?? json.birthDate ?? "")),
        raw: text.slice(0, 400),
      };
    }
  } catch {
    /* no es JSON */
  }

  const idarg = text.match(/IDARG(\d{7,8})/i);
  if (idarg) {
    return { dni: idarg[1], tramite: "", lastName: "", firstName: "", gender: "", birthDate: "", raw: text.slice(0, 400) };
  }

  const labeled = text.match(/(?:dni|documento|nro_?doc(?:umento)?)[^\d]{0,12}(\d{7,8})\b/i);
  if (labeled) {
    return { dni: labeled[1], tramite: "", lastName: "", firstName: "", gender: "", birthDate: "", raw: text.slice(0, 400) };
  }

  return null;
}
