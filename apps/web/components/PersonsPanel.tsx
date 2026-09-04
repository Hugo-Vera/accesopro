"use client";

import { FormEvent, useEffect, useState } from "react";
import QRCode from "qrcode";
import { api, withTenant } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";

type Device = { id: string; name: string; host: string };
type Person = {
  userId: string;
  name: string;
  cardNo: string;
  recNo?: string;
};

function fileToJpegBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la foto"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const max = 600;
        let w = img.width;
        let h = img.height;
        if (w > max || h > max) {
          const scale = Math.min(max / w, max / h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas no disponible"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        resolve(dataUrl.split(",", 1)[1] || "");
      };
      img.onerror = () => reject(new Error("Imagen inválida"));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function PersonsPanel() {
  const { tenantId, status } = useDash();
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [persons, setPersons] = useState<Person[]>([]);
  const [name, setName] = useState("");
  const [userId, setUserId] = useState("");
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [photoB64, setPhotoB64] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [lastCard, setLastCard] = useState<string | null>(null);

  function t(path: string) {
    return withTenant(path, tenantId);
  }

  async function loadDevices() {
    if (!tenantId) return;
    const d = await api<{ devices: Device[] }>(t("/api/dahua"));
    setDevices(d.devices);
    setDeviceId((prev) => {
      if (prev && d.devices.some((x) => x.id === prev)) return prev;
      return d.devices[0]?.id ?? null;
    });
  }

  async function loadPersons(id: string) {
    const r = await api<{ ok?: boolean; persons?: Person[]; error?: string }>(t(`/api/dahua/${id}/persons`));
    setPersons(r.persons ?? []);
  }

  useEffect(() => {
    loadDevices().catch((err) => setError(err instanceof Error ? err.message : "Error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  useEffect(() => {
    if (!deviceId || !tenantId) return;
    loadPersons(deviceId).catch((err) => setError(err instanceof Error ? err.message : "Error al listar"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, tenantId]);

  async function onPhoto(file: File | null) {
    if (!file) {
      setPhotoB64(null);
      setPhotoName(null);
      return;
    }
    setPhotoName(file.name);
    const b64 = await fileToJpegBase64(file);
    setPhotoB64(b64);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tenantId || !deviceId) return;
    if (!photoB64) {
      setError("Subí una foto de la cara (JPG/PNG).");
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    setQrDataUrl(null);
    try {
      const uid = userId.trim() || undefined;
      const r = await api<{
        ok?: boolean;
        error?: string;
        qrPayload?: string;
        person?: { userId?: string; cardNo?: string; name?: string };
      }>(t(`/api/dahua/${deviceId}/persons`), {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          userId: uid,
          cardNo: uid,
          photoBase64: photoB64,
        }),
      });
      const card = r.qrPayload || r.person?.cardNo || uid || "";
      setLastCard(card);
      if (card) {
        const qr = await QRCode.toDataURL(card, { width: 240, margin: 1 });
        setQrDataUrl(qr);
      }
      setMsg(`Listo: ${r.person?.name || name} enrolado. Mostrá o imprimí el QR.`);
      setName("");
      setUserId("");
      setPhotoB64(null);
      setPhotoName(null);
      await loadPersons(deviceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo enrolar");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(p: Person) {
    if (!tenantId || !deviceId) return;
    if (!confirm(`¿Borrar a ${p.name || p.userId} del lector?`)) return;
    setBusy(true);
    setError(null);
    try {
      const q = p.cardNo ? `?cardNo=${encodeURIComponent(p.cardNo)}` : "";
      await api(t(`/api/dahua/${deviceId}/persons/${encodeURIComponent(p.userId)}${q}`), {
        method: "DELETE",
      });
      setMsg("Persona borrada del equipo.");
      await loadPersons(deviceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo borrar");
    } finally {
      setBusy(false);
    }
  }

  if (!tenantId) return <p className="text-sm text-muted">Elegí un barrio.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">
            Alta rápida: nombre + foto de cara. Se crea el usuario en el ASI y un QR (CardNo) para pasar.
          </p>
          <p className="mt-1 text-[12px] text-muted">
            Agent:{" "}
            <span className={status.agentOnline ? "text-ok" : "text-danger"}>
              {status.agentOnline ? "en línea" : "offline"}
            </span>
            . En el ASI tiene que estar on la lectura de QR.
          </p>
        </div>
        {devices.length > 0 ? (
          <select
            className="cfg-input mt-0 max-w-xs"
            value={deviceId ?? ""}
            onChange={(e) => setDeviceId(e.target.value)}
          >
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {msg ? <p className="text-sm text-ok">{msg}</p> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <form onSubmit={onSubmit} className="card space-y-3 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Nueva persona</p>
          <label className="text-sm">
            <span className="cfg-label">Nombre</span>
            <input className="cfg-input" value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <label className="text-sm">
            <span className="cfg-label">ID (opcional)</span>
            <input
              className="cfg-input"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="Se genera solo si lo dejás vacío"
            />
          </label>
          <label className="text-sm">
            <span className="cfg-label">Foto de cara (JPG/PNG)</span>
            <input
              className="cfg-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => onPhoto(e.target.files?.[0] ?? null).catch((err) => setError(String(err)))}
              required
            />
            {photoName ? <span className="mt-1 block text-[12px] text-muted">{photoName}</span> : null}
          </label>
          <p className="text-[12px] text-muted">
            Una cara de frente, buena luz, sin gorra/barbijo. Ideal ~500×500 px.
          </p>
          <button type="submit" className="btn-primary" disabled={busy || !status.agentOnline || !deviceId}>
            {busy ? "Enrolando…" : "Registrar cara + QR"}
          </button>
        </form>

        <div className="card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">QR de acceso</p>
          {qrDataUrl ? (
            <div className="mt-3 space-y-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="QR acceso" className="rounded-md border border-line bg-white p-2" />
              <p className="text-sm text-[#e0e0e0]">Código: {lastCard}</p>
              <p className="text-[12px] text-muted">La persona muestra este QR en el lector (si QR unlock está activo).</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">Después de registrar, acá sale el QR para imprimir o mandar al celu.</p>
          )}
        </div>
      </div>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">En el lector</p>
          <button
            type="button"
            className="btn-ghost"
            disabled={!deviceId || busy}
            onClick={() => deviceId && loadPersons(deviceId).catch((err) => setError(String(err)))}
          >
            Actualizar
          </button>
        </div>
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-ink/40 text-[11px] uppercase tracking-wider text-muted">
            <tr>
              <th className="px-3 py-2">Nombre</th>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Card / QR</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {persons.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-muted">
                  Todavía no hay personas listadas (o el equipo no respondió el listado).
                </td>
              </tr>
            ) : (
              persons.map((p) => (
                <tr key={`${p.userId}-${p.cardNo}-${p.recNo}`}>
                  <td className="px-3 py-2">{p.name || "—"}</td>
                  <td className="px-3 py-2 font-mono text-[12px] text-muted">{p.userId}</td>
                  <td className="px-3 py-2 font-mono text-[12px]">{p.cardNo || "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" className="btn-danger" disabled={busy} onClick={() => onDelete(p)}>
                      Borrar
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
