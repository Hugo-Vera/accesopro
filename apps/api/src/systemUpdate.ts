import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { requireAuth, type AuthUser } from "./auth.js";
import { denyUnlessCapability } from "./grants.js";
import { APP_VERSION } from "./version.js";

type Env = { Variables: { user: AuthUser } };

const execFileAsync = promisify(execFile);

const REPO = process.env.ACCESOPRO_REPO ?? "Hugo-Vera/accesopro";
const BRANCH = process.env.ACCESOPRO_BRANCH ?? "master";
const HOST_DIR = process.env.ACCESOPRO_HOST_DIR ?? "";
const HOST_PATH = process.env.ACCESOPRO_HOST_PATH || "/opt/accesopro";
const UPDATER_NAME = "accesopro-updater";
const ALLOW =
  process.env.ACCESOPRO_ALLOW_SELF_UPDATE === "1" ||
  process.env.ACCESOPRO_ALLOW_SELF_UPDATE === "true";

type UpdateState = {
  status: "idle" | "running" | "ok" | "error";
  startedAt: number | null;
  finishedAt: number | null;
  log: string;
  error: string | null;
};

let state: UpdateState = {
  status: "idle",
  startedAt: null,
  finishedAt: null,
  log: "",
  error: null,
};

function canUpdate(user: AuthUser): boolean {
  return user.role === "platform_admin";
}

/** Marca el bind-mount como safe.directory (owner host != root del contenedor). */
async function ensureSafeGitDir() {
  if (!HOST_DIR) return;
  try {
    await execFileAsync("git", ["config", "--global", "--add", "safe.directory", HOST_DIR], {
      timeout: 5000,
    });
  } catch {
    /* ignore duplicates / missing git */
  }
}

async function localSha(): Promise<string | null> {
  if (HOST_DIR && existsSync(join(HOST_DIR, ".git"))) {
    try {
      await ensureSafeGitDir();
      const { stdout } = await execFileAsync("git", ["-C", HOST_DIR, "rev-parse", "HEAD"], {
        timeout: 8000,
      });
      return stdout.trim().slice(0, 40);
    } catch {
      /* fall through */
    }
  }
  const baked = process.env.ACCESOPRO_GIT_SHA?.trim();
  return baked || null;
}

async function remoteSha(): Promise<{ sha: string; htmlUrl: string; message: string } | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "AccesoPro-Updater",
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      sha?: string;
      html_url?: string;
      commit?: { message?: string };
    };
    if (!data.sha) return null;
    return {
      sha: data.sha.slice(0, 40),
      htmlUrl: data.html_url ?? `https://github.com/${REPO}`,
      message: (data.commit?.message ?? "").split("\n")[0] ?? "",
    };
  } catch {
    return null;
  }
}

function appendLog(line: string) {
  state.log = `${state.log}${line}\n`.slice(-12000);
}

function dataDir() {
  if (HOST_DIR) return join(HOST_DIR, "apps/api/data");
  return join(process.cwd(), "data");
}

function writeStatusFile(status: "running" | "ok" | "error", error?: string | null) {
  try {
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(join(dataDir(), "update.status"), `${status}\n`);
    if (error) writeFileSync(join(dataDir(), "update.error"), error);
  } catch {
    /* ignore */
  }
}

function readDiskStatus(): { status: string; log: string; error: string | null } {
  const dir = dataDir();
  let diskStatus = "";
  let log = "";
  let error: string | null = null;
  try {
    diskStatus = readFileSync(join(dir, "update.status"), "utf8").trim();
  } catch {
    /* missing */
  }
  try {
    log = readFileSync(join(dir, "update.log"), "utf8").slice(-8000);
  } catch {
    /* missing */
  }
  try {
    error = readFileSync(join(dir, "update.error"), "utf8").trim() || null;
  } catch {
    /* missing */
  }
  return { status: diskStatus, log, error };
}

async function resolveSelfImage(): Promise<string> {
  const hid = (process.env.HOSTNAME || "").trim();
  if (hid) {
    try {
      const { stdout } = await execFileAsync("docker", ["inspect", "-f", "{{.Config.Image}}", hid], {
        timeout: 8000,
      });
      const img = stdout.trim();
      if (img) return img;
    } catch {
      /* ignore */
    }
  }
  return "accesopro-api";
}

