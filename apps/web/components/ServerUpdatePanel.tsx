"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RefreshCw, Download, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { api } from "@/lib/api";
import { useDash } from "@/components/DashboardProvider";
import { useEscapeKey } from "@/hooks/useEscapeKey";

type VersionInfo = {
  appVersion?: string;
  diskVersion?: string | null;
  imageStale?: boolean;
  repo: string;
  branch: string;
  localSha: string | null;
  remoteSha: string | null;
  remoteMessage: string | null;
  remoteUrl: string;
  updateAvailable: boolean;
  selfUpdateEnabled: boolean;
  hostDir: string | null;
  update: { status: string; error: string | null };
};

type UpdateStatus = {
  status: string;
  logTail?: string;
  error: string | null;
};

function shortSha(s: string | null) {
  return s ? s.slice(0, 7) : "—";
}

export function ServerUpdatePanel() {
  const { isPlatform, can } = useDash();
  const allowed = isPlatform || can("core.config");
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [hintCmd, setHintCmd] = useState<string | null>(null);

  const [sawDisconnect, setSawDisconnect] = useState(false);

  const load = useCallback(async () => {
    if (!allowed) return;
    try {
      const v = await api<VersionInfo>("/api/system/version");
      setInfo(v);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo leer la versión");
    }
  }, [allowed]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!modalOpen) return;
    const id = setInterval(() => {
      api<UpdateStatus>("/api/system/update-status")
        .then((st) => {
          setStatus(st);
          if (st.status === "ok" && sawDisconnect) {
            window.location.reload();
          }
        })
        .catch(() => {
          setSawDisconnect(true);
          setStatus({
            status: "running",
            error: null,
            logTail:
              "Corte breve: Docker está levantando API + web. Si el browser muestra conexión rechazada, esperá ~1 minuto y recargá. No es un fallo del update.",
          });
        });
    }, 3000);
    return () => clearInterval(id);
  }, [modalOpen, sawDisconnect]);

  useEffect(() => {
    const blob = `${status?.error ?? ""}\n${status?.logTail ?? ""}\n${error ?? ""}`;
    if (!/insufficient permission|dubious ownership|safe\.directory|\.git\/objects/i.test(blob)) return;
    setHintCmd(
      [
        "# Reparar dueño del repo y actualizar (consola Ubuntu):",
        'sudo chown -R "$USER:$USER" /opt/accesopro',
        "curl -fsSL https://raw.githubusercontent.com/Hugo-Vera/accesopro/master/scripts/update-ubuntu.sh | bash",
        "# Docs: docs/UPDATE_UBUNTU.md",
      ].join("\n"),
    );
  }, [status?.error, status?.logTail, error]);

  useEscapeKey(() => setModalOpen(false), modalOpen);

  if (!allowed) return null;

  async function onUpdate() {
    setBusy(true);
    setError(null);
    setHintCmd(null);
    setSawDisconnect(false);
    setModalOpen(true);
    setStatus({
      status: "running",
      error: null,
      logTail: "Lanzando updater suelto. El compile de Next puede tardar varios minutos con el sitio todavía arriba.",
    });
    try {
      const res = await api<{
        ok?: boolean;
        started?: boolean;
        message?: string;
        error?: string;
        hint?: string;
        command?: string;
      }>("/api/system/update", { method: "POST" });
      if (res.command) setHintCmd(res.command);
      if (res.started) {
        const st = await api<UpdateStatus>("/api/system/update-status").catch(() => null);
        if (st) setStatus(st);
      }
    } catch (err) {
      const extra = err as Error & { hint?: string; command?: string };
      const msg = extra instanceof Error ? extra.message : "Falló el update";
      setError(msg);
      if (extra.command) {
        setHintCmd([extra.hint, extra.command].filter(Boolean).join("\n"));
      } else if (/ya hay una actualización|updater Docker/i.test(msg)) {
        setHintCmd(
          [
            "El botón quedó trabado de un intento anterior. En la consola del Ubuntu (como hugo):",
            "sudo chown -R hugo:hugo /opt/accesopro",
            "curl -fsSL https://raw.githubusercontent.com/Hugo-Vera/accesopro/master/scripts/update-ubuntu.sh | bash",
          ].join("\n"),
        );
      }
      if (/fetch|network|Failed/i.test(msg)) {
        setModalOpen(true);
        setStatus({
          status: "running",
          error: null,
          logTail: "El servidor se está reiniciando. Esperá 1–2 minutos y recargá la página.",
        });
      }
    } finally {
      setBusy(false);
      void load();
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex flex-col gap-1 border-b border-slate-200 pb-4 dark:border-slate-800 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Servidor AccesoPro</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Versión {info?.appVersion ?? "—"} vs GitHub. El compile deja el sitio en línea; al final hay un corte breve de :3000.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <RefreshCw size={14} />
          Verificar
        </button>
      </div>

      {error ? <p className="mb-3 text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950/50">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Local {info?.appVersion ? `v${info.appVersion}` : ""}</p>
          <p className="mt-1 font-mono text-sm text-slate-900 dark:text-white">{shortSha(info?.localSha ?? null)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950/50">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">GitHub ({info?.branch ?? "master"})</p>
          <p className="mt-1 font-mono text-sm text-slate-900 dark:text-white">{shortSha(info?.remoteSha ?? null)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-950/50">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Estado</p>
          <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
            {info?.updateAvailable ? (info.imageStale ? "Docker desactualizado" : "Hay actualización") : info ? "Al día" : "—"}
          </p>
        </div>
      </div>

      {info?.remoteMessage ? (
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Último commit: {info.remoteMessage}
          {info.remoteUrl ? (
            <>
              {" · "}
              <a className="text-indigo-600 hover:underline dark:text-indigo-400" href={info.remoteUrl} target="_blank" rel="noreferrer">
                ver en GitHub
              </a>
            </>
          ) : null}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || !info}
          onClick={() => void onUpdate()}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download size={16} />
          {busy ? "Actualizando…" : "Actualizar servidor"}
        </button>
        {!info?.selfUpdateEnabled ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Self-update no habilitado en este host. El botón te muestra el comando o pedí ACCESOPRO_ALLOW_SELF_UPDATE=1.
          </p>
        ) : (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            El Next.js tarda varios minutos en compilar (el dashboard sigue). Después Docker recrea API y web: unos 30–90 s sin :3000. Si ves «conexión rechazada», esperá y recargá.
          </p>
        )}
      </div>

      {hintCmd ? (
        <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{hintCmd}</pre>
      ) : null}

      {modalOpen
        ? createPortal(
            <div className="fixed inset-0 z-[90] grid place-items-center bg-black/50 p-4">
              <button type="button" className="absolute inset-0 cursor-default" aria-label="Cerrar" onClick={() => setModalOpen(false)} />
              <div className="relative z-10 w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">Actualización del servidor</h3>
                  <button type="button" onClick={() => setModalOpen(false)} className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                    <X size={18} />
                  </button>
                </div>
                <div className="mb-3 flex items-center gap-2 text-sm">
                  {status?.status === "running" ? (
                    <>
                      <RefreshCw className="animate-spin text-indigo-600" size={16} />
                      <span>
                        En curso. El compile no tumba el sitio. Al recambiar contenedores :3000 se cae un minuto: eso es normal.
                      </span>
                    </>
                  ) : status?.status === "ok" ? (
                    <>
                      <CheckCircle2 className="text-emerald-600" size={16} />
                      <span>Listo. Recargá el dashboard.</span>
                    </>
                  ) : status?.status === "error" ? (
                    <>
                      <AlertTriangle className="text-rose-600" size={16} />
                      <span>{status.error || "Error"}</span>
                    </>
                  ) : (
                    <span>Esperando…</span>
                  )}
                </div>
                {status?.logTail ? (
                  <pre className="max-h-48 overflow-auto rounded-lg bg-slate-950 p-3 text-[11px] text-slate-200">{status.logTail}</pre>
                ) : null}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-600"
                    onClick={() => setModalOpen(false)}
                  >
                    Cerrar
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white"
                    onClick={() => window.location.reload()}
                  >
                    Recargar página
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
