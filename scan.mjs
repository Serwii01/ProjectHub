#!/usr/bin/env node
// Escanea las carpetas de hub.config.json, detecta repos git y genera
// projects.json (para Claude) y PROJECTS.md (para leer de un vistazo).
// Uso: node scan.mjs [--json]   (--json imprime el registro por stdout)

import { scanProjects, renderMarkdown } from "./lib/hub.mjs";

const registry = scanProjects();
if (process.argv.includes("--json")) console.log(JSON.stringify(registry, null, 2));
else console.log(renderMarkdown(registry.projects));
