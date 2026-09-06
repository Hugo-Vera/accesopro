import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const apiInternal = (process.env.API_INTERNAL_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");

const nextConfig: NextConfig = {
  transpilePackages: ["@accesopro/catalog"],
  output: "standalone",
  outputFileTracingRoot: path.join(path.dirname(fileURLToPath(import.meta.url)), "../.."),
  // Mismo origen (:3000) → API local. Así ZeroTier/LAN no dependen de localhost en el cliente.
  // fallback = solo si no hay page/route local (el SSE vive en app/api/events/stream)
  async rewrites() {
    return {
      fallback: [
        { source: "/auth/:path*", destination: `${apiInternal}/auth/:path*` },
        { source: "/api/:path*", destination: `${apiInternal}/api/:path*` },
        { source: "/health", destination: `${apiInternal}/health` },
      ],
    };
  },
};

export default nextConfig;
