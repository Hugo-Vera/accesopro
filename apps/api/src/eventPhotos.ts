import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./db/client.js";

export function eventPhotoPath(siteId: string, eventId: string) {
  return join(dataDir, "evidence", siteId, `${eventId}.jpg`);
}

export function saveEventPhoto(siteId: string, eventId: string, buf: Buffer) {
  const dir = join(dataDir, "evidence", siteId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(eventPhotoPath(siteId, eventId), buf);
}

export function copyEventPhoto(siteId: string, fromEventId: string, toEventId: string) {
  if (!fromEventId || !toEventId || fromEventId === toEventId) return false;
  const buf = readEventPhoto(siteId, fromEventId);
  if (!buf) return false;
  saveEventPhoto(siteId, toEventId, buf);
  return true;
}

export function readEventPhoto(siteId: string, eventId: string): Buffer | null {
  const p = eventPhotoPath(siteId, eventId);
  if (!existsSync(p)) return null;
  return readFileSync(p);
}

export function clearSiteEventPhotos(siteId: string) {
  const dir = join(dataDir, "evidence", siteId);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

export function looksLikeJpeg(buf: Buffer) {
  return buf.length >= 80 && buf[0] === 0xff && buf[1] === 0xd8;
}

export function listEventPhotoIds(siteId: string): string[] {
  const dir = join(dataDir, "evidence", siteId);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".jpg"))
    .map((n) => n.replace(/\.jpg$/i, ""));
}
