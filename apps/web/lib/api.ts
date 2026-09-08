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
  const data = (await res.json()) as T & { error?: string; hint?: string; command?: string };
  if (!res.ok) {
    const err = new Error(data.error ?? `Error ${res.status}`) as Error & {
      hint?: string;
      command?: string;
    };
    err.hint = data.hint;
    err.command = data.command;
    throw err;
  }
  return data;
}

export function withTenant(path: string, tenantId: string | null) {
  if (!tenantId) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}tenantId=${encodeURIComponent(tenantId)}`;
}
