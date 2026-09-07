"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { type LiveDevice } from "@/components/DahuaLivePanel";
import { LiveFacialAlertToast, type FacialEventAlert } from "@/components/LiveFacialAlertToast";
import { OpsTopbar } from "@/components/ops/OpsTopbar";
import { MenuGrid, useOpsMenuTiles } from "@/components/ops/MenuGrid";
import { OpsStatusPanels } from "@/components/ops/SoftphonePanel";
import { ConfirmRelayModal } from "@/components/ops/ConfirmRelayModal";
import { OpsLaneConsole, OpsOutColumns } from "@/components/ops/OpsLaneConsole";
import { OwnerAuthNotices } from "@/components/ops/OwnerAuthNotices";
import {
  buildLaneRelaySlots,
  buildLaneTopology,
  filterEventsForLane,
  type AccessPointWireRow,
} from "@/components/ops/laneTopology";
import { type Actuator, type RelaySlot } from "@/components/ops/relayPresets";
import { ACTUATOR_POLL_MS, useOpsEvents } from "@/components/ops/useOpsEvents";

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
  } = useDash();

  const [acts, setActs] = useState<Actuator[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [accessPoints, setAccessPoints] = useState<AccessPointWireRow[]>([]);
  /** Override de sesión: elegir lector en AccesoCam = sentido activo (live + historial). */
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

  const showLive = featureOn("dahua.live") && can("dahua.live");
  const showEvents = featureOn("dahua.events") && can("dahua.events");
  const showActuators = enabled("actuators") && can("ops.relay");
  const showDevices = featureOn("dahua.devices") && can("access.dahua");
  const showOwnerAuth = enabled("visitors") && can("access.visitors.manage");
  const eventsEnabled = showEvents || showLive || enabled("dahua_access");

  const { events, streamLive } = useOpsEvents({
    tenantId,
    enabled: eventsEnabled,
    onAlert: (alert) => setFacialAlert(alert),
  });

  const menuTiles = useOpsMenuTiles({
    can,
    enabled,
    featureOn,
    showDevices,
    showEvents,
  });

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

  const outSlots = useMemo(
    () => buildLaneRelaySlots(manualActs, topology.out.actuatorIds),
    [manualActs, topology.out.actuatorIds],
  );

  const inEvents = useMemo(
    () => filterEventsForLane(events, laneEventDeviceIds(devices, topology.in.deviceIds, "in")),
    [events, devices, topology.in.deviceIds],
  );
  const outEvents = useMemo(
    () => filterEventsForLane(events, laneEventDeviceIds(devices, topology.out.deviceIds, "out")),
    [events, devices, topology.out.deviceIds],
  );

  const opsStatus: "ok" | "degraded" | "offline" = status.agentOnline
    ? "ok"
    : status.engineOnline
      ? "degraded"
      : "offline";

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

    if (showDevices || showLive) {
      jobs.push(
        api<{ devices: Device[] }>(t("/api/dahua"))
          .then((d) => setDevices(d.devices))
          .catch(() => setDevices([])),
      );
    } else {
      setDevices([]);
    }

    if (showActuators || showLive || showDevices) {
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
  }, [tenantId, showActuators, showDevices, showLive]);

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
    return (
      <div className="mx-auto max-w-2xl py-10">
        <p className="font-mono text-[12px] tracking-[0.18em] text-accent">ACCESOPRO</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Plataforma</h1>
        <p className="mt-3 text-muted">Elegí un barrio arriba para ver el panel operativo.</p>
        <Link href="/dashboard/modulos" className="btn-primary mt-6 inline-flex">
          Planes y módulos
        </Link>
      </div>
    );
  }

  return (
    <div className="ops-shell flex min-h-full flex-col gap-1.5 p-1 xl:h-full xl:min-h-0">
      <OpsTopbar
        tenantId={tenantId}
        tenantName={tenantName}
        opsStatus={opsStatus}
        isPlatform={isPlatform}
        tenants={tenants}
        setTenant={setTenant}
        userName={user?.name ?? null}
        engineOnline={!!status.engineOnline}
        logout={logout}
      />

      {error ? <p className="px-1 text-[12px] text-danger">{error}</p> : null}

      <div className="ops-lanes-grid">
        <OpsLaneConsole
          lane="in"
          showLive={showLive}
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
        <div className="ops-center-right">
          <OwnerAuthNotices tenantId={tenantId} enabled={showOwnerAuth} />
          <OpsOutColumns
            showLive={showLive}
            showActuators={showActuators}
            devices={outLaneDevices}
            preferredDeviceId={outDeviceId}
            onDeviceChange={(id) => setLanePick((p) => ({ ...p, out: id }))}
            relaySlots={outSlots}
            busy={busy}
            onToggle={onToggleRelay}
            events={outEvents}
            streamLive={streamLive}
            streamEnabled={Boolean(outDeviceId)}
          />
        </div>
      </div>

      <div className="ops-lanes-footer">
        <MenuGrid tiles={menuTiles} compact />
        <OpsStatusPanels
          planName={plan?.name ?? null}
          agentOnline={!!status.agentOnline}
          engineOnline={!!status.engineOnline}
          deviceCount={devices.length}
          actuatorCount={manualActs.length}
          userName={user?.name ?? null}
          compact
        />
      </div>

      <LiveFacialAlertToast
        alert={facialAlert}
        onDismiss={() => setFacialAlert(null)}
        onOpenRelay={async (deviceId) => {
          const byDev = manualActs.find(
            (a) => a.driver === "dahua" && a.dahuaDeviceId && a.dahuaDeviceId === deviceId,
          );
          if (byDev) {
            await fire(byDev.id, "open");
            return;
          }
          const inHit = topology.in.deviceIds.includes(deviceId) || inDeviceId === deviceId;
          const outHit = topology.out.deviceIds.includes(deviceId) || outDeviceId === deviceId;
          const poolIds = inHit
            ? topology.in.actuatorIds
            : outHit
              ? topology.out.actuatorIds
              : manualActs.map((a) => a.id);
          const pool = manualActs.filter((a) => poolIds.includes(a.id));
          const target =
            pool.find((a) => a.driver === "dahua" || a.kind === "gate" || a.kind === "underground") ||
            pool[0] ||
            acts[0];
          if (target) await fire(target.id, "open");
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
    </div>
  );
}
