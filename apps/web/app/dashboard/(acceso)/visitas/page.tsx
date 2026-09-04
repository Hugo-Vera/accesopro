"use client";

import { ModuleGate } from "@/components/PageHeader";

export default function VisitasPage() {
  return (
    <ModuleGate module="visitors">
      <div className="card p-6 text-sm">
        <p className="font-semibold">Visitas y propietarios</p>
        <p className="mt-2 text-muted">
          Los vecinos entran en <a className="text-accent" href="/portal">/portal</a> para autorizar empleados, generar QR y ver historial.
        </p>
        <p className="mt-2 text-muted">
          La administración gestiona lotes y logins en <a className="text-accent" href="/dashboard/propiedades">Propiedades</a>.
        </p>
      </div>
    </ModuleGate>
  );
}
