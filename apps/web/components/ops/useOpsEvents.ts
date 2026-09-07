"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, withTenant } from "@/lib/api";
import { parseFacialEvent, type EventRow } from "@/components/ops/parseFacialEvent";
import type { FacialEventAlert } from "@/components/LiveFacialAlertToast";

const ACTUATOR_POLL_MS = 12000;
/** Con SSE vivo: respaldo liviano. Sin SSE: más agresivo para que el toast no muera. */
const EVENTS_POLL_SSE_MS = 5000;
const EVENTS_POLL_FALLBACK_MS = 1500;
const EVENTS_KEEP = 24;

type Options = {
  tenantId: string | null;
  enabled: boolean;
  onAlert?: (alert: FacialEventAlert) => void;
};

/** Evita toast duplicado del mismo evento (HMR / remount). */
let lastEmittedToastId: string | null = null;

function toMs(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    // segundos unix vs ms
    return v > 0 && v < 1e12 ? v * 1000 : v;
  }
  if (v instanceof Date) return v.getTime();
  const n = Date.parse(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function emitFacialAlert(alert: FacialEventAlert) {
  const id = String(alert.id);
  if (lastEmittedToastId === id) return false;
  lastEmittedToastId = id;
  try {
    window.dispatchEvent(new CustomEvent("ap:facial-alert", { detail: alert }));
  } catch {
    // ignore
  }
  return true;
}

export function useOpsEvents({ tenantId, enabled, onAlert }: Options) {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [streamLive, setStreamLive] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());
  const hydratedRef = useRef(false);
  const streamLiveRef = useRef(false);
  const onAlertRef = useRef(onAlert);
  onAlertRef.current = onAlert;

  const notifyNew = useCallback((ev: EventRow) => {
    // Solo ids nuevos (seenRef). No filtrar por reloj: el watermark Date.now()
    // vs createdAt del server mataba el toast con desfase de reloj / SSE caído.
    const alert = parseFacialEvent(ev);
    if (!alert) return;
    if (!emitFacialAlert(alert)) return;
    onAlertRef.current?.(alert);
  }, []);

  useEffect(() => {
    if (!tenantId || !enabled) {
      setEvents([]);
      setStreamLive(false);
      streamLiveRef.current = false;
      seenRef.current = new Set();
      hydratedRef.current = false;
      return;
    }

    let closed = false;
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollInFlight = false;

    seenRef.current = new Set();
    hydratedRef.current = false;
    streamLiveRef.current = false;

    const toRow = (latest: EventRow): EventRow => {
      let payload: Record<string, unknown> = {};
      try {
        payload =
          typeof latest.payload === "string"
            ? (JSON.parse(latest.payload) as Record<string, unknown>)
            : ((latest.payload || {}) as Record<string, unknown>);
      } catch {
        payload = {};
      }
      return {
        id: String(latest.id),
        createdAt: toMs(latest.createdAt) || Date.now(),
        payload,
      };
    };

    const pushRows = (rows: EventRow[], toastNewest: boolean) => {
      if (!rows.length || closed) return;
      const fresh: EventRow[] = [];
      for (const raw of rows) {
        if (!raw?.id) continue;
        const row = toRow(raw);
        if (seenRef.current.has(row.id)) continue;
        seenRef.current.add(row.id);
        fresh.push(row);
      }
      if (!fresh.length) return;

      fresh.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));

      setEvents((prev) => {
        const merged = [...fresh, ...prev];
        const dedup = new Map<string, EventRow>();
        for (const e of merged) dedup.set(String(e.id), e);
        return [...dedup.values()]
          .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))
          .slice(0, EVENTS_KEEP);
      });

      if (toastNewest && hydratedRef.current) {
        notifyNew(fresh[0]!);
      }
    };

    const fetchList = async () => {
      const res = await api<{ events: EventRow[] }>(
        withTenant("/api/events?type=dahua_access", tenantId),
      );
      return (res?.events || []).map((e) => ({ ...e, id: String(e.id) }));
    };

    const schedulePoll = () => {
      if (closed) return;
      const delay = streamLiveRef.current ? EVENTS_POLL_SSE_MS : EVENTS_POLL_FALLBACK_MS;
      pollTimer = setTimeout(() => {
        void (async () => {
          if (closed) return;
          if (pollInFlight) {
            schedulePoll();
            return;
          }
          pollInFlight = true;
          try {
            const list = await fetchList();
            if (!closed) {
              const newcomers = list.filter((e) => e?.id && !seenRef.current.has(String(e.id)));
              pushRows(newcomers, true);
            }
          } catch (err) {
            console.warn("[ops-events] poll falló", err);
          } finally {
            pollInFlight = false;
            if (!closed) schedulePoll();
          }
        })();
      }, delay);
    };

    const boot = async () => {
      try {
        const list = (await fetchList()).slice(0, EVENTS_KEEP);
        if (closed) return;
        for (const e of list) {
          seenRef.current.add(String(e.id));
        }
        const rows = list.map((e) => toRow(e));
        setEvents(rows.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt)));
        if (rows[0]) lastEmittedToastId = String(rows[0].id);
      } catch (err) {
        console.warn("[ops-events] hydrate falló", err);
      }

      if (closed) return;
      hydratedRef.current = true;
      schedulePoll();

      const connectSse = () => {
        if (closed) return;
        try {
          es = new EventSource(withTenant("/api/events/stream?type=dahua_access", tenantId), {
            withCredentials: true,
          });
        } catch {
          streamLiveRef.current = false;
          setStreamLive(false);
          return;
        }
        es.addEventListener("connected", () => {
          streamLiveRef.current = true;
          setStreamLive(true);
        });
        const onPayload = (raw: string) => {
          try {
            const ev = JSON.parse(raw) as EventRow;
            if (ev?.id) {
              pushRows([ev], true);
              streamLiveRef.current = true;
              setStreamLive(true);
            }
          } catch {
            // ignore
          }
        };
        es.addEventListener("access_event", (e: MessageEvent) => onPayload(e.data));
        es.onmessage = (e: MessageEvent) => onPayload(e.data);
        es.onerror = () => {
          streamLiveRef.current = false;
          setStreamLive(false);
          es?.close();
          es = null;
          if (!closed) reconnectTimer = setTimeout(connectSse, 4000);
        };
      };
      connectSse();
    };

    void boot();

    return () => {
      closed = true;
      hydratedRef.current = false;
      es?.close();
      if (pollTimer) clearTimeout(pollTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      streamLiveRef.current = false;
      setStreamLive(false);
    };
  }, [tenantId, enabled, notifyNew]);

  return { events, streamLive };
}

export { ACTUATOR_POLL_MS };
