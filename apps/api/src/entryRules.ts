import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  DEFAULT_ENTRY_RULES,
  VISIT_KIND_CATALOG,
  ARRIVAL_MODE_CATALOG,
  normalizeEntryRule,
  resolveEntryRule,
  type EntryRule,
} from "@accesopro/catalog";
import { db } from "./db/client.js";
import { tenantEntryRules } from "./db/schema.js";
import type { AuthUser } from "./auth.js";
import { denyUnlessCapability } from "./grants.js";
import { scopedSiteWithModule } from "./scope.js";

type Env = { Variables: { user: AuthUser } };

export const entryRulesApi = new Hono<Env>();

function parseItems(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Las 6 reglas del barrio: lo guardado encima de los valores por defecto. */
export async function getEntryRules(tenantId: string): Promise<EntryRule[]> {
  const rows = await db.select().from(tenantEntryRules).where(eq(tenantEntryRules.tenantId, tenantId));
  return DEFAULT_ENTRY_RULES.map((def) => {
    const row = rows.find((r) => r.visitKind === def.visitKind && r.arrivalMode === def.arrivalMode);
    if (!row) return def;
    return normalizeEntryRule({
      visitKind: row.visitKind,
      arrivalMode: row.arrivalMode,
      items: parseItems(row.items),
      openBarrier: Boolean(row.openBarrier),
    });
  });
}

export async function entryRuleFor(tenantId: string, kind: unknown, mode: unknown): Promise<EntryRule> {
  return resolveEntryRule(await getEntryRules(tenantId), kind, mode);
}

export async function saveEntryRule(tenantId: string, input: EntryRule): Promise<EntryRule> {
  const rule = normalizeEntryRule(input);
  const now = new Date();
  await db
    .insert(tenantEntryRules)
    .values({
      tenantId,
      visitKind: rule.visitKind,
      arrivalMode: rule.arrivalMode,
      items: JSON.stringify(rule.items),
      openBarrier: rule.openBarrier,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [tenantEntryRules.tenantId, tenantEntryRules.visitKind, tenantEntryRules.arrivalMode],
      set: { items: JSON.stringify(rule.items), openBarrier: rule.openBarrier, updatedAt: now },
    });
  return rule;
}

export async function resetEntryRule(tenantId: string, kind: string, mode: string) {
  await db
    .delete(tenantEntryRules)
    .where(
      and(
        eq(tenantEntryRules.tenantId, tenantId),
        eq(tenantEntryRules.visitKind, kind),
        eq(tenantEntryRules.arrivalMode, mode),
      ),
    );
}

function sameTenant(user: AuthUser, tenantId: string) {
  return user.role === "platform_admin" || user.tenantId === tenantId;
}

const isKind = (v: string) => VISIT_KIND_CATALOG.some((k) => k.key === v);
const isMode = (v: string) => ARRIVAL_MODE_CATALOG.some((m) => m.key === v);

entryRulesApi.get("/tenants/:id/entry-rules", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "core.config");
  if (denied) return denied;
  const tenantId = c.req.param("id");
  if (!sameTenant(c.get("user"), tenantId)) return c.json({ error: "Sin acceso a este barrio" }, 403);
  return c.json({ tenantId, rules: await getEntryRules(tenantId), defaults: DEFAULT_ENTRY_RULES });
});

entryRulesApi.put("/tenants/:id/entry-rules/:kind/:mode", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "core.config");
  if (denied) return denied;
  const tenantId = c.req.param("id");
  if (!sameTenant(c.get("user"), tenantId)) return c.json({ error: "Sin acceso a este barrio" }, 403);
  const kind = c.req.param("kind");
  const mode = c.req.param("mode");
  if (!isKind(kind) || !isMode(mode)) return c.json({ error: "Regla desconocida" }, 400);
  const body = await c.req.json<{ items?: Record<string, unknown>; openBarrier?: boolean; reset?: boolean }>();
  if (body.reset) {
    await resetEntryRule(tenantId, kind, mode);
    return c.json({ ok: true, rule: await entryRuleFor(tenantId, kind, mode) });
  }
  const rule = await saveEntryRule(
    tenantId,
    normalizeEntryRule({ visitKind: kind, arrivalMode: mode, items: body.items ?? {}, openBarrier: body.openBarrier }),
  );
  return c.json({ ok: true, rule });
});

/** Portería (web y app) arma la ficha con estas reglas. */
entryRulesApi.get("/visitors/entry-rules", async (c) => {
  const denied = await denyUnlessCapability(c.get("user"), "access.visitors.manage");
  if (denied) return denied;
  const scoped = await scopedSiteWithModule(c, "visitors");
  if ("error" in scoped) return scoped.error;
  return c.json({ rules: await getEntryRules(scoped.tenantId) });
});
