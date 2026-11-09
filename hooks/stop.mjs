#!/usr/bin/env node
// Hook Stop: se dispara al final de cada turno. Si hay commits sin anotar en STATUS.md, lo
// recuerda al usuario una sola vez por sesión. No bloquea nada ni interrumpe a Claude.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dataFile, unloggedAt } from "../lib/hub.mjs";
import { leerEntrada } from "./entrada.mjs";

const ESTADO = dataFile("cache", "avisos-stop.json");

try {
  const { cwd = process.cwd(), session_id: sesion = "sin-id" } = await leerEntrada();
  const avisadas = existsSync(ESTADO) ? JSON.parse(readFileSync(ESTADO, "utf8")) : [];
  const r = avisadas.includes(sesion) ? null : unloggedAt(cwd);
  if (r?.commits.length) {
    mkdirSync(dataFile("cache"), { recursive: true });
    writeFileSync(ESTADO, JSON.stringify([...avisadas, sesion].slice(-50)));
    const n = r.commits.length;
    console.log(JSON.stringify({ systemMessage: `ProjectHub: ${r.name} tiene ${n} ${n === 1 ? "commit" : "commits"} sin anotar en STATUS.md. Cuando acabes, usa /cerrar.` }));
  }
} catch {
  // un recordatorio nunca debe molestar
}
