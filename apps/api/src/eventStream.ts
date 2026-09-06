import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

export type RealtimeEvent = {
  id: string;
  siteId?: string;
  tenantId?: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: number | string;
};

type SSEListener = (event: RealtimeEvent) => void;

const listeners = new Set<SSEListener>();

/**
 * Emite un evento en tiempo real a todas las conexiones SSE abiertas (latencia < 5ms).
 */
export function broadcastRealtimeEvent(event: RealtimeEvent) {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Ignorar errores de clientes desconectados
    }
  }
}

export const eventStreamRoutes = new Hono();

eventStreamRoutes.get("/events/stream", (c) => {
  const typeFilter = c.req.query("type");
  const tenantFilter = c.req.query("tenantId");
  c.header("Cache-Control", "no-cache, no-transform");
  c.header("X-Accel-Buffering", "no");

  return streamSSE(c, async (stream) => {
    // Enviamos saludo inicial para confirmar la conexión SSE
    await stream.writeSSE({
      event: "connected",
      data: JSON.stringify({ ok: true, timestamp: Date.now() }),
    });

    const onEvent: SSEListener = async (ev) => {
      if (typeFilter && ev.type !== typeFilter) return;
      if (tenantFilter && ev.tenantId && ev.tenantId !== tenantFilter) return;
      try {
        await stream.writeSSE({
          event: "access_event",
          id: ev.id,
          data: JSON.stringify(ev),
        });
      } catch {
        listeners.delete(onEvent);
      }
    };

    listeners.add(onEvent);

    // Keep-alive heartbeat cada 15 segundos para evitar timeouts de proxies/navegadores
    const keepAlive = setInterval(async () => {
      try {
        await stream.writeSSE({
          event: "ping",
          data: JSON.stringify({ time: Date.now() }),
        });
      } catch {
        clearInterval(keepAlive);
        listeners.delete(onEvent);
      }
    }, 15000);

    stream.onAbort(() => {
      clearInterval(keepAlive);
      listeners.delete(onEvent);
    });

    // Mantener abierta la conexión mientras el cliente esté conectado
    while (!stream.aborted) {
      await stream.sleep(10000);
    }
  });
});