async function inspectUpdater(): Promise<{ running: boolean; exitCode: number | null; logs: string } | null> {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["inspect", "-f", "{{.State.Running}} {{.State.ExitCode}}", UPDATER_NAME],
      { timeout: 8000 },
    );
    const [runningRaw, codeRaw] = stdout.trim().split(/\s+/);
    const running = runningRaw === "true";
    const exitCode = Number(codeRaw);
    let logs = "";
    try {
      const lr = await execFileAsync("docker", ["logs", "--tail", "80", UPDATER_NAME], {
        timeout: 8000,
        maxBuffer: 512 * 1024,
      });
      logs = `${lr.stdout || ""}${lr.stderr || ""}`.slice(-4000);
    } catch {
      /* ignore */
    }
    return { running, exitCode: Number.isFinite(exitCode) ? exitCode : null, logs };
  } catch {
    return null;
  }
}

async function spawnDetachedUpdater(): Promise<string> {
  await execFileAsync("docker", ["rm", "-f", UPDATER_NAME], { timeout: 15000 }).catch(() => undefined);
  const image = await resolveSelfImage();
  const script = join(HOST_PATH, "scripts", "update-ubuntu.sh");
  const { stdout } = await execFileAsync(
    "docker",
    [
      "run",
      "-d",
      "--name",
      UPDATER_NAME,
      "-v",
      "/var/run/docker.sock:/var/run/docker.sock",
      "-v",
      `${HOST_PATH}:${HOST_PATH}`,
      "-e",
      `ACCESOPRO_DIR=${HOST_PATH}`,
      "-e",
      `ACCESOPRO_OWNER=${process.env.ACCESOPRO_OWNER ?? ""}`,
      "-e",
      `ACCESOPRO_PROFILE=${process.env.ACCESOPRO_PROFILE ?? "dahua"}`,
      "-e",
      `ACCESOPRO_BRANCH=${BRANCH}`,
      "-e",
      "ACCESOPRO_SKIP_AUTOSTART=1",
      "-w",
      HOST_PATH,
      "--entrypoint",
      "bash",
      image,
      script,
    ],
    { timeout: 30000 },
  );
  return stdout.trim();
}

function publicUpdateView() {
  const disk = readDiskStatus();
  let status = state.status;
  let error = state.error;
  let log = state.log;
  if (disk.log) log = disk.log;
  if (disk.status === "ok") {
    status = "ok";
    error = null;
  } else if (disk.status === "error") {
    status = "error";
    error = disk.error || error || "El script de update falló";
  } else if (disk.status === "running") {
    if (status !== "ok") status = "running";
  }
  return { status, error, log };
}

async function runHostUpdate() {
  state = {
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    log: "",
    error: null,
  };
  writeStatusFile("running");
  appendLog("Iniciando actualización despegada del API…");

  if (!HOST_DIR || !existsSync(HOST_DIR)) {
    state.status = "error";
    state.error = "ACCESOPRO_HOST_DIR no montado (esperado /opt/accesopro en el host)";
    state.finishedAt = Date.now();
    writeStatusFile("error", state.error);
    appendLog(state.error);
    return;
  }

  try {
    await ensureSafeGitDir();
    appendLog(`safe.directory → ${HOST_DIR}`);
    appendLog(`Host path para Docker: ${HOST_PATH}`);
    const cid = await spawnDetachedUpdater();
    appendLog(`Updater suelto ${cid.slice(0, 12) || UPDATER_NAME} (el API se puede recrear sin matar el compile).`);
    appendLog("Durante el build el dashboard sigue. Al final hay un corte breve de :3000.");
  } catch (spawnErr) {
    appendLog(`No se pudo soltar el updater (${spawnErr instanceof Error ? spawnErr.message : String(spawnErr)}). Fallback in-process.`);
    const script = join(HOST_DIR, "scripts", "update-ubuntu.sh");
    try {
      const { stdout, stderr } = await execFileAsync("bash", [script], {
        cwd: HOST_DIR,
        timeout: 20 * 60 * 1000,
        env: {
          ...process.env,
          ACCESOPRO_DIR: HOST_DIR,
          ACCESOPRO_PROFILE: process.env.ACCESOPRO_PROFILE ?? "dahua",
          ACCESOPRO_OWNER: process.env.ACCESOPRO_OWNER ?? "",
          ACCESOPRO_SKIP_AUTOSTART: "1",
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        },
        maxBuffer: 4 * 1024 * 1024,
      });
      if (stdout) appendLog(stdout);
      if (stderr) appendLog(stderr);
      state.status = "ok";
      state.finishedAt = Date.now();
      writeStatusFile("ok");
      appendLog("Actualización terminada. Recargá el dashboard.");
    } catch (err) {
      state.status = "error";
      state.finishedAt = Date.now();
      state.error = err instanceof Error ? err.message : String(err);
      writeStatusFile("error", state.error);
      appendLog(`ERROR: ${state.error}`);
    }
  }
}

