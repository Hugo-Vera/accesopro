#!/usr/bin/env node
/**
 * Levanta AccesoPro en local (API + web) en una sola consola.
 *
 *   npm run local
 *   npm run local:dahua
 *   npm run local:stop
 *   npm run local -- --open
 *   npm run local -- --plain          # :3000 sin /accesopro
 *
 * En PCs con Laragon, el dashboard usa :3080 + /accesopro (el :3000 suele ser GenieACS).
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, copyFileSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const args = parseArgs(process.argv.slice(2));
const laragonRoot = process.env.LARAGON_ROOT || "C:\\laragon";
const hasLaragon = existsSync(laragonRoot);

const plain = Boolean(args.plain);
const webPort = Number(args.port || process.env.ACCESOPRO_WEB_PORT || (plain ? 3000 : hasLaragon ? 3080 : 3000));
const basePath = args["base-path"] ?? process.env.NEXT_PUBLIC_BASE_PATH ?? (plain || webPort === 3000 ? "" : hasLaragon ? "/accesopro" : "");
const wantDahua = Boolean(args.dahua);
const wantOpen = Boolean(args.open);
const wantStop = Boolean(args.stop);

const children = [];
let shuttingDown = false;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function log(msg, color = "reset") {
  const codes = { reset: "\x1b[0m", cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", red: "\x1b[31m", dim: "\x1b[90m" };
  process.stdout.write(`${codes[color] || ""}${msg}${codes.reset}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function patchWebOrigin(filePath, origins) {
  if (!existsSync(filePath)) return;
  let text = readFileSync(filePath, "utf8");
  if (text.includes("localhost:8084") || text.includes(`localhost:${webPort}`)) return;
  if (/^WEB_ORIGIN=/m.test(text)) {
    text = text.replace(/^WEB_ORIGIN=.*$/m, `WEB_ORIGIN=${origins}`);
  } else {
    text = `${text.trimEnd()}\nWEB_ORIGIN=${origins}\n`;
  }
  writeFileSync(filePath, text, "utf8");
}

function isListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" }, () => {
      socket.end();
      resolve(true);
    });
    socket.setTimeout(400, () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

function pidsOnPort(port) {
  if (!isWin) {
    try {
      const out = execFileSync("sh", ["-c", `lsof -ti tcp:${port} -sTCP:LISTEN || true`], { encoding: "utf8" });
      return out.split(/\s+/).map((x) => Number(x)).filter((n) => n > 0);
    } catch {
      return [];
    }
  }
  try {
    const out = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" });
    const pids = new Set();
    const needle = `:${port}`;
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes("LISTENING") || !line.includes(needle)) continue;
      const cols = line.trim().split(/\s+/);
      const local = cols[1] || "";
      if (!local.endsWith(needle) && !local.includes(`[::]${needle}`)) continue;
      const pid = Number(cols[cols.length - 1]);
      if (pid > 0) pids.add(pid);
    }
    return [...pids];
  } catch {
    return [];
  }
}

function killPid(pid) {
  try {
    if (isWin) {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGTERM");
    }
    return true;
  } catch {
    return false;
  }
}

function stopPorts(ports) {
  let stopped = 0;
  for (const port of ports) {
    const pids = pidsOnPort(port);
    if (!pids.length) {
      log(`    :${port} libre`, "dim");
      continue;
    }
    for (const pid of pids) {
      if (killPid(pid)) {
        log(`    detenido PID ${pid} en :${port}`, "yellow");
        stopped++;
      }
    }
  }
  return stopped;
}

function ensureEnv() {
  const envPath = path.join(root, ".env");
  if (!existsSync(envPath)) {
    copyFileSync(path.join(root, ".env.example"), envPath);
    log("    creado .env desde .env.example", "green");
  }
  const origins = [
    `http://localhost:${webPort}`,
    `http://127.0.0.1:${webPort}`,
    "http://localhost:8084",
    "http://127.0.0.1:8084",
    "http://accesopro.test:8084",
  ].join(",");
  if (hasLaragon && !plain) patchWebOrigin(envPath, origins);
  loadDotEnv(envPath);
  return origins;
}

function setupLaragon() {
  if (!hasLaragon || plain) return;
  const sitesDir = path.join(laragonRoot, "etc", "nginx", "sites-enabled");
  const aliasDir = path.join(laragonRoot, "etc", "nginx", "alias");
  const vhostSrc = path.join(root, "deploy", "laragon", "accesopro.test.conf");
  const aliasSrc = path.join(root, "deploy", "laragon", "alias-accesopro.conf");
  if (!existsSync(vhostSrc) || !existsSync(sitesDir)) return;

  copyFileSync(vhostSrc, path.join(sitesDir, "accesopro.test.conf"));
  const autoVhost = path.join(sitesDir, "auto.accesopro.test.conf");
  if (existsSync(autoVhost)) unlinkSync(autoVhost);
  if (existsSync(aliasDir) && existsSync(aliasSrc)) {
    copyFileSync(aliasSrc, path.join(aliasDir, "accesopro.conf"));
  }

  const nginxBinRoot = path.join(laragonRoot, "bin", "nginx");
  if (!existsSync(nginxBinRoot)) {
    log("    Nginx Laragon: recarga a mano si el alias no responde", "yellow");
    return;
  }
  const nginxDir = readdirSync(nginxBinRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(nginxBinRoot, d.name))
    .find((dir) => existsSync(path.join(dir, "nginx.exe")));
  if (!nginxDir) return;
  try {
    execFileSync(path.join(nginxDir, "nginx.exe"), ["-s", "reload"], { cwd: nginxDir, stdio: "ignore" });
    log("    Nginx Laragon recargado", "green");
  } catch {
    log("    Nginx no recargo. En Laragon: Stop + Start a Nginx", "yellow");
  }
}

function pipePrefixed(stream, name, color) {
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk.toString();
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim()) log(`[${name}] ${line}`, color);
    }
  });
}

function run(name, command, extraEnv, color, cwd = root) {
  const child = spawn(command, {
    cwd,
    env: { ...process.env, ...extraEnv },
    shell: true,
    windowsHide: true,
  });
  child.stdout && pipePrefixed(child.stdout, name, color);
  child.stderr && pipePrefixed(child.stderr, name, "yellow");
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (code && code !== 0) log(`[${name}] salio con codigo ${code}`, "red");
    if (signal) log(`[${name}] senal ${signal}`, "dim");
  });
  children.push({ name, child });
  return child;
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log("\nDeteniendo AccesoPro local...", "yellow");
  for (const { child } of children) {
    if (!child.pid) continue;
    if (isWin) {
      try {
        execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } catch {
        child.kill();
      }
    } else {
      child.kill("SIGTERM");
    }
  }
}

async function waitHttp(url, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return true;
    } catch {
      /* todavia no */
    }
    await sleep(500);
  }
  return false;
}

