"use client";

import Link from "next/link";
import { OpsDashboard } from "@/components/OpsDashboard";
import { useDash } from "@/components/DashboardProvider";

export default function HomePage() {
  const { enabled, loading } = useDash();
  if (loading) return null;
  if (enabled("alpr")) {
    return <OpsDashboard />;
  }

  return (
    <div>
      <h1 className="text-xl font-bold">Dashboard</h1>
      <p className="mt-1 text-sm text-muted">Tildá el módulo de chapas para ver cámaras, barreras y detecciones.</p>
      <Link href="/dashboard/modulos" className="mt-4 inline-block text-accent">
        Ir a configuración
      </Link>
    </div>
  );
}
