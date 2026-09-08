"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiUrl, withTenant } from "@/lib/api";
import { parseFacialEvent, type EventRow } from "@/components/ops/parseFacialEvent";
import type { FacialEventAlert } from "@/components/LiveFacialAlertToast";

const ACTUATOR_POLL_MS = 16000;
/** Con SSE vivo: respaldo liviano. Sin SSE: más agresivo para que el toast no muera. */
const EVENTS_POLL_SSE_MS = 3500;
const EVENTS_POLL_FALLBACK_MS = 1000;
const EVENTS_KEEP = 24;

type Options = {
  tenantId: string | null;
  enabled: boolean;
  onAlert?: (alert: FacialEventAlert) => void;
};

/** Evita toast duplicado del mismo evento (HMR / remount). */
let lastEmittedToastId: string | null = null;

type SeenMark = { id: string; at: number };

function seenKey(tenantId: string) {
  return `ap:facial-toast:${tenantId}`;
}

function readSeenMark(tenantId: string): SeenMark | null {
  try {
    const raw = sessionStorage.getItem(seenKey(tenantId));
    if (!raw) return null;
    const v = JSON.parse(raw) as SeenMark;
    if (!v?.id) return null;
    return { id: String(v.id), at: Number(v.at) || 0 };
  } catch {
    return null;
  }
}

function writeSeenMark(tenantId: string, id: string, at: number) {
  try {
    sessionStorage.setItem(seenKey(tenantId), JSON.stringify({ id, at }));
  } catch {
    /* modo privado / quota */
  }
}

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
  const bootMaxCreatedAtRef = useRef(0);
  const tenantIdRef = useRef(tenantId);
  tenantIdRef.current = tenantId;
  const onAlertRef = useRef(onAlert);
  onAlertRef.current = onAlert;

  const notifyNew = useCallback((ev: EventRow) => {
    const alert = parseFacialEvent(ev);
    if (!alert) return;
    const ts = toMs(ev.createdAt);
    // Watermark del listado hidratado (reloj del server, no Date.now() del browser).
    if (ts && ts <= bootMaxCreatedAtRef.current) return;
    const tid = tenantIdRef.current;
    if (tid) {
      const prev = readSeenMark(tid);
      if (prev && (prev.id === String(alert.id) || (ts > 0 && ts <= prev.at))) return;
    }
    if (!emitFacialAlert(alert)) return;
    if (tid) writeSeenMark(tid, String(alert.id), ts || Date.now());
    onAlertRef.current?.(alert);
  }, []);

  useEffect(() => {
    if (!tenantId || !enabled) {
      setEvents([]);
      setStreamLive(false);
      streamLiveRef.current = false;
      seenRef.current = new Set();
      hydratedRef.current = false;
      bootMaxCreatedAtRef.current = 0;
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
    bootMaxCreatedAtRef.current = 0;

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
        createdAt: toMs(latest.createdAt),
        payload: {
          ...payload,
          ...(payload.sentido ? {} : latest.sentido ? { sentido: latest.sentido } : {}),
          ...(payload.laneCode != null
            ? {}
            : latest.laneCode != null
              ? { laneCode: latest.laneCode }
              : {}),
        },
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

    const markHydratedFrom = (rows: EventRow[]) => {
      const maxTs = rows.reduce((m, r) => Math.max(m, toMs(r.createdAt)), 0);
      bootMaxCreatedAtRef.current = maxTs;
      if (rows[0]) {
        lastEmittedToastId = String(rows[0].id);
        if (tenantId) writeSeenMark(tenantId, String(rows[0].id), maxTs);
      }
      hydratedRef.current = true;
    };

    let sseStarted = false;
    let lastSseAt = 0;
    const markSseAlive = () => {
      lastSseAt = Date.now();
      streamLiveRef.current = true;
      setStreamLive(true);
    };
    const connectSse = () => {
      if (closed || sseStarted) return;
      sseStarted = true;
      try {
        es = new EventSource(apiUrl(withTenant("/api/events/stream?type=dahua_access", tenantId)), {
          withCredentials: true,
        });
      } catch {
        sseStarted = false;
        streamLiveRef.current = false;
        setStreamLive(false);
        return;
      }
      es.addEventListener("connected", () => markSseAlive());
      es.addEventListener("ping", () => markSseAlive());
      const onPayload = (raw: string) => {
        try {
          const ev = JSON.parse(raw) as EventRow;
          if (ev?.id) {
            markSseAlive();
            pushRows([ev], true);
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
        sseStarted = false;
        if (!closed) reconnectTimer = setTimeout(connectSse, 1200);
      };
    };
    const sseWatch = setInterval(() => {
      if (closed || !sseStarted) return;
      if (lastSseAt && Date.now() - lastSseAt > 22000) {
        streamLiveRef.current = false;
        setStreamLive(false);
        es?.close();
        es = null;
        sseStarted = false;
        if (!closed) connectSse();
      }
    }, 4000);

    const fetchList = async () => {
      const res = await api<{ events: EventRow[] }>(
        withTenant("/api/events?type=dahua_access&limit=24", tenantId),
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
              if (!hydratedRef.current) {
                // Primera carga exitosa = hydrate silencioso (F5 / API tibia).
                for (const e of list) {
                  if (e?.id) seenRef.current.add(String(e.id));
                }
                const rows = list.map((e) => toRow(e)).sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
                setEvents(rows.slice(0, EVENTS_KEEP));
                markHydratedFrom(rows);
                connectSse();
              } else {
                const newcomers = list.filter((e) => e?.id && !seenRef.current.has(String(e.id)));
                pushRows(newcomers, true);
              }
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
        const list = await fetchList();
        if (closed) return;
        for (const e of list) {
          if (e?.id) seenRef.current.add(String(e.id));
        }
        const rows = list.map((e) => toRow(e)).sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
        setEvents(rows.slice(0, EVENTS_KEEP));
        markHydratedFrom(rows);
      } catch (err) {
        console.warn("[ops-events] hydrate falló", err);
      }

      if (closed) return;
      schedulePoll();
      if (hydratedRef.current) connectSse();
    };

    void boot();

    return () => {
      closed = true;
      hydratedRef.current = false;
      es?.close();
      if (pollTimer) clearTimeout(pollTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(sseWatch);
      streamLiveRef.current = false;
      setStreamLive(false);
    };
  }, [tenantId, enabled, notifyNew]);

  return { events, streamLive };
}

export { ACTUATOR_POLL_MS };
