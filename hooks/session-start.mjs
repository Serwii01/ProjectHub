#!/usr/bin/env node
// Hook SessionStart: si la sesión se abre en un proyecto del hub, da a Claude su estado, con el mismo texto
// que get_project_context. Así /retomar no tiene que volver a pedirlo (lo dicen las reglas y la skill).
// Nunca debe romper una sesión: ante cualquier problema termina sin decir nada.

import { fetchProjects, projectAt } from "../lib/hub.mjs";
import { avisosHub } from "../lib/instalacion.mjs";
import { briefContext, briefText } from "../lib/resumen.mjs";
import { leerEntrada } from "./entrada.mjs";

try {
  const { cwd = process.cwd() } = await leerEntrada();
  let p = projectAt(cwd);
  if (p) {
    // Fetch corto: sin conexión, el resumen sale igual con lo que se sabe en local
    await fetchProjects([p], { timeout: 6000 });
    p = projectAt(cwd);
    const texto = briefText(briefContext(p), { avisosHub: avisosHub() });
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: texto } }));
  }
} catch {
  // sin contexto extra
}