function openBrowser(url) {
  if (isWin) spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" });
  else spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" });
}

function ensureAgentVenv() {
  const agentDir = path.join(root, "apps", "agent");
  const uvicorn = path.join(agentDir, ".venv", isWin ? "Scripts" : "bin", isWin ? "uvicorn.exe" : "uvicorn");
  if (existsSync(uvicorn)) return uvicorn;
  log("Preparando venv del agent Dahua...", "cyan");
  const python = isWin ? "python" : "python3";
  execFileSync(python, ["-m", "venv", ".venv"], { cwd: agentDir, stdio: "inherit" });
  const pip = path.join(agentDir, ".venv", isWin ? "Scripts\\pip.exe" : "bin/pip");
  execFileSync(pip, ["install", "-r", "requirements.txt"], { cwd: agentDir, stdio: "inherit" });
  return uvicorn;
}

async function main() {
  process.chdir(root);

  if (wantStop) {
    log("==> Parando AccesoPro local", "cyan");
    const ports = [8787, webPort, 8790];
    stopPorts(ports);
    log("Listo.", "green");
    return;
  }

  if (!existsSync(path.join(root, "node_modules"))) {
    log("==> npm install", "cyan");
    execFileSync(isWin ? "npm.cmd" : "npm", ["install"], { cwd: root, stdio: "inherit", shell: isWin });
  }

  log("==> AccesoPro local", "cyan");
  const origins = ensureEnv();
  setupLaragon();

  const webUrl = `http://localhost:${webPort}${basePath || ""}`;
  const envCommon = {
    HOST: "0.0.0.0",
    WEB_ORIGIN: process.env.WEB_ORIGIN || origins,
    SITE_AGENT_URL: process.env.SITE_AGENT_URL || "http://127.0.0.1:8790",
    ACCESOPRO_API_URL: process.env.ACCESOPRO_API_URL || "http://127.0.0.1:8787",
    NEXT_PUBLIC_API_URL: "",
    API_INTERNAL_URL: "http://127.0.0.1:8787",
    NEXT_PUBLIC_BASE_PATH: basePath,
  };

  if (await isListening(8787)) {
    log("    API :8787 ya estaba arriba", "yellow");
  } else {
    run("api", "npm run dev:api", envCommon, "cyan");
  }

  if (await isListening(webPort)) {
    log(`    Web :${webPort} ya estaba arriba`, "yellow");
  } else {
    const webCmd =
      webPort === 3000 && !basePath
        ? "npm run dev:web"
        : `npx --workspace @accesopro/web next dev --hostname 0.0.0.0 --port ${webPort}`;
    run("web", webCmd, envCommon, "green");
  }

  if (wantDahua) {
    if (await isListening(8790)) {
      log("    Agent :8790 ya estaba arriba", "yellow");
    } else {
      const uvicorn = ensureAgentVenv();
      const token = process.env.SITE_AGENT_TOKEN || "accesopro-demo-agent";
      const quoted = isWin ? `"${uvicorn}"` : uvicorn;
      run(
        "agent",
        `${quoted} app.main:app --host 0.0.0.0 --port 8790`,
        { ...envCommon, SITE_AGENT_TOKEN: token },
        "yellow",
        path.join(root, "apps", "agent"),
      );
    }
  }

  process.on("SIGINT", () => {
    shutdown();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    shutdown();
    process.exit(0);
  });

  log("", "reset");
  log("========================================", "green");
  log(`  Dashboard  ${webUrl}`, "green");
  if (hasLaragon && !plain) log("  Laragon    http://localhost:8084/accesopro", "green");
  log("  API        http://localhost:8787/health", "green");
  if (wantDahua) log("  Agent      http://localhost:8790/health", "green");
  log("========================================", "green");
  log("Demo: admin@lasacacias.local / AccesoPro!2026", "dim");
  log("Parar: Ctrl+C  o  npm run local:stop", "dim");
  log("Next tarda ~15s en compilar la primera vez.", "yellow");

  if (wantOpen) {
    const ok = await waitHttp("http://127.0.0.1:8787/health");
    if (ok) openBrowser(webUrl);
    else log("API no respondio a tiempo; abri la URL a mano.", "yellow");
  }
}

main().catch((err) => {
  log(err?.stack || String(err), "red");
  process.exit(1);
});
