#!/usr/bin/env node
// Instala ProjectHub en este equipo:
//  1. crea hub.local.json (carpetas de este equipo) si no existe
//  2. copia las skills /proyectos, /retomar y /cerrar a ~/.claude/skills con las rutas de este equipo
//  3. registra el servidor MCP "project-hub" en ~/.claude.json
//  4. pone las reglas del hub en ~/.claude/CLAUDE.md, entre marcas, sin tocar el resto del archivo
//  5. añade los hooks SessionStart y Stop a ~/.claude/settings.json, conservando los demás
//  6. escanea los proyectos
// Antes de modificar cada archivo de ~/.claude hace una copia en ~/.claude/backups.
// Uso: npm install && npm run instalar   (se puede repetir sin problema)

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import { loadLocal, scanProjects } from "./lib/hub.mjs";
import { claudeDir, globalBlock, globalFile, hubPath as hub, mergeHooks, renderSkill, settingsFile, skillNames, upsertBlock } from "./lib/instalacion.mjs";

const toPosix = (p) => p.replace(/\\/g, "/");
const ok = (msg) => console.log(`  ✓ ${msg}`);

function backup(file) {
  if (!existsSync(file)) return;
  mkdirSync(join(claudeDir, "backups"), { recursive: true });
  const dest = join(claudeDir, "backups", `${basename(file).replace(/^\./, "")}.${new Date().toISOString().replace(/[:.]/g, "-")}`);
  copyFileSync(file, dest);
  ok(`copia de seguridad en ${toPosix(dest)}`);
}

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
for (const name of skillNames()) {
  const dest = join(claudeDir, "skills", name);
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "SKILL.md"), renderSkill(name));
  ok(`skill /${name}`);
}

// 3. Servidor MCP a nivel de usuario
const configFile = join(homedir(), ".claude.json");
backup(configFile);
const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")) : {};
config.mcpServers = {
  ...config.mcpServers,
  "project-hub": { type: "stdio", command: process.execPath, args: [`${hub}/mcp-server.mjs`], env: {} },
};
writeFileSync(configFile, JSON.stringify(config, null, 2));
ok("servidor MCP project-hub registrado en Claude Code");

// 4. Reglas globales
backup(globalFile);
writeFileSync(globalFile, upsertBlock(existsSync(globalFile) ? readFileSync(globalFile, "utf8") : "", globalBlock()));
ok("reglas del hub en ~/.claude/CLAUDE.md");

// 5. Hooks
backup(settingsFile);
const settings = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")) : {};
writeFileSync(settingsFile, JSON.stringify(mergeHooks(settings), null, 2) + "\n");
ok("hooks SessionStart y Stop en ~/.claude/settings.json");

// 6. Primer escaneo
const { projects } = scanProjects();
ok(`${projects.length} proyectos encontrados en este equipo${projects.length ? ": " + projects.map((p) => p.name).join(", ") : ""}`);

console.log(`
Listo. Reinicia Claude Code (o abre una sesión nueva) para que cargue el MCP.
  - Dashboard: doble clic en "Abrir dashboard.cmd" o  npm run dashboard
  - En Claude: /proyectos, /retomar <proyecto>, /cerrar
`);
