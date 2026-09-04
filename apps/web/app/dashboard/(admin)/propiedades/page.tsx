"use client";

import { FormEvent, useEffect, useState } from "react";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { ModuleGate, PageHeader } from "@/components/PageHeader";

type Property = {
  id: string;
  lotNumber: string;
  label: string;
  address: string | null;
  mapLat: string | null;
  mapLng: string | null;
};

export default function PropiedadesPage() {
  const { tenantId } = useDash();
  const [rows, setRows] = useState<Property[]>([]);
  const [form, setForm] = useState({ lotNumber: "", label: "", address: "", mapLat: "", mapLng: "" });
  const [ownerForm, setOwnerForm] = useState({ propertyId: "", email: "", name: "", password: "", dni: "", phone: "" });

  useEffect(() => {
    if (!tenantId) return;
    api<{ properties: Property[] }>(withTenant("/api/residents/properties", tenantId)).then((d) => setRows(d.properties));
  }, [tenantId]);

  async function addProperty(e: FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    await api(withTenant("/api/residents/properties", tenantId), {
      method: "POST",
      body: JSON.stringify(form),
    });
    const d = await api<{ properties: Property[] }>(withTenant("/api/residents/properties", tenantId));
    setRows(d.properties);
    setForm({ lotNumber: "", label: "", address: "", mapLat: "", mapLng: "" });
  }

  async function addOwner(e: FormEvent) {
    e.preventDefault();
    if (!tenantId || !ownerForm.propertyId) return;
    await api(withTenant(`/api/residents/properties/${ownerForm.propertyId}/owners`, tenantId), {
      method: "POST",
      body: JSON.stringify(ownerForm),
    });
    setOwnerForm({ propertyId: "", email: "", name: "", password: "", dni: "", phone: "" });
  }

  return (
    <ModuleGate module="visitors">
      <PageHeader title="Propiedades y propietarios" subtitle="Lotes, pin GPS y login del vecino." />
      <form onSubmit={addProperty} className="card mb-4 grid gap-2 p-4 sm:grid-cols-3">
        <input className="cfg-input" placeholder="Nº lote" value={form.lotNumber} onChange={(e) => setForm({ ...form, lotNumber: e.target.value })} required />
        <input className="cfg-input" placeholder="Nombre / titular" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} required />
        <input className="cfg-input" placeholder="Dirección" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
        <input className="cfg-input" placeholder="Lat GPS" value={form.mapLat} onChange={(e) => setForm({ ...form, mapLat: e.target.value })} />
        <input className="cfg-input" placeholder="Lng GPS" value={form.mapLng} onChange={(e) => setForm({ ...form, mapLng: e.target.value })} />
        <button type="submit" className="btn-primary">Agregar propiedad</button>
      </form>
      <table className="card w-full text-sm">
        <thead className="text-left text-muted">
          <tr>
            <th className="p-3">Lote</th>
            <th>Titular</th>
            <th>GPS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-line">
              <td className="p-3">{r.lotNumber}</td>
              <td>{r.label}</td>
              <td className="text-muted">{r.mapLat && r.mapLng ? `${r.mapLat}, ${r.mapLng}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form onSubmit={addOwner} className="card mt-4 grid gap-2 p-4 sm:grid-cols-2">
        <h3 className="font-semibold sm:col-span-2">Crear login propietario</h3>
        <select className="cfg-input" value={ownerForm.propertyId} onChange={(e) => setOwnerForm({ ...ownerForm, propertyId: e.target.value })} required>
          <option value="">Elegir propiedad</option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>Lote {r.lotNumber} — {r.label}</option>
          ))}
        </select>
        <input className="cfg-input" placeholder="Email login" value={ownerForm.email} onChange={(e) => setOwnerForm({ ...ownerForm, email: e.target.value })} required />
        <input className="cfg-input" placeholder="Nombre" value={ownerForm.name} onChange={(e) => setOwnerForm({ ...ownerForm, name: e.target.value })} required />
        <input className="cfg-input" placeholder="Clave (8+)" type="password" value={ownerForm.password} onChange={(e) => setOwnerForm({ ...ownerForm, password: e.target.value })} required />
        <input className="cfg-input" placeholder="DNI" value={ownerForm.dni} onChange={(e) => setOwnerForm({ ...ownerForm, dni: e.target.value })} />
        <input className="cfg-input" placeholder="Teléfono" value={ownerForm.phone} onChange={(e) => setOwnerForm({ ...ownerForm, phone: e.target.value })} />
        <button type="submit" className="btn-primary sm:col-span-2">Crear propietario</button>
      </form>
    </ModuleGate>
  );
}
