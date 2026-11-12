// Clientes de IA en los que se puede registrar el servidor MCP "project-hub".
// Cada uno guarda sus servidores MCP en un archivo propio; aquí está dónde y con qué forma.
// Lo usan instalar.mjs y projecthub doctor. Las funciones que transforman texto son puras.

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { HUB, dataFile } from "./hub.mjs";

export const SERVER = "project-hub";
const toPosix = (p) => p.replace(/\\/g, "/");
const lf = (s) => s.replace(/\r\n/g, "\n");

// Carpeta de configuración de las aplicaciones de escritorio en cada sistema
function appConfigDir({ home, platform, appData }) {
  if (platform === "win32") return appData || join(home, "AppData", "Roaming");
  if (platform === "darwin") return join(home, "Library", "Application Support");
  return join(home, ".config");
}

// `detect` es la carpeta cuya existencia indica que el cliente está instalado
export function clientes({ home = homedir(), platform = process.platform, appData = process.env.APPDATA } = {}) {
  const app = appConfigDir({ home, platform, appData });
  const stdio = (e) => ({ type: "stdio", ...e });
  return [
    { id: "claude-code", nombre: "Claude Code", file: join(home, ".claude.json"), detect: join(home, ".claude"), key: "mcpServers", entry: (e) => ({ ...stdio(e), env: {} }) },
    { id: "claude-desktop", nombre: "Claude Desktop", file: join(app, "Claude", "claude_desktop_config.json"), detect: join(app, "Claude"), key: "mcpServers" },
    { id: "cursor", nombre: "Cursor", file: join(home, ".cursor", "mcp.json"), detect: join(home, ".cursor"), key: "mcpServers" },
    { id: "vscode", nombre: "VS Code (Copilot)", file: join(app, "Code", "User", "mcp.json"), detect: join(app, "Code", "User"), key: "servers", entry: stdio },
    { id: "windsurf", nombre: "Windsurf", file: join(home, ".codeium", "windsurf", "mcp_config.json"), detect: join(home, ".codeium", "windsurf"), key: "mcpServers" },
    { id: "gemini", nombre: "Gemini CLI", file: join(home, ".gemini", "settings.json"), detect: join(home, ".gemini"), key: "mcpServers" },
    { id: "antigravity", nombre: "Antigravity", file: join(home, ".gemini", "antigravity", "mcp_config.json"), detect: join(home, ".gemini", "antigravity"), key: "mcpServers" },
    { id: "codex", nombre: "Codex CLI", file: join(home, ".codex", "config.toml"), detect: join(home, ".codex"), toml: true },
  ];
}

export const detectados = (opts) => clientes(opts).filter((c) => existsSync(c.detect));

// Cómo se arranca el servidor. Si el hub corre desde la caché de npx la ruta es efímera: se registra npx.
export function serverEntry({ hub = HUB, node = process.execPath, platform = process.platform, pkg = "projecthub" } = {}) {
  if (/[\\/]_npx[\\/]/.test(hub)) {
    return platform === "win32" ? { command: "cmd", args: ["/c", "npx", "-y", pkg, "mcp"] } : { command: "npx", args: ["-y", pkg, "mcp"] };
  }
  return { command: toPosix(node), args: [`${toPosix(hub)}/mcp-server.mjs`] };
}

// Añade o reemplaza el servidor en un JSON de configuración, conservando todo lo demás
export function upsertJson(text, key, entry, name = SERVER) {
  const config = text.trim() ? JSON.parse(text) : {};
  config[key] = { ...config[key], [name]: entry };
  return JSON.stringify(config, null, 2) + "\n";
}

// Lo mismo para el config.toml de Codex: reemplaza la tabla [mcp_servers.<name>] (y sus subtablas) o la añade al final
export function upsertToml(text, entry, name = SERVER) {
  const header = `[mcp_servers.${name}]`;
  const propia = (l) => l.trim() === header || l.trim().startsWith(`[mcp_servers.${name}.`);
  const out = [];
  let dentro = false;
  for (const line of lf(text).split("\n")) {
    if (/^\s*\[/.test(line)) dentro = propia(line);
    if (!dentro) out.push(line);
  }
  const resto = out.join("\n").trimEnd();
  const tabla = `${header}\ncommand = ${JSON.stringify(entry.command)}\nargs = ${JSON.stringify(entry.args)}\n`;
  return resto ? `${resto}\n\n${tabla}` : tabla;
}

const leer = (file) => (existsSync(file) ? readFileSync(file, "utf8") : "");

function render(cliente, entry) {
  const actual = leer(cliente.file);
  return cliente.toml ? upsertToml(actual, entry) : upsertJson(actual, cliente.key, cliente.entry ? cliente.entry(entry) : entry);
}

// ¿Tiene ya el cliente el servidor registrado tal como lo dejaría el instalador?
export function estaRegistrado(cliente, entry = serverEntry()) {
  try {
    return existsSync(cliente.file) && lf(leer(cliente.file)) === render(cliente, entry);
  } catch {
    return false;
  }
}

export function backup(file, dir = dataFile("backups")) {
  if (!existsSync(file)) return null;
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${basename(file).replace(/^\./, "")}.${new Date().toISOString().replace(/[:.]/g, "-")}`);
  copyFileSync(file, dest);
  return dest;
}

// Registra el servidor en un cliente. Nunca pisa un archivo que no entiende: si no se puede leer, lo dice y no lo toca.
export function registrar(cliente, entry = serverEntry()) {
  let nuevo;
  try {
    nuevo = render(cliente, entry);
  } catch (e) {
    return { ...cliente, estado: "error", detalle: `No se pudo leer ${toPosix(cliente.file)} (${e.message}). Añade el servidor a mano.` };
  }
  if (lf(leer(cliente.file)) === nuevo) return { ...cliente, estado: "sin cambios" };
  const copia = backup(cliente.file);
  mkdirSync(dirname(cliente.file), { recursive: true });
  writeFileSync(cliente.file, nuevo);
  return { ...cliente, estado: "registrado", copia };
}

// Configuración para pegar a mano en un cliente que no esté en la lista
export const snippetManual = (entry = serverEntry()) => JSON.stringify({ mcpServers: { [SERVER]: entry } }, null, 2);
