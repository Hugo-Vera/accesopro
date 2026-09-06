import { type NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Proxy SSE sin buffer: el rewrite de Next suele cortar/atrasar event-stream.
 * El browser habla same-origin (/api/events/stream) y acá reenviamos a la API.
 */
export async function GET(req: NextRequest) {
  const apiBase = (process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
  const qs = req.nextUrl.searchParams.toString();
  const upstream = `${apiBase}/api/events/stream${qs ? `?${qs}` : ""}`;

  const cookie = req.headers.get("cookie") ?? "";
  const upstreamRes = await fetch(upstream, {
    headers: {
      Accept: "text/event-stream",
      Cookie: cookie,
    },
    cache: "no-store",
  });

  if (!upstreamRes.ok || !upstreamRes.body) {
    return new Response(upstreamRes.statusText || "SSE upstream error", {
      status: upstreamRes.status || 502,
    });
  }

  return new Response(upstreamRes.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
