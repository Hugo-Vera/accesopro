import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Proxy MJPEG sin buffer: el rewrite de Next atrasa el live (igual que el SSE).
 * El browser habla same-origin (/api/dahua/:id/live) y acá reenviamos a la API.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const apiBase = (process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
  const qs = req.nextUrl.searchParams.toString();
  const upstream = `${apiBase}/api/dahua/${encodeURIComponent(id)}/live${qs ? `?${qs}` : ""}`;

  try {
    const ac = new AbortController();
    const stop = () => ac.abort();
    if (req.signal.aborted) stop();
    else req.signal.addEventListener("abort", stop, { once: true });

    const cookie = req.headers.get("cookie") ?? "";
    const upstreamRes = await fetch(upstream, {
      headers: {
        Accept: "multipart/x-mixed-replace",
        Cookie: cookie,
      },
      cache: "no-store",
      signal: ac.signal,
    });

    if (!upstreamRes.ok) {
      const text = await upstreamRes.text().catch(() => "");
      return new Response(text || upstreamRes.statusText || "Live upstream error", {
        status: upstreamRes.status >= 400 ? upstreamRes.status : 502,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    if (!upstreamRes.body) {
      return new Response("Live sin cuerpo", { status: 502 });
    }

    const reader = upstreamRes.body.getReader();
    const cancelUp = () => {
      stop();
      void reader.cancel().catch(() => undefined);
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) {
            controller.close();
            return;
          }
          controller.enqueue(next.value);
        } catch {
          controller.close();
        }
      },
      cancel() {
        cancelUp();
      },
    });

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type":
          upstreamRes.headers.get("Content-Type") || "multipart/x-mixed-replace; boundary=frame",
        "Cache-Control": "no-cache, no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    const aborted =
      (typeof err === "object" && err !== null && "name" in err && (err as { name: string }).name === "AbortError") ||
      (err instanceof Error && /abort/i.test(err.message));
    if (aborted) {
      return new Response(null, { status: 499 });
    }
    const msg = err instanceof Error ? err.message : "Live proxy error";
    console.error("[live-proxy]", msg);
    return new Response(msg, { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
