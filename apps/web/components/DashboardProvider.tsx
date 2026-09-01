"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, withTenant } from "@/lib/api";
import type { ModuleRow, Status, Tenant, User } from "@/lib/types";

type Dash = {
  user: User | null;
  tenants: Tenant[];
  tenantId: string | null;
  modules: ModuleRow[];
  kpis: { sites: number; users: number; eventsToday: number; openAlarms: number } | null;
  status: Status;
  error: string | null;
  loading: boolean;
  isPlatform: boolean;
  enabled: (key: string) => boolean;
  setTenant: (id: string) => void;
  toggleModule: (key: string, enabled: boolean) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<Dash | null>(null);

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [kpis, setKpis] = useState<Dash["kpis"]>(null);
  const [status, setStatus] = useState<Status>({
    agentOnline: null,
    engineOnline: null,
    engineUrl: null,
    eventsToday: 0,
    platesToday: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (forTenant?: string) => {
      const me = await api<{ user: User | null }>("/auth/me");
      if (!me.user) {
        setLoading(false);
        router.replace("/");
        return;
      }
      setUser(me.user);
      let id = forTenant ?? null;
      if (me.user.role === "platform_admin") {
        const list = await api<{ tenants: Tenant[] }>("/api/tenants");
        setTenants(list.tenants);
        id = forTenant ?? tenantId ?? list.tenants[0]?.id ?? null;
      } else {
        id = me.user.tenantId;
      }
      setTenantId(id);
      if (!id) {
        setLoading(false);
        return;
      }
      const mods = await api<{ modules: ModuleRow[] }>(`/api/tenants/${id}/modules`);
      setModules(mods.modules);
      const dash = await api<{
        kpis: { sites: number; users: number; eventsToday: number; openAlarms: number };
      }>(`/api/dashboard?tenantId=${id}`);
      setKpis(dash.kpis);
      const st = await api<{
        agentOnline: boolean;
        engineOnline?: boolean;
        engineUrl?: string;
        eventsToday: number;
        platesToday: number;
      }>(withTenant("/api/status", id));
      setStatus({
        agentOnline: st.agentOnline,
        engineOnline: st.engineOnline ?? null,
        engineUrl: st.engineUrl ?? null,
        eventsToday: st.eventsToday,
        platesToday: st.platesToday,
      });
      setKpis((k) => (k ? { ...k, eventsToday: st.eventsToday } : k));
      setLoading(false);
    },
    [router, tenantId],
  );

  useEffect(() => {
    load().catch((err) => {
      setError(err instanceof Error ? err.message : "Error");
      setLoading(false);
    });
    // Primera carga: no re-disparar cuando cambia tenantId (setTenant llama load a mano).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    const id = setInterval(() => {
      api<{
        agentOnline: boolean;
        engineOnline?: boolean;
        engineUrl?: string;
        eventsToday: number;
        platesToday: number;
      }>(withTenant("/api/status", tenantId))
        .then((st) => {
          setStatus({
            agentOnline: st.agentOnline,
            engineOnline: st.engineOnline ?? null,
            engineUrl: st.engineUrl ?? null,
            eventsToday: st.eventsToday,
            platesToday: st.platesToday,
          });
        })
        .catch(() => null);
    }, 8000);
    return () => clearInterval(id);
  }, [tenantId]);

  const value = useMemo<Dash>(
    () => ({
      user,
      tenants,
      tenantId,
      modules,
      kpis,
      status,
      error,
      loading,
      isPlatform: user?.role === "platform_admin",
      enabled: (key) => modules.some((m) => m.key === key && m.enabled),
      setTenant: (id) => {
        setLoading(true);
        load(id).catch((err) => setError(err instanceof Error ? err.message : "Error"));
      },
      toggleModule: async (key, enabled) => {
        if (!tenantId) return;
        setError(null);
        await api(`/api/tenants/${tenantId}/modules`, {
          method: "PATCH",
          body: JSON.stringify({ key, enabled }),
        });
        await load(tenantId);
      },
      logout: async () => {
        await api("/auth/logout", { method: "POST" });
        router.replace("/");
      },
      refresh: () => load(tenantId ?? undefined),
    }),
    [user, tenants, tenantId, modules, kpis, status, error, loading, load, router],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDash() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDash fuera del dashboard");
  return ctx;
}