export const systemApi = new Hono<Env>();

systemApi.use("*", requireAuth);

systemApi.get("/system/version", async (c) => {
  const user = c.get("user");
  const denied = await denyUnlessCapability(user, "core.config");
  if (denied && user.role !== "platform_admin") return denied;

  const [local, remote] = await Promise.all([localSha(), remoteSha()]);
  const updateAvailable = Boolean(local && remote && local !== remote.sha);

  return c.json({
    appVersion: APP_VERSION,
    repo: REPO,
    branch: BRANCH,
    localSha: local,
    remoteSha: remote?.sha ?? null,
    remoteMessage: remote?.message ?? null,
    remoteUrl: remote?.htmlUrl ?? `https://github.com/${REPO}`,
    updateAvailable,
    selfUpdateEnabled: ALLOW && Boolean(HOST_DIR),
    hostDir: HOST_DIR || null,
    hostPath: HOST_PATH,
    update: {
      status: publicUpdateView().status,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      error: publicUpdateView().error,
    },
  });
});

systemApi.get("/system/update-status", async (c) => {
  const user = c.get("user");
  if (!canUpdate(user)) {
    const denied = await denyUnlessCapability(user, "core.config");
    if (denied) return denied;
  }
  const view = publicUpdateView();
  const up = await inspectUpdater();
  let status = view.status;
  let error = view.error;
  let log = view.log;
  if (up?.running) status = "running";
  if (up && !up.running && up.exitCode !== 0 && up.exitCode != null && status !== "ok") {
    status = "error";
    error = error || `updater exit ${up.exitCode}`;
  }
  if (up && !up.running && up.exitCode === 0) status = "ok";
  if (up?.logs) log = up.logs;
  return c.json({
    ...state,
    status,
    error,
    log,
    logTail: log.slice(-4000),
  });
});

systemApi.post("/system/update", async (c) => {
  const user = c.get("user");
  if (user.role !== "platform_admin") {
    const denied = await denyUnlessCapability(user, "core.config");
    if (denied) return denied;
  }
  if (!ALLOW) {
    return c.json(
      {
        error: "Self-update deshabilitado",
        hint: "En el Ubuntu: ACCESOPRO_ALLOW_SELF_UPDATE=1 y montar /opt/accesopro + docker.sock",
        command:
          "curl -fsSL https://raw.githubusercontent.com/Hugo-Vera/accesopro/master/scripts/update-ubuntu.sh | bash",
      },
      400,
    );
  }
  if (state.status === "running") {
    return c.json({ error: "Ya hay una actualización en curso", status: state.status }, 409);
  }
  const live = await inspectUpdater();
  if (live?.running) {
    return c.json({ error: "Ya hay un updater Docker en curso", status: "running" }, 409);
  }

  void runHostUpdate();
  return c.json({
    ok: true,
    started: true,
    message:
      "Actualización iniciada en un contenedor aparte. El compile no tumba el dashboard; al final hay un corte breve. Si ves conexión rechazada, esperá 1 minuto y recargá.",
  });
});

/** Lectura de last-update sin auth fuerte — solo status corto para UI post-reload */
export function readLastUpdateNote(): { at: string; ok: boolean } | null {
  try {
    const p = join(process.cwd(), "data", "last-update.json");
    if (!existsSync(p) && HOST_DIR) {
      const alt = join(HOST_DIR, "apps/api/data", "last-update.json");
      if (existsSync(alt)) return JSON.parse(readFileSync(alt, "utf8")) as { at: string; ok: boolean };
    }
    if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8")) as { at: string; ok: boolean };
  } catch {
    /* ignore */
  }
  return null;
}
