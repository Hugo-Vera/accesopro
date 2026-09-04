// Vacío = mismo origen (Next rewrites a la API). Ideal para LAN / ZeroTier.
const API = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error ?? `Error ${res.status}`);
  }
  return data;
}

export function withTenant(path: string, tenantId: string | null) {
  if (!tenantId) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}tenantId=${encodeURIComponent(tenantId)}`;
}
