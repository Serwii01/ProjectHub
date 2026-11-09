// Lo que el hub instala fuera de su carpeta y la comprobación de que todo sigue al día.
// El servidor MCP se registra en cualquier cliente (lib/clientes.mjs). Las skills, las reglas
// globales y los hooks son extras propios de Claude Code. Lo usan instalar.mjs y hub_health.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { HUB, VERSION, dataDir, git, loadLocal } from "./hub.mjs";
import { detectados, estaRegistrado } from "./clientes.mjs";

const toPosix = (p) => p.replace(/\\/g, "/");
const lf = (s) => s.replace(/\r\n/g, "\n");
export const hubPath = toPosix(HUB);
export const claudeDir = join(homedir(), ".claude");
export const globalFile = join(claudeDir, "CLAUDE.md");
export const settingsFile = join(claudeDir, "settings.json");

const INICIO = "<!-- project-hub:inicio (lo genera el instalador de ProjectHub; no editar a mano) -->";
const INICIO_RE = /<!-- project-hub:inicio[^>]*-->/;
const FIN = "<!-- project-hub:fin -->";

// {{HUB}} = carpeta del código; {{DATA}} = carpeta de datos del usuario
const rutas = (s) => s.replaceAll("{{HUB}}", hubPath).replaceAll("{{DATA}}", toPosix(dataDir()));

export const skillNames = () => readdirSync(join(HUB, "skills")).filter((n) => existsSync(join(HUB, "skills", n, "SKILL.md")));
export const renderSkill = (name) => rutas(lf(readFileSync(join(HUB, "skills", name, "SKILL.md"), "utf8")));

// La misma skill como prompt MCP, para los clientes que no tienen skills: descripción y cuerpo sin la cabecera YAML
export function skillPrompt(name) {
  const text = renderSkill(name);
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  return {
    description: m?.[1].match(/^description:\s*(.*)$/m)?.[1] ?? name,
    body: (m ? text.slice(m[0].length) : text).trim(),
  };
}

export function globalBlock() {
  const body = rutas(lf(readFileSync(join(HUB, "templates", "claude-global.md"), "utf8"))).trim();
  return `${INICIO}\n${body}\n${FIN}`;
}

// Pone o reemplaza el bloque del hub sin tocar el resto del archivo
export function upsertBlock(text, block) {
  const t = lf(text);
  const a = t.search(INICIO_RE);
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

// Huella del código que carga el servidor MCP: si cambia, hay que reiniciar el cliente
export function codeHash() {
  const h = createHash("sha1");
  for (const f of ["lib/hub.mjs", "lib/instalacion.mjs", "lib/clientes.mjs", "lib/resumen.mjs", "mcp-server.mjs"]) h.update(lf(readFileSync(join(HUB, f), "utf8")));
  return h.digest("hex").slice(0, 12);
}

const aheadBehind = (dir) => git(dir, "rev-list", "--left-right", "--count", "@{upstream}...HEAD").split(/\s+/).map(Number);

export function hubHealth({ loadedHash } = {}) {
  const problemas = [];
  const add = (codigo, mensaje, accion) => problemas.push({ codigo, mensaje, accion });
  const instalar = "Pide al usuario que ejecute `projecthub instalar` (o `npm run instalar` en la carpeta del hub), o hazlo tú si lo confirma, y que reinicie su cliente de IA.";

  if (loadedHash && loadedHash !== codeHash()) {
    add("mcp_desfasado", "El servidor MCP en marcha usa una versión anterior del código.", "Pide al usuario que reinicie su cliente de IA para cargar la nueva.");
  }

  const clientes = detectados();
  const sinRegistrar = clientes.filter((c) => !estaRegistrado(c));
  if (sinRegistrar.length) add("mcp_sin_registrar", `El servidor MCP no está registrado (o apunta a otra ruta) en: ${sinRegistrar.map((c) => c.nombre).join(", ")}.`, instalar);

  // Extras de Claude Code: solo se comprueban si está instalado
  if (existsSync(claudeDir)) {
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
  }

  if (!existsSync(join(HUB, "node_modules")) && !/[\\/]node_modules[\\/]/.test(HUB)) add("dependencias", "Faltan las dependencias del hub.", "Pide al usuario que ejecute npm install en la carpeta del hub.");
  const roots = loadLocal().roots.filter((r) => !existsSync(r));
  if (roots.length) add("carpetas", `No existen estas carpetas de local.json: ${roots.join(", ")}.`, `Pide al usuario que corrija roots en ${toPosix(dataDir())}/local.json.`);

  // Si el hub es un clon de git (desarrollo), ¿está al día?
  if (existsSync(join(HUB, ".git"))) {
    const [behind = 0, ahead = 0] = aheadBehind(HUB);
    if (behind) add("hub_por_bajar", `El hub tiene ${behind} commits nuevos en GitHub.`, "Propón git pull en el hub y después volver a instalar.");
    if (ahead) add("hub_sin_subir", `El hub tiene ${ahead} commits sin subir.`, "Recuérdalo: el otro equipo no los tendrá hasta hacer push.");
  }
  // Si el usuario sincroniza su configuración con git, ¿está al día?
  if (existsSync(join(dataDir(), ".git"))) {
    const [behind = 0, ahead = 0] = aheadBehind(dataDir());
    const sucio = git(dataDir(), "status", "--porcelain");
    const sync = "Pide al usuario que ejecute `projecthub sync`. Si falla, dirá por qué.";
    if (behind) add("config_por_bajar", `La configuración del hub tiene ${behind} commits por bajar.`, sync);
    if (ahead || sucio) add("config_sin_subir", "La configuración del hub (prioridades, descripciones, estado de este equipo) tiene cambios sin subir.", sync);
  }

  const sync = existsSync(join(dataDir(), ".git")) ? "activada" : "sin activar (projecthub sync --remote <url de un repo privado>): los demás equipos no ven las prioridades ni el trabajo sin subir de este";
  return { ok: problemas.length === 0, version: VERSION, codigo: codeHash(), datos: toPosix(dataDir()), sync, clientes: clientes.map((c) => c.nombre), problemas };
}
