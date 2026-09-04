"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, withTenant } from "@/lib/api";
import type { CamLaneStatus, FeatureRow, ModuleRow, PlanRow, Status, Tenant, User } from "@/lib/types";

function mapStatus(st: {
  agentOnline: boolean;
  engineOnline?: boolean;
  engineUrl?: string;
  eventsToday: number;
  platesToday: number;
  cameraIn?: CamLaneStatus | null;
  cameraOut?: CamLaneStatus | null;
  evidenceIn?: boolean;
  evidenceOut?: boolean;
}): Status {
  return {
    agentOnline: st.agentOnline,
    engineOnline: st.engineOnline ?? null,
    engineUrl: st.engineUrl ?? null,
    eventsToday: st.eventsToday,
    platesToday: st.platesToday,
    cameraIn: st.cameraIn ?? null,
    cameraOut: st.cameraOut ?? null,
    evidenceIn: Boolean(st.evidenceIn),
    evidenceOut: Boolean(st.evidenceOut),
  };
}

type Dash = {
  user: User | null;
  tenants: Tenant[];
  tenantId: string | null;
  tenantName: string | null;
  modules: ModuleRow[];
  features: FeatureRow[];
  plan: PlanRow | null;
  plans: PlanRow[];
  kpis: { sites: number; users: number; eventsToday: number; openAlarms: number } | null;
  status: Status;
  error: string | null;
  loading: boolean;
  isPlatform: boolean;
  isAdmin: boolean;
  enabled: (key: string) => boolean;
  featureOn: (key: string) => boolean;
  can: (capability: string) => boolean;
  setTenant: (id: string) => void;
  toggleModule: (key: string, enabled: boolean) => Promise<void>;
  toggleFeature: (key: string, enabled: boolean) => Promise<void>;
  assignPlan: (planId: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<Dash | null>(null);

export function DashboardProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [tenantName, setTenantName] = useState<string | null>(null);
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [features, setFeatures] = useState<FeatureRow[]>([]);
  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [kpis, setKpis] = useState<Dash["kpis"]>(null);
  const [status, setStatus] = useState<Status>({
    agentOnline: null,
    engineOnline: null,
    engineUrl: null,
    eventsToday: 0,
    platesToday: 0,
    cameraIn: null,
    cameraOut: null,
    evidenceIn: false,
    evidenceOut: false,
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
      if (me.user.role === "resident") {
        router.replace("/portal");
        return;
      }
      setUser(me.user);
      let id = forTenant ?? null;
      if (me.user.role === "platform_admin") {
        const list = await api<{ tenants: Tenant[] }>("/api/tenants");
        setTenants(list.tenants);
        id = forTenant ?? tenantId ?? list.tenants[0]?.id ?? null;
        const catalog = await api<{ plans: PlanRow[] }>("/api/plans");
        setPlans(catalog.plans);
      } else {
        id = me.user.tenantId;
      }
      setTenantId(id);
      if (!id) {
        setTenantName(null);
        setLoading(false);
        return;
      }
      const mods = await api<{ modules: ModuleRow[]; plan: PlanRow | null }>(`/api/tenants/${id}/modules`);
      setModules(mods.modules);
      setPlan(mods.plan);
      const feats = await api<{ features: FeatureRow[] }>(`/api/tenants/${id}/features`);
      setFeatures(feats.features);
      const dash = await api<{
        tenant?: { id: string; name: string };
        kpis: { sites: number; users: number; eventsToday: number; openAlarms: number };
      }>(`/api/dashboard?tenantId=${id}`);
      setTenantName(dash.tenant?.name ?? null);
      setKpis(dash.kpis);
      const st = await api<Parameters<typeof mapStatus>[0]>(withTenant("/api/status", id));
      setStatus(mapStatus(st));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!tenantId) return;
    const id = setInterval(() => {
      api<Parameters<typeof mapStatus>[0]>(withTenant("/api/status", tenantId))
        .then((st) => setStatus(mapStatus(st)))
        .catch(() => null);
    }, 8000);
    return () => clearInterval(id);
  }, [tenantId]);

  const value = useMemo<Dash>(
    () => ({
      user,
      tenants,
      tenantId,
      tenantName,
      modules,
      features,
      plan,
      plans,
      kpis,
      status,
      error,
      loading,
      isPlatform: user?.role === "platform_admin",
      isAdmin: user?.role === "platform_admin" || user?.role === "tenant_admin",
      enabled: (key) => modules.some((m) => m.key === key && m.enabled),
      featureOn: (key) => features.some((f) => f.key === key && f.enabled),
      can: (capability) => Boolean(user?.capabilities?.includes(capability)),
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
      toggleFeature: async (key, enabled) => {
        if (!tenantId) return;
        setError(null);
        await api(`/api/tenants/${tenantId}/features`, {
          method: "PATCH",
          body: JSON.stringify({ key, enabled }),
        });
        await load(tenantId);
      },
      assignPlan: async (planId) => {
        if (!tenantId) return;
        setError(null);
        await api(`/api/tenants/${tenantId}/subscription`, {
          method: "PUT",
          body: JSON.stringify({ planId }),
        });
        await load(tenantId);
      },
      logout: async () => {
        await api("/auth/logout", { method: "POST" });
        router.replace("/");
      },
      refresh: () => load(tenantId ?? undefined),
    }),
    [user, tenants, tenantId, tenantName, modules, features, plan, plans, kpis, status, error, loading, load, router],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDash() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDash fuera del dashboard");
  return ctx;
}
