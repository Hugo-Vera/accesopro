"use client";

import { useRef } from "react";
import { Camera, ImagePlus, Trash2, X } from "lucide-react";
import { apiUrl, withTenant } from "@/lib/api";
import { fileToJpegDataUrl } from "@/lib/visitDocs";
import { Modal } from "@/components/ui/Modal";

export type TrunkCheck = {
  id: string;
  sentido: string;
  description: string | null;
  photoIds: string[];
  photoUrls: string[];
  at: string | number | null;
  guardName: string | null;
};

export type TrunkDraft = { description: string; add: string[]; remove: string[] };

export const TRUNK_MAX_PHOTOS = 6;

export function trunkDraftFrom(saved: TrunkCheck | null | undefined): TrunkDraft {
  return { description: saved?.description || "", add: [], remove: [] };
}

export function trunkDraftDirty(draft: TrunkDraft, saved: TrunkCheck | null | undefined) {
  return draft.add.length > 0 || draft.remove.length > 0 || draft.description.trim() !== (saved?.description || "").trim();
}

export function trunkPhotoSrc(tenantId: string, url: string) {
  return apiUrl(withTenant(url, tenantId));
}

function fmtAt(v: string | number | null) {
  if (v == null) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
}

type ZoomFn = (photos: string[], index: number) => void;

export function TrunkSavedCard({
  tenantId,
  check,
  title,
  onZoom,
}: {
  tenantId: string;
  check: TrunkCheck | null | undefined;
  title: string;
  onZoom: ZoomFn;
}) {
  const srcs = (check?.photoUrls || []).map((u) => trunkPhotoSrc(tenantId, u));
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-950">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</p>
      {check ? (
        <>
          <p className="mt-1 whitespace-pre-wrap text-[11px] text-slate-800 dark:text-slate-100">
            {check.description?.trim() || "Sin descripción"}
          </p>
          <p className="mt-0.5 text-[10px] text-slate-500">
            {fmtAt(check.at)}
            {check.guardName ? ` · ${check.guardName}` : ""}
          </p>
          {srcs.length ? (
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {srcs.map((src, i) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => onZoom(srcs, i)}
                  className="aspect-square overflow-hidden rounded-md border border-slate-200 dark:border-slate-700"
                  aria-label={`Ver foto ${i + 1}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-[10px] text-slate-500">Sin fotos.</p>
          )}
        </>
      ) : (
        <p className="mt-1 text-[11px] text-slate-500">No se registró.</p>
      )}
    </div>
  );
}

export function TrunkEditor({
  tenantId,
  saved,
  draft,
  onChange,
  onZoom,
  onError,
  disabled,
  title,
}: {
  tenantId: string;
  saved: TrunkCheck | null | undefined;
  draft: TrunkDraft;
  onChange: (next: TrunkDraft) => void;
  onZoom: ZoomFn;
  onError: (msg: string) => void;
  disabled?: boolean;
  title: string;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const savedPhotos = (saved?.photoIds || [])
    .map((id, i) => ({ id, src: trunkPhotoSrc(tenantId, saved?.photoUrls[i] || "") }))
    .filter((x) => !draft.remove.includes(x.id));
  const total = savedPhotos.length + draft.add.length;
  const allSrcs = [...savedPhotos.map((x) => x.src), ...draft.add];

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    const room = TRUNK_MAX_PHOTOS - total;
    if (room <= 0) {
      onError(`Máximo ${TRUNK_MAX_PHOTOS} fotos del baúl.`);
      return;
    }
    const picked = Array.from(files).slice(0, room);
    try {
      const urls = await Promise.all(picked.map((f) => fileToJpegDataUrl(f)));
      onChange({ ...draft, add: [...draft.add, ...urls] });
    } catch (err) {
      onError(err instanceof Error ? err.message : "No se pudo leer la foto");
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{title}</p>
      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
        Qué lleva en el baúl
        <textarea
          value={draft.description}
          disabled={disabled}
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
          rows={2}
          className="mt-0.5 w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-950 dark:text-white"
        />
      </label>
      <div className="grid grid-cols-3 gap-1.5">
        {savedPhotos.map((p, i) => (
          <div key={p.id} className="relative aspect-square overflow-hidden rounded-md border border-slate-200 dark:border-slate-700">
            <button type="button" className="h-full w-full" onClick={() => onZoom(allSrcs, i)} aria-label={`Ver foto ${i + 1}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.src} alt="" className="h-full w-full object-cover" />
            </button>
            {!disabled ? (
              <button
                type="button"
                className="absolute right-1 top-1 rounded bg-black/60 p-0.5 text-white"
                aria-label="Quitar foto"
                onClick={() => onChange({ ...draft, remove: [...draft.remove, p.id] })}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        ))}
        {draft.add.map((src, i) => (
          <div key={`new-${i}`} className="relative aspect-square overflow-hidden rounded-md border border-emerald-300 dark:border-emerald-700">
            <button type="button" className="h-full w-full" onClick={() => onZoom(allSrcs, savedPhotos.length + i)} aria-label={`Ver foto nueva ${i + 1}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-cover" />
            </button>
            <button
              type="button"
              className="absolute right-1 top-1 rounded bg-black/60 p-0.5 text-white"
              aria-label="Quitar foto nueva"
              onClick={() => onChange({ ...draft, add: draft.add.filter((_, j) => j !== i) })}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      {!disabled ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={total >= TRUNK_MAX_PHOTOS}
            onClick={() => cameraRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
          >
            <Camera className="h-3.5 w-3.5" />
            Sacar foto
          </button>
          <button
            type="button"
            disabled={total >= TRUNK_MAX_PHOTOS}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
          >
            <ImagePlus className="h-3.5 w-3.5" />
            Subir foto
          </button>
          <span className="self-center text-[10px] text-slate-500">
            {total}/{TRUNK_MAX_PHOTOS} fotos
          </span>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            aria-label="Foto del baúl con cámara"
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            aria-label="Subir fotos del baúl"
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Visor grande. El Escape lo maneja la pila del padre (closeOnEscape=false). */
export function TrunkPhotoZoom({
  photos,
  index,
  onIndex,
  onClose,
}: {
  photos: string[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const open = photos.length > 0;
  const src = photos[Math.min(Math.max(0, index), Math.max(0, photos.length - 1))];
  return (
    <Modal open={open} onClose={onClose} size="lg" zClass="z-[80]" closeOnEscape={false} panelClassName="p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          Foto {index + 1} de {photos.length}
        </p>
        <button type="button" onClick={onClose} className="rounded p-1 text-slate-500" aria-label="Cerrar">
          <X className="h-5 w-5" />
        </button>
      </div>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="max-h-[70vh] w-full rounded-lg bg-black object-contain" />
      ) : null}
      {photos.length > 1 ? (
        <div className="mt-2 flex justify-between">
          <button
            type="button"
            disabled={index <= 0}
            onClick={() => onIndex(index - 1)}
            className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
          >
            Anterior
          </button>
          <button
            type="button"
            disabled={index >= photos.length - 1}
            onClick={() => onIndex(index + 1)}
            className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
          >
            Siguiente
          </button>
        </div>
      ) : null}
    </Modal>
  );
}
