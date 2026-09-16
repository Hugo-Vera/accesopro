import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { dataDir } from "./db/client.js";

export function visitorDocDir(siteId: string) {
  return join(dataDir, "visitor-docs", siteId);
}

export function visitorDocPath(siteId: string, id: string, mime: string) {
  const ext = mime.includes("pdf") ? ".pdf" : ".jpg";
  return join(visitorDocDir(siteId), `${id}${ext}`);
}

export function saveVisitorDoc(siteId: string, id: string, mime: string, buf: Buffer) {
  const dir = visitorDocDir(siteId);
  mkdirSync(dir, { recursive: true });
  const p = visitorDocPath(siteId, id, mime);
  writeFileSync(p, buf);
  return p;
}

export function readVisitorDoc(absPath: string): Buffer | null {
  if (!absPath || !existsSync(absPath)) return null;
  return readFileSync(absPath);
}

export function mimeOfPath(absPath: string) {
  return extname(absPath).toLowerCase() === ".pdf" ? "application/pdf" : "image/jpeg";
}
