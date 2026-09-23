"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { type LiveDevice } from "@/components/DahuaLivePanel";
import { LiveFacialAlertToast, type FacialEventAlert } from "@/components/LiveFacialAlertToast";
import { OpsTopbar } from "@/components/ops/OpsTopbar";
import { MenuGrid, useOpsMenuTiles } from "@/components/ops/MenuGrid";
import { OpsStatusPanels } from "@/components/ops/SoftphonePanel";
import { ConfirmRelayModal } from "@/components/ops/ConfirmRelayModal";
import { OpsLaneConsole } from "@/components/ops/OpsLaneConsole";
import { OwnerAuthNotices } from "@/components/ops/OwnerAuthNotices";
import {
  buildLaneRelaySlots,
  buildLaneTopology,
  filterEventsForLane,
  type AccessPointWireRow,
} from "@/components/ops/laneTopology";
import { type Actuator, type RelaySlot } from "@/components/ops/relayPresets";
import { ACTUATOR_POLL_MS, useOpsEvents } from "@/components/ops/useOpsEvents";
import { mergeLaneActuatorIds, resolveOpenActuatorId } from "@/components/ops/resolveOpenRelay";
import { GuardApprovalQueue } from "@/components/ops/GuardApprovalQueue";
import { VisitorCheckinModal } from "@/components/VisitorCheckinModal";
import { AnnounceVisitModal } from "@/components/ops/AnnounceVisitModal";
import { useToast } from "@/components/Toast";

const OpsPlanMap = dynamic(
  () => import("@/components/ops/OpsPlanMap").then((m) => m.OpsPlanMap),
  {
    ssr: false,
    loading: () => (
      <section className="ops-predio-panel" aria-label="Plano del barrio">
        <header className="ops-lane-head">
          <span className="ops-lane-badge ops-lane-badge--map">Predio</span>
        </header>
        <p className="ops-predio-placeholder">Cargando plano…</p>
      </section>
    ),
  },
);

type Device = LiveDevice;

function preferLaneReader(wiredIds: string[], laneDevices: Device[]): string | null {
  const byId = new Map(laneDevices.map((d) => [d.id, d]));
  const rank = (id: string) => {
    const d = byId.get(id);
    if (!d) return 9;
    if (d.deviceType === "asi_facial" || d.deviceType === "vto_intercom") return 0;
    if (d.deviceType === "camera_ip") return 1;
    return 2;
  };
  const ids = [...new Set([...wiredIds.filter((id) => byId.has(id)), ...laneDevices.map((d) => d.id)])];
  ids.sort((a, b) => rank(a) - rank(b));
  return ids[0] ?? null;
}

function laneEventDeviceIds(all: Device[], wiredIds: string[], lane: "in" | "out"): string[] {
  const ids = new Set<string>();
  for (const d of all) {
    if (d.deviceType === "access_controller") continue;
    const sentido = (d.sentido || "in") === "out" ? "out" : "in";
    if (sentido === lane) ids.add(d.id);
  }
  for (const id of wiredIds) {
    const d = all.find((x) => x.id === id);
    if (!d || d.deviceType === "access_controller") continue;
    const sentido = (d.sentido || "in") === "out" ? "out" : "in";
    if (sentido === lane) ids.add(id);
  }
  return [...ids];
}

