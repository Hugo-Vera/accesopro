import { Hono } from "hono";

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
 * Emite un evento en tiempo real a todas las conexiones SSE abiertas.
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

function sseEncode(event: string, data: string, id?: string): Uint8Array {
  const lines: string[] = [];
  if (id) lines.push(`id: ${id}`);
  lines.push(`event: ${event}`);
  lines.push(`data: ${data}`);
  lines.push("", "");
  return new TextEncoder().encode(lines.join("\n"));
}

export const eventStreamRoutes = new Hono();

eventStreamRoutes.get("/events/stream", (c) => {
  const typeFilter = c.req.query("type") || undefined;
  const tenantFilter = c.req.query("tenantId") || undefined;

  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let onEvent: SSEListener | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          cleanup();
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (keepAlive) clearInterval(keepAlive);
        keepAlive = null;
        if (onEvent) listeners.delete(onEvent);
        onEvent = null;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      safeEnqueue(
        sseEncode("connected", JSON.stringify({ ok: true, timestamp: Date.now() })),
      );

      onEvent = (ev) => {
        if (typeFilter && ev.type !== typeFilter) return;
        if (tenantFilter && ev.tenantId && ev.tenantId !== tenantFilter) return;
        safeEnqueue(sseEncode("access_event", JSON.stringify(ev), String(ev.id)));
      };
      listeners.add(onEvent);

      keepAlive = setInterval(() => {
        safeEnqueue(sseEncode("ping", JSON.stringify({ time: Date.now() })));
      }, 15000);
    },
    cancel() {
      closed = true;
      if (keepAlive) clearInterval(keepAlive);
      if (onEvent) listeners.delete(onEvent);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
