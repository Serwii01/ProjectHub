#!/usr/bin/env node
// Instala ProjectHub en este equipo:
//  1. crea hub.local.json (carpetas de este equipo) si no existe
//  2. copia las skills /proyectos, /retomar y /cerrar a ~/.claude/skills con las rutas de este equipo
//  3. registra el servidor MCP "project-hub" en ~/.claude.json (con copia de seguridad)
//  4. escanea los proyectos
// Uso: npm install && npm run instalar   (se puede repetir sin problema)

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { HUB, loadLocal, scanProjects } from "./lib/hub.mjs";

const toPosix = (p) => p.replace(/\\/g, "/");
const hub = toPosix(HUB);
const claudeDir = join(homedir(), ".claude");
const ok = (msg) => console.log(`  ✓ ${msg}`);

console.log(`\nInstalando ProjectHub desde ${hub}\n`);

if (Number(process.versions.node.split(".")[0]) < 20) {
  console.error(`Hace falta Node 20 o superior (tienes ${process.version}).`);
  process.exit(1);
}

// 1. Configuración de este equipo
const local = loadLocal();
ok(`hub.local.json — carpetas a escanear:\n      ${local.roots.join("\n      ")}\n    clonar en: ${local.cloneDir}`);
const missing = local.roots.filter((r) => !existsSync(r));
if (missing.length) console.log(`  ! No existen: ${missing.join(", ")} — edita hub.local.json si tus proyectos están en otro sitio.`);

// 2. Skills
for (const name of readdirSync(join(HUB, "skills"))) {
  const src = join(HUB, "skills", name, "SKILL.md");
  if (!existsSync(src)) continue;
  const dest = join(claudeDir, "skills", name);
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "SKILL.md"), readFileSync(src, "utf8").replaceAll("{{HUB}}", hub));
  ok(`skill /${name}`);
}

// 3. Servidor MCP a nivel de usuario
const configFile = join(homedir(), ".claude.json");
let config = {};
if (existsSync(configFile)) {
  mkdirSync(join(claudeDir, "backups"), { recursive: true });
  const backup = join(claudeDir, "backups", `claude.json.${new Date().toISOString().replace(/[:.]/g, "-")}`);
  copyFileSync(configFile, backup);
  config = JSON.parse(readFileSync(configFile, "utf8"));
  ok(`copia de seguridad de ~/.claude.json en ${toPosix(backup)}`);
}
config.mcpServers = {
  ...config.mcpServers,
  "project-hub": { type: "stdio", command: process.execPath, args: [`${hub}/mcp-server.mjs`], env: {} },
};
writeFileSync(configFile, JSON.stringify(config, null, 2));
ok("servidor MCP project-hub registrado en Claude Code");

// 4. Primer escaneo
const { projects } = scanProjects();
ok(`${projects.length} proyectos encontrados en este equipo${projects.length ? ": " + projects.map((p) => p.name).join(", ") : ""}`);

console.log(`
Listo. Reinicia Claude Code (o abre una sesión nueva) para que cargue el MCP.
  - Dashboard: doble clic en "Abrir dashboard.cmd" o  npm run dashboard
  - En Claude: /proyectos, /retomar <proyecto>, /cerrar
`);