export function HomeDashboard() {
  const {
    tenantId,
    tenantName,
    plan,
    status,
    featureOn,
    enabled,
    can,
    isPlatform,
    tenants,
    setTenant,
    user,
    logout,
    loading,
    error: dashError,
  } = useDash();

  const [acts, setActs] = useState<Actuator[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [accessPoints, setAccessPoints] = useState<AccessPointWireRow[]>([]);
  /** Override de sesión si se elige lector por carril (sin AccesoCam en portería). */
  const [lanePick, setLanePick] = useState<{ in: string | null; out: string | null }>({
    in: null,
    out: null,
  });
  const [facialAlert, setFacialAlert] = useState<FacialEventAlert | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDanger, setPendingDanger] = useState<{
    id: string;
    label: string;
    action: "open" | "close";
  } | null>(null);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [announce, setAnnounce] = useState<{ propertyId: string; lotNumber: string } | null>(null);
  const toast = useToast();

  const showLivePage = featureOn("dahua.live") && can("dahua.live");
  const showEvents = featureOn("dahua.events") && can("dahua.events");
  const showActuators = enabled("actuators") && can("ops.relay");
  const showDevices = featureOn("dahua.devices") && can("access.dahua");
  const showOwnerAuth = enabled("visitors") && can("access.visitors.manage");
  const showPlan = can("ops.plano");
  const eventsEnabled = showEvents || showLivePage || enabled("dahua_access");

  const { events, streamLive } = useOpsEvents({
    tenantId,
    enabled: eventsEnabled,
    onAlert: (alert) => setFacialAlert(alert),
  });

  const menuTiles = useOpsMenuTiles();

  const manualActs = acts.filter((a) => a.triggerManual !== false);
  const topology = useMemo(
    () => buildLaneTopology(devices, manualActs, accessPoints),
    [devices, manualActs, accessPoints],
  );

  const liveableDevices = useMemo(
    () => devices.filter((d) => d.deviceType !== "access_controller" && d.useLive !== false),
    [devices],
  );
  const inLaneDevices = useMemo(
    () => liveableDevices.filter((d) => (d.sentido || "in") !== "out"),
    [liveableDevices],
  );
  const outLaneDevices = useMemo(
    () => liveableDevices.filter((d) => d.sentido === "out"),
    [liveableDevices],
  );

  const inSlots = useMemo(
    () => buildLaneRelaySlots(manualActs, topology.in.actuatorIds),
    [manualActs, topology.in.actuatorIds],
  );

  const wiredInId = preferLaneReader(topology.in.deviceIds, inLaneDevices);
  const wiredOutId = preferLaneReader(topology.out.deviceIds, outLaneDevices);
  const inDeviceId = lanePick.in ?? wiredInId;
  const outDeviceId = lanePick.out ?? wiredOutId;
  const sameDeviceLab = Boolean(inDeviceId && outDeviceId && inDeviceId === outDeviceId);

  const outSlots = useMemo(
    () =>
      buildLaneRelaySlots(
        manualActs,
        mergeLaneActuatorIds(topology.out.actuatorIds, topology.in.actuatorIds, sameDeviceLab),
      ),
    [manualActs, topology.out.actuatorIds, topology.in.actuatorIds, sameDeviceLab],
  );

  const inEvents = useMemo(
    () =>
      filterEventsForLane(events, laneEventDeviceIds(devices, topology.in.deviceIds, "in"), {
        lane: "in",
      }),
    [events, devices, topology.in.deviceIds],
  );
  const outEvents = useMemo(
    () =>
      filterEventsForLane(events, laneEventDeviceIds(devices, topology.out.deviceIds, "out"), {
        lane: "out",
      }),
    [events, devices, topology.out.deviceIds],
  );

  const opsStatus: "ok" | "degraded" | "offline" = status.agentOnline ? "ok" : "offline";

  function t(path: string) {
    return withTenant(path, tenantId);
  }

  async function loadCore() {
    if (!tenantId) return;
    const jobs: Promise<void>[] = [];

    if (showActuators) {
      jobs.push(
        api<{ actuators: Actuator[] }>(t("/api/actuators"))
          .then((d) => setActs(d.actuators))
          .catch(() => setActs([])),
      );
    } else {
      setActs([]);
    }

    if (showDevices || showLivePage || eventsEnabled) {
      jobs.push(
        api<{ devices: Device[] }>(t("/api/dahua"))
          .then((d) => setDevices(d.devices))
          .catch(() => setDevices([])),
      );
    } else {
      setDevices([]);
    }

    if (showActuators || showLivePage || showDevices || eventsEnabled) {
      jobs.push(
        api<{ accessPoints: AccessPointWireRow[] }>(t("/api/access-points"))
          .then((d) => setAccessPoints(d.accessPoints))
          .catch(() => setAccessPoints([])),
      );
    } else {
      setAccessPoints([]);
    }

    await Promise.all(jobs);
  }

  useEffect(() => {
    loadCore().catch((err) => setError(err instanceof Error ? err.message : "Error"));
    const id = setInterval(() => {
      loadCore().catch(() => null);
    }, ACTUATOR_POLL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, showActuators, showDevices, showLivePage, eventsEnabled]);

  useEffect(() => {
    function onAnnounce(e: Event) {
      const detail = (e as CustomEvent<{ propertyId?: string; lotNumber?: string }>).detail;
      if (!detail?.propertyId) return;
      setAnnounce({ propertyId: detail.propertyId, lotNumber: detail.lotNumber || "" });
    }
    window.addEventListener("ap:announce-lot", onAnnounce);
    return () => window.removeEventListener("ap:announce-lot", onAnnounce);
  }, []);

  async function fire(id: string, action: "open" | "close") {
    if (!tenantId) return;
    setBusy(`${action}-${id}`);
    setError(null);
    try {
      await api(t(`/api/actuators/${id}/${action}`), { method: "POST" });
      setActs((prev) =>
        prev.map((a) => (a.id === id ? { ...a, open: action === "open" } : a)),
      );
      const listed = await api<{ actuators: Actuator[] }>(t("/api/actuators"));
      setActs(listed.actuators);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo accionar");
    } finally {
      setBusy(null);
      setPendingDanger(null);
    }
  }

  function onToggleRelay(slot: RelaySlot) {
    const a = slot.actuator;
    if (!a) return;
    const action: "open" | "close" = a.open === true ? "close" : "open";
    if (slot.danger) {
      setPendingDanger({ id: a.id, label: slot.label, action });
      return;
    }
    void fire(a.id, action);
  }

  if (isPlatform && !tenantId) {
    if (loading) {
      return (
        <div className="grid flex-1 place-items-center text-sm text-slate-500 dark:text-muted">
          Cargando panel…
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-2xl py-10">
        <p className="font-mono text-[12px] tracking-[0.18em] text-accent">ACCESOPRO</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Plataforma</h1>
        <p className="mt-3 text-muted">
          {dashError
            ? dashError
            : tenants.length
              ? "Elegí un barrio local o abrí el concentrador de predios remotos."
              : "No hay barrios locales. Registrá un predio en Sistema → Barrios."}
        </p>
        {tenants.length > 0 ? (
          <label className="mt-6 block text-sm">
            <span className="mb-1.5 block text-slate-500 dark:text-muted">Barrio</span>
            <select
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-800 dark:border-line dark:bg-panel dark:text-slate-200"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) setTenant(e.target.value);
              }}
              aria-label="Barrio"
            >
              <option value="" disabled>
                Seleccionar…
              </option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/dashboard/barrios" className="btn-primary inline-flex">
            Nuevo barrio
          </Link>
          <Link href="/dashboard/modulos" className="btn-ghost inline-flex">
            Planes y módulos
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="ops-shell flex h-full min-h-0 flex-col gap-1.5 p-1">
      <OpsTopbar
        tenantId={tenantId}
        tenantName={tenantName}
        opsStatus={opsStatus}
        isPlatform={isPlatform}
        tenants={tenants}
        setTenant={setTenant}
        userName={user?.name ?? null}
        platesToday={status.platesToday}
        logout={logout}
        onRegisterVisit={showOwnerAuth ? () => setCheckinOpen(true) : undefined}
      />

      {error ? <p className="px-1 text-[12px] text-danger">{error}</p> : null}

      <div className="ops-lanes-grid">
        <OpsLaneConsole
          lane="in"
          showLive={false}
          showActuators={showActuators}
          devices={inLaneDevices}
          preferredDeviceId={inDeviceId}
          onDeviceChange={(id) => setLanePick((p) => ({ ...p, in: id }))}
          relaySlots={inSlots}
          busy={busy}
          onToggle={onToggleRelay}
          events={inEvents}
          streamLive={streamLive}
        />
        {showPlan ? (
          <OpsPlanMap />
        ) : (
          <section className="ops-predio-panel" aria-label="Plano del barrio">
            <header className="ops-lane-head">
              <span className="ops-lane-badge ops-lane-badge--map">Predio</span>
            </header>
            <p className="ops-predio-placeholder">Sin permiso para ver el plano</p>
          </section>
        )}
        <OpsLaneConsole
          lane="out"
          showLive={false}
          showActuators={showActuators}
          devices={outLaneDevices.length ? outLaneDevices : liveableDevices}
          preferredDeviceId={outDeviceId}
          onDeviceChange={(id) => setLanePick((p) => ({ ...p, out: id }))}
          relaySlots={outSlots}
          busy={busy}
          onToggle={onToggleRelay}
          events={outEvents}
          streamLive={streamLive}
        />
      </div>

      <OwnerAuthNotices tenantId={tenantId} enabled={showOwnerAuth} layout="strip" />
      <GuardApprovalQueue tenantId={tenantId || ""} enabled={Boolean(tenantId) && showOwnerAuth} />

      <div className="ops-lanes-footer">
        <MenuGrid tiles={menuTiles} compact />
        <OpsStatusPanels
          planName={plan?.name ?? null}
          agentOnline={!!status.agentOnline}
          platesToday={status.platesToday}
          deviceCount={devices.length}
          actuatorCount={manualActs.length}
          userName={user?.name ?? null}
          compact
          readerStuck={Object.values(status.readers ?? {}).some((r) => r.stuckHint === "face_stuck")}
        />
      </div>

      <LiveFacialAlertToast
        alert={facialAlert}
        onDismiss={() => setFacialAlert(null)}
        onOpenRelay={async (deviceId) => {
          const id = resolveOpenActuatorId({
            deviceId,
            actuators: manualActs.length ? manualActs : acts,
            inDeviceIds: topology.in.deviceIds,
            outDeviceIds: topology.out.deviceIds,
            inActuatorIds: topology.in.actuatorIds,
            outActuatorIds: sameDeviceLab
              ? mergeLaneActuatorIds(topology.out.actuatorIds, topology.in.actuatorIds, true)
              : topology.out.actuatorIds,
            inDeviceId,
            outDeviceId,
          });
          if (id) await fire(id, "open");
        }}
      />

      <ConfirmRelayModal
        open={!!pendingDanger}
        label={pendingDanger?.label ?? ""}
        action={pendingDanger?.action ?? "open"}
        busy={!!busy}
        onCancel={() => setPendingDanger(null)}
        onConfirm={() => {
          if (pendingDanger) void fire(pendingDanger.id, pendingDanger.action);
        }}
      />

      {tenantId && showOwnerAuth ? (
        <VisitorCheckinModal
          tenantId={tenantId}
          isOpen={checkinOpen}
          onClose={() => setCheckinOpen(false)}
          onSuccess={() => {
            setCheckinOpen(false);
            toast.success("Visita identificada", "El guardia tiene que aprobar la entrada. El propietario sigue pasando solo.");
          }}
        />
      ) : null}
      {tenantId && announce && showOwnerAuth ? (
        <AnnounceVisitModal
          tenantId={tenantId}
          propertyId={announce.propertyId}
          lotNumber={announce.lotNumber}
          onClose={() => setAnnounce(null)}
          onDone={(passId) => {
            window.dispatchEvent(new CustomEvent("ap:open-visit-approval", { detail: { passId } }));
          }}
        />
      ) : null}
    </div>
  );
}
