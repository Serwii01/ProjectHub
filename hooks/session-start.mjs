#!/usr/bin/env node
// Hook SessionStart: si la sesión se abre en un proyecto del hub, da a Claude su estado.
// Nunca debe romper una sesión: ante cualquier problema termina sin decir nada.

import { fetchProjects, projectAt } from "../lib/hub.mjs";
import { leerEntrada } from "./entrada.mjs";

try {
  const { cwd = process.cwd() } = await leerEntrada();
  let p = projectAt(cwd);
  if (p) {
    // Fetch corto: sin conexión, el resumen sale igual con lo que se sabe en local
    await fetchProjects([p], { timeout: 6000 });
    p = projectAt(cwd);
    const avisos = p.avisos.map((a) => `- [${a.nivel}] ${a.mensaje} → ${a.accion}`);
    const texto = [
      `ProjectHub: esta sesión está en el proyecto ${p.name} (rama ${p.branch}).`,
      `Último trabajo: ${p.lastCommit.date} · ${p.lastCommit.message}.`,
      p.estadoActual ? `Estado: ${p.estadoActual}` : "",
      `Siguiente acción: ${p.siguienteAccion}`,
      avisos.length ? `Avisos:\n${avisos.join("\n")}` : "",
      "Al terminar un bloque de trabajo, ofrece /cerrar.",
    ].filter(Boolean).join("\n");
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: texto } }));
  }
} catch {
  // sin contexto extra
}
