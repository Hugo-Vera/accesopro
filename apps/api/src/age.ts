/** Edad a partir de YYYY-MM-DD, DD/MM/YYYY o DNI (AAAAMMDD). */

export function parseBirthDate(raw: string | null | undefined): Date | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const d = new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const compact = text.replace(/\D/g, "");
  if (compact.length === 8) {
    const y = Number(compact.slice(0, 4));
    const m = Number(compact.slice(4, 6));
    const day = Number(compact.slice(6, 8));
    if (y > 1900 && y < 2100 && m >= 1 && m <= 12) {
      const d = new Date(y, m - 1, day);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

export function yearsFromBirthDate(raw: string | null | undefined, now = new Date()): number | null {
  const born = parseBirthDate(raw);
  if (!born) return null;
  let years = now.getFullYear() - born.getFullYear();
  const md = now.getMonth() - born.getMonth();
  if (md < 0 || (md === 0 && now.getDate() < born.getDate())) years -= 1;
  return years < 0 || years > 130 ? null : years;
}

export function isMinorBirthDate(raw: string | null | undefined, now = new Date()): boolean {
  const years = yearsFromBirthDate(raw, now);
  return years != null && years < 18;
}

export function companionIsMinor(row: { isMinor?: boolean | number | null; birthDate?: string | null }): boolean {
  if (row.isMinor === true || row.isMinor === 1) return true;
  return isMinorBirthDate(row.birthDate);
}
