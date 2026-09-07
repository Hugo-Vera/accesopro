"use client";

import { DahuaLivePanel, type LiveDevice, type LiveLane } from "@/components/DahuaLivePanel";
import { RelayMatrix } from "@/components/ops/RelayMatrix";
import { LiveFacialFeed } from "@/components/ops/LiveFacialFeed";
import type { RelaySlot } from "@/components/ops/relayPresets";
import type { EventRow } from "@/components/ops/parseFacialEvent";

type Props = {
  lane: LiveLane;
  showLive: boolean;
  showActuators: boolean;
  devices: LiveDevice[];
  preferredDeviceId: string | null;
  onDeviceChange?: (deviceId: string | null) => void;
  relaySlots: RelaySlot[];
  busy: string | null;
  onToggle: (slot: RelaySlot) => void;
  events: EventRow[];
  streamLive: boolean;
  /** Orden del bloque principal: cam-first (ingreso) o feed-first. */
  order?: "cam-feed" | "feed-cam";
};

const TITLES: Record<LiveLane, { lane: string; relays: string; feed: string }> = {
  in: {
    lane: "Ingreso",
    relays: "ACTUADORES · INGRESO",
    feed: "HISTORIAL · INGRESO",
  },
  out: {
    lane: "Salida",
    relays: "ACTUADORES · SALIDA",
    feed: "HISTORIAL · SALIDA",
  },
};

export function OpsLaneConsole({
  lane,
  showLive,
  showActuators,
  devices,
  preferredDeviceId,
  onDeviceChange,
  relaySlots,
  busy,
  onToggle,
  events,
  streamLive,
  order = "cam-feed",
}: Props) {
  const t = TITLES[lane];

  const cam = (
    <div className="ops-cam-live-wrap ops-lane-cam" key="cam">
      {showLive ? (
        <DahuaLivePanel
          compact
          minimalChrome
          devices={devices}
          lane={lane}
          preferredDeviceId={preferredDeviceId}
          onDeviceChange={onDeviceChange}
        />
      ) : (
        <div className="grid h-full min-h-[140px] place-items-center bg-slate-900 text-[12px] text-slate-400">
          Live no habilitado
        </div>
      )}
    </div>
  );

  const feed = (
    <div className="ops-lane-feed" key="feed">
      <LiveFacialFeed
        title={t.feed}
        events={events}
        streamLive={streamLive}
        compact
        emptyHint={
          preferredDeviceId
            ? `Esperando accesos · ${t.lane.toLowerCase()}`
            : lane === "out"
              ? "Sin lector de salida configurado"
              : `Sin lector de ${t.lane.toLowerCase()}`
        }
      />
    </div>
  );

  return (
    <section className={`ops-lane ops-lane--${lane}`} aria-label={`Consola ${t.lane}`}>
      <header className="ops-lane-head">
        <span className={`ops-lane-badge ops-lane-badge--${lane}`}>{t.lane}</span>
      </header>

      <div className={`ops-lane-main ${order === "feed-cam" ? "ops-lane-main--feed-cam" : ""}`}>
        {order === "feed-cam" ? (
          <>
            {feed}
            {cam}
          </>
        ) : (
          <>
            {cam}
            {feed}
          </>
        )}
      </div>

      {showActuators ? (
        <RelayMatrix
          title={t.relays}
          slots={relaySlots}
          busy={busy}
          onToggle={onToggle}
          emptyHint={`Sin actuadores en ${t.lane.toLowerCase()}`}
        />
      ) : (
        <div className="ops-relay-strip">
          <p className="ops-relay-strip-label">ACTUADORES NO CONTRATADOS</p>
        </div>
      )}
    </section>
  );
}

/** Columnas sueltas del lado salida: historial | live (sin el rail de notificaciones). */
export function OpsOutColumns({
  showLive,
  showActuators,
  devices,
  preferredDeviceId,
  onDeviceChange,
  relaySlots,
  busy,
  onToggle,
  events,
  streamLive,
  streamEnabled = true,
}: Omit<Props, "lane" | "order"> & { streamEnabled?: boolean }) {
  return (
    <div className="ops-out-cols">
      <header className="ops-lane-head ops-out-cols-head">
        <span className="ops-lane-badge ops-lane-badge--out">Salida</span>
        {devices.length ? (
          <span className="ops-lane-hint">
            {streamEnabled ? "Lector activo para historial" : "Sin live en este carril"}
          </span>
        ) : (
          <span className="ops-lane-hint">Sin lector de salida configurado</span>
        )}
      </header>

      <div className="ops-out-cols-main">
        <div className="ops-lane-feed">
          <LiveFacialFeed
            title="HISTORIAL · SALIDA"
            events={events}
            streamLive={streamLive}
            compact
            emptyHint={
              devices.length
                ? "Esperando accesos · salida"
                : "Sin lector de salida configurado"
            }
          />
        </div>

        <div className="ops-cam-live-wrap ops-lane-cam">
          {showLive ? (
            <DahuaLivePanel
              compact
              minimalChrome
              devices={devices}
              lane="out"
              preferredDeviceId={preferredDeviceId}
              onDeviceChange={onDeviceChange}
              streamEnabled={streamEnabled}
            />
          ) : (
            <div className="grid h-full min-h-[140px] place-items-center bg-slate-900 text-[12px] text-slate-400">
              Live no habilitado
            </div>
          )}
        </div>
      </div>

      {showActuators ? (
        <RelayMatrix
          title="ACTUADORES · SALIDA"
          slots={relaySlots}
          busy={busy}
          onToggle={onToggle}
          emptyHint="Sin actuadores en salida"
        />
      ) : (
        <div className="ops-relay-strip">
          <p className="ops-relay-strip-label">ACTUADORES NO CONTRATADOS</p>
        </div>
      )}
    </div>
  );
}
