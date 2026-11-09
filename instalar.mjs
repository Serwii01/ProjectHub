#!/usr/bin/env node
// Instala ProjectHub en este equipo:
//  1. crea la carpeta de datos (~/.projecthub) con config.json y local.json si no existen
//  2. registra el servidor MCP "project-hub" en los clientes de IA que encuentre
//     (Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, Gemini CLI, Antigravity, Codex)
//  3. si está Claude Code, instala además sus extras: skills, reglas globales y hooks
//  4. escanea los proyectos
// Antes de modificar un archivo de otro programa hace una copia en ~/.projecthub/backups.
// Se puede repetir sin problema.
//
// Opciones:
//   --clientes a,b   registrar solo en esos (ids de `projecthub clientes`); "todos" = aunque no se detecten; "ninguno"
//   --roots a,b      carpetas donde buscar proyectos (se guardan en local.json)
//   --github user    cuenta de GitHub de la que listar repos no clonados
//   --equipo nombre  cómo se llama este equipo en los avisos a tus otros equipos (por defecto, el nombre del sistema)
//   --idioma es|en   idioma de las fichas STATUS.md que se creen a partir de ahora (por defecto es)
//   --sin-extras     no instalar skills, reglas globales ni hooks de Claude Code

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, ensureData, equipoActual, loadConfig, loadLocal, saveConfig, saveLocal, scanProjects, VERSION } from "./lib/hub.mjs";
import { backup, clientes, detectados, registrar, serverEntry, snippetManual } from "./lib/clientes.mjs";
import { claudeDir, globalBlock, globalFile, hubPath as hub, mergeHooks, renderSkill, settingsFile, skillNames, upsertBlock } from "./lib/instalacion.mjs";

const toPosix = (p) => p.replace(/\\/g, "/");
const ok = (msg) => console.log(`  ✓ ${msg}`);
const aviso = (msg) => console.log(`  ! ${msg}`);
const arg = (name) => {
  const i = process.argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return undefined;
  return process.argv[i].includes("=") ? process.argv[i].split("=").slice(1).join("=") : process.argv[i + 1];
};
const lista = (v) => v.split(/[,;]/).map((x) => x.trim()).filter(Boolean);

console.log(`\nInstalando ProjectHub ${VERSION} desde ${hub}\n`);

if (Number(process.versions.node.split(".")[0]) < 20) {
  console.error(`Hace falta Node 20 o superior (tienes ${process.version}).`);
  process.exit(1);
}

// 1. Datos de este equipo
const datos = toPosix(ensureData());
if (arg("roots")) saveLocal({ ...loadLocal(), roots: lista(arg("roots")).map(toPosix) });
if (arg("idioma")) {
  if (!["es", "en"].includes(arg("idioma"))) aviso(`Idioma no reconocido: ${arg("idioma")}. Vale es o en.`);
  else saveConfig({ ...loadConfig(), idioma: arg("idioma") });
}
if (arg("equipo")) saveLocal({ ...loadLocal(), equipo: arg("equipo") });
if (arg("github")) saveConfig({ ...loadConfig(), github: { ...loadConfig().github, user: arg("github") } });
const local = loadLocal();
ok(`equipo: ${equipoActual()} (cámbialo con --equipo)`);
ok(`datos en ${datos}\n    carpetas donde se buscan proyectos:\n      ${local.roots.join("\n      ")}\n    clonar en: ${local.cloneDir}`);
const missing = local.roots.filter((r) => !existsSync(r));
if (missing.length) aviso(`No existen: ${missing.join(", ")}. Cámbialas con --roots o en ${datos}/local.json.`);

// 2. Servidor MCP en cada cliente de IA
const pedido = arg("clientes");
const elegidos =
  pedido === "ninguno" ? [] : pedido === "todos" ? clientes() : pedido ? clientes().filter((c) => lista(pedido).includes(c.id)) : detectados();
const entry = serverEntry();
for (const r of elegidos.map((c) => registrar(c, entry))) {
  if (r.estado === "error") aviso(`${r.nombre}: ${r.detalle}`);
  else ok(`servidor MCP en ${r.nombre} (${r.estado})${r.copia ? `; copia en ${toPosix(r.copia)}` : ""}`);
}
if (!elegidos.length && pedido !== "ninguno") {
  aviso(`No se ha encontrado ningún cliente de IA conocido. Añade esto a la configuración MCP del tuyo:\n${snippetManual(entry)}`);
}

// 3. Extras de Claude Code
const conClaude = elegidos.some((c) => c.id === "claude-code") && !process.argv.includes("--sin-extras");
if (conClaude) {
  for (const name of skillNames()) {
    const dest = join(claudeDir, "skills", name);
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "SKILL.md"), renderSkill(name));
  }
  ok(`skills de Claude Code: ${skillNames().map((n) => `/${n}`).join(", ")}`);

  backup(globalFile);
  writeFileSync(globalFile, upsertBlock(existsSync(globalFile) ? readFileSync(globalFile, "utf8") : "", globalBlock()));
  ok("reglas del hub en ~/.claude/CLAUDE.md");

  backup(settingsFile);
  const settings = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, "utf8")) : {};
  writeFileSync(settingsFile, JSON.stringify(mergeHooks(settings), null, 2) + "\n");
  ok("hooks SessionStart y Stop en ~/.claude/settings.json");
}

// 4. Primer escaneo
const { projects } = scanProjects();
ok(`${projects.length} proyectos encontrados${projects.length ? ": " + projects.map((p) => p.name).join(", ") : ""}`);

// Sin cuenta de GitHub configurada, se propone la más repetida en los remotos
if (!loadConfig().github?.user) {
  const cuenta = {};
  for (const p of projects) {
    const owner = p.remote?.match(/github\.com[/:]([^/]+)\//i)?.[1];
    if (owner) cuenta[owner] = (cuenta[owner] ?? 0) + 1;
  }
  const [user] = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0] ?? [];
  if (user) {
    saveConfig({ ...loadConfig(), github: { ...loadConfig().github, user } });
    ok(`cuenta de GitHub: ${user} (deducida de tus repos; cámbiala con --github)`);
  } else aviso("Sin cuenta de GitHub: no se listarán los repos no clonados. Indícala con --github <usuario>.");
}

console.log(`
Listo. Reinicia tu cliente de IA (o abre una sesión nueva) para que cargue el servidor MCP.
  - Dashboard:  projecthub dashboard     (o npm run dashboard en esta carpeta)
  - En la IA:   «¿qué proyectos tengo?», «retomemos <proyecto>», «cerramos la sesión»
  - En Claude Code también: /proyectos, /retomar <proyecto>, /cerrar, /relevo
  - Varios equipos: projecthub sync --remote <url de un repo privado>
  - Configuración: ${dataDir().replace(/\\/g, "/")}
`);
