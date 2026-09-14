import type { actuators } from "./db/schema.js";

type ActuatorRow = typeof actuators.$inferSelect;

export function sentidoOf(raw?: string): "in" | "out" {
  return raw === "out" ? "out" : "in";
}

export function matchesSentido(a: ActuatorRow, sentido: "in" | "out") {
  if (a.engineSentido === "in" || a.engineSentido === "out") return a.engineSentido === sentido;
  return true;
}
