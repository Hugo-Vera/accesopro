import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, "../../data");
mkdirSync(dataDir, { recursive: true });

const url = process.env.DATABASE_URL ?? `file:${resolve(dataDir, "accesopro.db")}`;

export const client = createClient({ url });
export const db = drizzle(client, { schema });
