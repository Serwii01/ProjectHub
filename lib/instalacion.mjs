// Lo que el hub instala fuera de su carpeta (skills, bloque global, hooks) y la comprobación
// de que todo sigue al día. Lo usan instalar.mjs y la herramienta MCP hub_health.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { HUB, git, loadLocal } from "./hub.mjs";

const toPosix = (p) => p.replace(/\\/g, "/");
const lf = (s) => s.replace(/\r\n/g, "\n");
export const hubPath = toPosix(HUB);
export const claudeDir = join(homedir(), ".claude");
export const globalFile = join(claudeDir, "CLAUDE.md");
export const settingsFile = join(claudeDir, "settings.json");

const INICIO = "<!-- project-hub:inicio (lo genera npm run instalar; no editar a mano) -->";
const FIN = "<!-- project-hub:fin -->";

export const skillNames = () => readdirSync(join(HUB, "skills")).filter((n) => existsSync(join(HUB, "skills", n, "SKILL.md")));
export const renderSkill = (name) => lf(readFileSync(join(HUB, "skills", name, "SKILL.md"), "utf8")).replaceAll("{{HUB}}", hubPath);

export function globalBlock() {
  const body = lf(readFileSync(join(HUB, "templates", "claude-global.md"), "utf8")).replaceAll("{{HUB}}", hubPath).trim();
  return `${INICIO}\n${body}\n${FIN}`;
}

// Pone o reemplaza el bloque del hub sin tocar el resto del archivo
export function upsertBlock(text, block) {
  const t = lf(text);
  const a = t.indexOf(INICIO);
  const b = t.indexOf(FIN);
  if (a !== -1 && b > a) return t.slice(0, a) + block + t.slice(b + FIN.length);
  return t.trim() ? `${t.trimEnd()}\n\n${block}\n` : `${block}\n`;
}

const HOOKS = { SessionStart: "session-start.mjs", Stop: "stop.mjs" };
const hookCommand = (script) => `node "${hubPath}/hooks/${script}"`;

// Añade los hooks del hub conservando los demás y sin duplicar los suyos
export function mergeHooks(settings) {
  const out = { ...settings, hooks: { ...settings.hooks } };
  for (const [event, script] of Object.entries(HOOKS)) {
    const others = (out.hooks[event] ?? [])
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !h.command?.includes(`hooks/${script}`)) }))
      .filter((g) => g.hooks.length);
    out.hooks[event] = [...others, { hooks: [{ type: "command", command: hookCommand(script), timeout: 15 }] }];
  }
  return out;
}

// Huella del código que carga el servidor MCP: si cambia, hay que reiniciar Claude Code
export function codeHash() {
  const h = createHash("sha1");
  for (const f of ["lib/hub.mjs", "lib/instalacion.mjs", "mcp-server.mjs"]) h.update(lf(readFileSync(join(HUB, f), "utf8")));
  return h.digest("hex").slice(0, 12);
}

export function hubHealth({ loadedHash } = {}) {
  const problemas = [];
  const add = (codigo, mensaje, accion) => problemas.push({ codigo, mensaje, accion });
  const instalar = "Pide al usuario que ejecute npm run instalar en el hub (o hazlo tú si lo confirma) y que reinicie Claude Code.";

  if (loadedHash && loadedHash !== codeHash()) {
    add("mcp_desfasado", "El servidor MCP en marcha usa una versión anterior del código.", "Pide al usuario que reinicie Claude Code para cargar la nueva.");
  }
  const skills = skillNames().filter((n) => {
    const f = join(claudeDir, "skills", n, "SKILL.md");
    return !existsSync(f) || lf(readFileSync(f, "utf8")) !== renderSkill(n);
  });
  if (skills.length) add("skills_desfasadas", `Skills sin actualizar: ${skills.join(", ")}.`, instalar);

  const global = existsSync(globalFile) ? lf(readFileSync(globalFile, "utf8")) : "";
  if (!global.includes(globalBlock())) add("reglas_globales", "El bloque del hub en ~/.claude/CLAUDE.md falta o está desfasado.", instalar);

  let settings = {};
  try {
    settings = JSON.parse(readFileSync(settingsFile, "utf8"));
  } catch {
    // sin settings.json los hooks cuentan como no instalados
  }
  const faltan = Object.entries(HOOKS).filter(([e, s]) => !(settings.hooks?.[e] ?? []).some((g) => g.hooks?.some((h) => h.command === hookCommand(s))));
  if (faltan.length) add("hooks", `Hooks sin instalar: ${faltan.map(([e]) => e).join(", ")}.`, instalar);

  if (!existsSync(join(HUB, "node_modules"))) add("dependencias", "Faltan las dependencias del hub.", "Pide al usuario que ejecute npm install en el hub.");
  const roots = loadLocal().roots.filter((r) => !existsSync(r));
  if (roots.length) add("carpetas", `No existen estas carpetas de hub.local.json: ${roots.join(", ")}.`, "Pide al usuario que corrija roots en hub.local.json.");

  const [behind = 0, ahead = 0] = git(HUB, "rev-list", "--left-right", "--count", "@{upstream}...HEAD").split(/\s+/).map(Number);
  if (behind) add("hub_por_bajar", `El hub tiene ${behind} commits nuevos en GitHub.`, "Propón git pull en el hub y después npm run instalar.");
  if (ahead) add("hub_sin_subir", `El hub tiene ${ahead} commits sin subir.`, "Recuérdalo: el otro equipo no los tendrá hasta hacer push.");

  return { ok: problemas.length === 0, version: codeHash(), problemas };
}
