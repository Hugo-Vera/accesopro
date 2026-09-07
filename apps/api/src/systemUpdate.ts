import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { requireAuth, type AuthUser } from "./auth.js";
import { denyUnlessCapability } from "./grants.js";

type Env = { Variables: { user: AuthUser } };

const execFileAsync = promisify(execFile);

const REPO = process.env.ACCESOPRO_REPO ?? "Hugo-Vera/accesopro";
const BRANCH = process.env.ACCESOPRO_BRANCH ?? "master";
const HOST_DIR = process.env.ACCESOPRO_HOST_DIR ?? "";
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

async function runHostUpdate() {
  state = {
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    log: "",
    error: null,
  };
  appendLog("Iniciando actualización…");

  if (!HOST_DIR || !existsSync(HOST_DIR)) {
    state.status = "error";
    state.error = "ACCESOPRO_HOST_DIR no montado (esperado /opt/accesopro en el host)";
    state.finishedAt = Date.now();
    appendLog(state.error);
    return;
  }

  const script = join(HOST_DIR, "scripts", "update-ubuntu.sh");
  const cmd = existsSync(script) ? script : null;

  try {
    await ensureSafeGitDir();
    appendLog(`safe.directory → ${HOST_DIR}`);
    if (cmd) {
      appendLog(`Ejecutando ${cmd}`);
      const { stdout, stderr } = await execFileAsync("bash", [cmd], {
        cwd: HOST_DIR,
        timeout: 20 * 60 * 1000,
        env: {
          ...process.env,
          ACCESOPRO_DIR: HOST_DIR,
          ACCESOPRO_PROFILE: process.env.ACCESOPRO_PROFILE ?? "dahua",
          ACCESOPRO_OWNER: process.env.ACCESOPRO_OWNER ?? "",
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        },
        maxBuffer: 4 * 1024 * 1024,
      });
      if (stdout) appendLog(stdout);
      if (stderr) appendLog(stderr);
    } else {
      appendLog("Sin update-ubuntu.sh — git pull + compose");
      const { stdout: pullOut } = await execFileAsync(
        "git",
        ["-C", HOST_DIR, "pull", "--ff-only", "origin", BRANCH],
        { timeout: 120000 },
      );
      appendLog(pullOut || "git pull ok");
      const composeFiles = ["-f", "docker-compose.yml"];
      if (existsSync(join(HOST_DIR, "deploy/docker-compose.linux.yml"))) {
        composeFiles.push("-f", "deploy/docker-compose.linux.yml");
      }
      const { stdout: upOut, stderr: upErr } = await execFileAsync(
        "docker",
        ["compose", ...composeFiles, "--profile", "dahua", "up", "-d", "--build"],
        { cwd: HOST_DIR, timeout: 20 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 },
      );
      if (upOut) appendLog(upOut);
      if (upErr) appendLog(upErr);
    }
    state.status = "ok";
    state.finishedAt = Date.now();
    appendLog("Actualización terminada. Recargá el dashboard en unos segundos.");
    try {
      mkdirSync(join(HOST_DIR, "apps/api/data"), { recursive: true });
      writeFileSync(
        join(HOST_DIR, "apps/api/data", "last-update.json"),
        JSON.stringify({ at: new Date().toISOString(), ok: true }, null, 2),
      );
    } catch {
      /* ignore */
    }
  } catch (err) {
    state.status = "error";
    state.finishedAt = Date.now();
    state.error = err instanceof Error ? err.message : String(err);
    appendLog(`ERROR: ${state.error}`);
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
    repo: REPO,
    branch: BRANCH,
    localSha: local,
    remoteSha: remote?.sha ?? null,
    remoteMessage: remote?.message ?? null,
    remoteUrl: remote?.htmlUrl ?? `https://github.com/${REPO}`,
    updateAvailable,
    selfUpdateEnabled: ALLOW && Boolean(HOST_DIR),
    hostDir: HOST_DIR || null,
    update: {
      status: state.status,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      error: state.error,
    },
  });
});

systemApi.get("/system/update-status", async (c) => {
  const user = c.get("user");
  if (!canUpdate(user)) {
    const denied = await denyUnlessCapability(user, "core.config");
    if (denied) return denied;
  }
  return c.json({ ...state, logTail: state.log.slice(-4000) });
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

  void runHostUpdate();
  return c.json({
    ok: true,
    started: true,
    message: "Actualización iniciada. El dashboard puede reiniciarse solo; recargá en 1–2 minutos.",
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
