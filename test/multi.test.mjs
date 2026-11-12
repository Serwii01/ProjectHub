// Tests de lo que hace al hub instalable y válido para varias IAs: carpeta de datos, registro en clientes,
// informe de trabajo, prompts y el servidor MCP de verdad hablando por stdio. Todo en carpetas temporales.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HUB, contextFileOf, ensureData, loadConfig, loadLocal, parseSessions, workReport } from "../lib/hub.mjs";
import { clientes, detectados, estaRegistrado, registrar, serverEntry, upsertJson, upsertToml } from "../lib/clientes.mjs";
import { skillPrompt } from "../lib/instalacion.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "hub-multi-"));
const borrar = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 3 });

// Apunta la carpeta de datos a una temporal mientras dura fn
function conDatos(fn) {
  const dir = tmp();
  const antes = process.env.PROJECTHUB_HOME;
  process.env.PROJECTHUB_HOME = dir;
  try {
    return fn(dir);
  } finally {
    if (antes === undefined) delete process.env.PROJECTHUB_HOME;
    else process.env.PROJECTHUB_HOME = antes;
    borrar(dir);
  }
}

test("ensureData crea la carpeta de datos fuera del código y no pisa lo que hay", () => {
  conDatos((dir) => {
    ensureData();
    for (const f of ["config.json", "local.json", ".gitignore"]) assert.ok(existsSync(join(dir, f)), f);
    assert.ok(Array.isArray(loadLocal().roots));
    writeFileSync(join(dir, "config.json"), JSON.stringify({ github: { user: "otra" } }));
    ensureData();
    assert.equal(loadConfig().github.user, "otra");
    assert.deepEqual(loadConfig().projects, {}); // los campos que falten salen con su valor por defecto
  });
});

test("contextFileOf prefiere AGENTS.md y acepta el de cada IA", () => {
  const dir = tmp();
  try {
    assert.equal(contextFileOf(dir), null);
    writeFileSync(join(dir, "GEMINI.md"), "x");
    assert.equal(contextFileOf(dir), "GEMINI.md");
    writeFileSync(join(dir, "CLAUDE.md"), "x");
    assert.equal(contextFileOf(dir), "CLAUDE.md");
    writeFileSync(join(dir, "AGENTS.md"), "x");
    assert.equal(contextFileOf(dir), "AGENTS.md");
  } finally {
    borrar(dir);
  }
});

const ENTRY = { command: "node", args: ["/hub/mcp-server.mjs"] };

test("upsertJson añade el servidor conservando lo demás y es idempotente", () => {
  const antes = JSON.stringify({ theme: "dark", mcpServers: { otro: { command: "x" } } });
  const uno = upsertJson(antes, "mcpServers", ENTRY);
  const obj = JSON.parse(uno);
  assert.equal(obj.theme, "dark");
  assert.deepEqual(obj.mcpServers.otro, { command: "x" });
  assert.deepEqual(obj.mcpServers["project-hub"], ENTRY);
  assert.equal(upsertJson(uno, "mcpServers", ENTRY), uno);
  assert.deepEqual(JSON.parse(upsertJson("", "servers", ENTRY)), { servers: { "project-hub": ENTRY } });
  assert.throws(() => upsertJson("{ // comentario\n}", "mcpServers", ENTRY));
});

test("upsertToml reemplaza solo la tabla del hub en el config de Codex", () => {
  const antes = 'model = "x"\n\n[mcp_servers.project-hub]\ncommand = "viejo"\n\n[mcp_servers.project-hub.env]\nA = "1"\n\n[mcp_servers.otro]\ncommand = "y"\n';
  const uno = upsertToml(antes, ENTRY);
  assert.ok(uno.includes('model = "x"') && uno.includes('[mcp_servers.otro]\ncommand = "y"'));
  assert.ok(!uno.includes("viejo") && !uno.includes("project-hub.env"));
  assert.equal(uno.match(/\[mcp_servers\.project-hub\]/g).length, 1);
  assert.ok(uno.includes('command = "node"\nargs = ["/hub/mcp-server.mjs"]'));
  assert.equal(upsertToml(uno, ENTRY), uno);
  assert.equal(upsertToml("", ENTRY), '[mcp_servers.project-hub]\ncommand = "node"\nargs = ["/hub/mcp-server.mjs"]\n');
});

test("serverEntry usa la ruta del hub, o npx si corre desde su caché", () => {
  assert.deepEqual(serverEntry({ hub: "C:\\code\\ProjectHub", node: "C:\\node\\node.exe" }), { command: "C:/node/node.exe", args: ["C:/code/ProjectHub/mcp-server.mjs"] });
  assert.deepEqual(serverEntry({ hub: "/home/u/.npm/_npx/ab12/node_modules/projecthub", platform: "linux" }), { command: "npx", args: ["-y", "projecthub", "mcp"] });
  assert.equal(serverEntry({ hub: "C:\\x\\_npx\\ab\\node_modules\\projecthub", platform: "win32" }).command, "cmd");
});

test("registrar: solo en los clientes presentes, con copia, sin pisar lo ilegible", () => {
  conDatos((datos) => {
    const home = tmp();
    try {
      const opts = { home, platform: "linux" };
      assert.deepEqual(detectados(opts), []);
      mkdirSync(join(home, ".cursor"));
      mkdirSync(join(home, ".codex"));
      mkdirSync(join(home, ".gemini"));
      writeFileSync(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { otro: { command: "x" } } }));
      writeFileSync(join(home, ".gemini", "settings.json"), "{ esto no es json");
      assert.deepEqual(detectados(opts).map((c) => c.id), ["cursor", "gemini", "codex"]);

      const res = Object.fromEntries(detectados(opts).map((c) => [c.id, registrar(c, ENTRY)]));
      assert.equal(res.cursor.estado, "registrado");
      assert.ok(existsSync(res.cursor.copia) && res.cursor.copia.startsWith(datos));
      assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8")).mcpServers), ["otro", "project-hub"]);
      assert.equal(res.codex.estado, "registrado");
      assert.match(readFileSync(join(home, ".codex", "config.toml"), "utf8"), /\[mcp_servers\.project-hub\]/);
      assert.equal(res.gemini.estado, "error");
      assert.equal(readFileSync(join(home, ".gemini", "settings.json"), "utf8"), "{ esto no es json");

      const cursor = clientes(opts).find((c) => c.id === "cursor");
      assert.ok(estaRegistrado(cursor, ENTRY));
      assert.ok(!estaRegistrado(cursor, { ...ENTRY, command: "otro-node" }));
      assert.equal(registrar(cursor, ENTRY).estado, "sin cambios");
    } finally {
      borrar(home);
    }
  });
});

test("clientes: cada sistema tiene su carpeta de configuración y VS Code su propia forma", () => {
  const de = (platform, id) => clientes({ home: "/h", platform, appData: "/h/AppData/Roaming" }).find((c) => c.id === id);
  assert.match(de("win32", "claude-desktop").file.replace(/\\/g, "/"), /AppData\/Roaming\/Claude\/claude_desktop_config\.json$/);
  assert.match(de("darwin", "claude-desktop").file.replace(/\\/g, "/"), /Library\/Application Support\/Claude\//);
  assert.match(de("linux", "vscode").file.replace(/\\/g, "/"), /\.config\/Code\/User\/mcp\.json$/);
  assert.equal(de("linux", "vscode").key, "servers");
  assert.equal(de("linux", "vscode").entry(ENTRY).type, "stdio");
});

const STATUS = `# Estado

## Estado actual
Va.

## Siguientes pasos
- [ ] Publicar la web en Vercel

## Última sesión

### 2026-11-08
- Filtro por país.
- Arreglado el mapa.

### 2026-10-01
- Algo antiguo.

### AAAA-MM-DD
-

## Decisiones
`;

test("parseSessions lee las sesiones fechadas, también con CRLF", () => {
  const esperado = [{ fecha: "2026-11-08", puntos: ["Filtro por país.", "Arreglado el mapa."] }, { fecha: "2026-10-01", puntos: ["Algo antiguo."] }];
  assert.deepEqual(parseSessions(STATUS), esperado);
  assert.deepEqual(parseSessions(STATUS.replace(/\n/g, "\r\n")), esperado);
  assert.deepEqual(parseSessions("# Sin secciones"), []);
});

test("workReport junta sesiones recientes y commits sin anotar", () => {
  const dir = tmp();
  try {
    writeFileSync(join(dir, "STATUS.md"), STATUS);
    const projects = [
      { name: "web", path: dir, unloggedCommits: [{ at: "2026-11-09T10:00:00+01:00", message: "Nuevo footer" }, { at: "2026-09-01T10:00:00+01:00", message: "Viejo" }] },
      { name: "parado", path: join(dir, "no-existe"), unloggedCommits: [] },
    ];
    const r = workReport({ dias: 7, projects, hoy: new Date("2026-11-09T12:00:00") });
    assert.equal(r.desde, "2026-11-02");
    assert.equal(r.diasConSesion, 1);
    assert.deepEqual(r.proyectos.map((p) => p.project), ["web"]);
    assert.deepEqual(r.proyectos[0].sesiones.map((s) => s.fecha), ["2026-11-08"]);
    assert.deepEqual(r.proyectos[0].commitsSinAnotar, ["2026-11-09 Nuevo footer"]);
  } finally {
    borrar(dir);
  }
});

test("skillPrompt da el procedimiento sin cabecera YAML ni marcadores", () => {
  conDatos(() => {
    for (const name of ["proyectos", "retomar", "cerrar"]) {
      const p = skillPrompt(name);
      assert.ok(p.description.length > 20, name);
      assert.ok(p.body.startsWith("# /"), name);
      assert.ok(!/\{\{(HUB|DATA)\}\}/.test(p.body), name);
    }
  });
});

test("el servidor MCP arranca y responde por stdio con herramientas y prompts", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const datos = tmp();
  const repo = join(datos, "proyectos", "mi-web");
  mkdirSync(repo, { recursive: true });
  execFileSync("git", ["init", "--quiet", repo]);
  writeFileSync(join(repo, "STATUS.md"), STATUS);
  writeFileSync(join(repo, "AGENTS.md"), "# mi-web\n\n```bash\nnpm run dev\n```\n");
  writeFileSync(join(datos, "config.json"), JSON.stringify({ github: { user: "" }, projects: { "mi-web": { prioridad: "alta" } } }));
  writeFileSync(join(datos, "local.json"), JSON.stringify({ roots: [join(datos, "proyectos")], cloneDir: join(datos, "proyectos") }));

  const client = new Client({ name: "test", version: "0" });
  // El home también apunta a la carpeta temporal: los avisos del hub no deben depender de lo instalado de verdad
  const env = { ...process.env, PROJECTHUB_HOME: datos, HOME: datos, USERPROFILE: datos };
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(HUB, "mcp-server.mjs")], env, stderr: "ignore" }));
  try {
    assert.match(client.getInstructions(), /get_project_context/);
    const tools = (await client.listTools()).tools.map((t) => t.name);
    assert.deepEqual(tools.sort(), ["clone_project", "get_project_context", "get_project_map", "list_projects", "read_project_file", "save_handoff", "search", "update_status", "work_report"]);
    assert.deepEqual((await client.listPrompts()).prompts.map((p) => p.name).sort(), ["cerrar", "proyectos", "relevo", "retomar"]);
    const prompt = await client.getPrompt({ name: "retomar", arguments: { proyecto: "mi-web" } });
    assert.match(prompt.messages[0].content.text, /«mi-web»[\s\S]*get_project_context/);

    // Lo que cuesta tener el servidor conectado: las instrucciones y las definiciones de las herramientas van en cada conversación
    const definiciones = JSON.stringify((await client.listTools()).tools).length / 4;
    assert.ok(definiciones < 1800, `las definiciones de las herramientas ocupan ~${Math.round(definiciones)} tokens`);
    assert.ok(client.getInstructions().length / 4 < 200, "las instrucciones del servidor pasan de 200 tokens");

    const llamar = async (name, args) => (await client.callTool({ name, arguments: args })).content[0].text;
    // Por defecto, una tabla de texto; con detalle, el JSON completo
    const tabla = await llamar("list_projects", { actualizar: false });
    assert.match(tabla, /^1 proyecto en este equipo/);
    assert.match(tabla, /mi-web \| alta \| .* \| 2 sin commit \| Publicar la web en Vercel/);
    const lista = JSON.parse(await llamar("list_projects", { actualizar: false, detalle: true }));
    assert.deepEqual(lista.clonados.map((p) => [p.name, p.prioridad, p.contextFile]), [["mi-web", "alta", "AGENTS.md"]]);

    // Contexto breve, en texto: sin el archivo de contexto salvo que se pida
    const ctx = await llamar("get_project_context", { project: "mi" });
    assert.match(ctx, /^ProjectHub: mi-web · rama \w+ · 2 sin commit · prioridad alta/);
    assert.match(ctx, /\nAvisos \(atiende el primero antes que nada\):\n- \[medio\] 2 archivos sin commit\./); // el repo de prueba tiene archivos sin commit
    assert.match(ctx, /\nSiguientes pasos:\n- Publicar la web en Vercel\n/);
    assert.match(ctx, /\nÚltima sesión \(2026-11-08\):\n- Filtro por país\.\n- Arreglado el mapa\./);
    assert.ok(!ctx.includes("npm run dev"));
    assert.match(await llamar("get_project_context", { project: "mi", contexto: true }), /--- AGENTS\.md ---[\s\S]*npm run dev/);
    assert.match(JSON.parse(await llamar("get_project_context", { project: "mi", detalle: "completo" })).statusMd, /## Decisiones/);
    assert.match(await llamar("get_project_context", { project: "mi", detalle: "git" }), /^mi-web · rama \w+ · 2 sin commit\nSin commit:\n\?\? (AGENTS|STATUS)\.md/);

    // Relevo: lo recibe el siguiente chat y se borra al cerrar la sesión
    assert.match(await llamar("save_handoff", { project: "mi", haciendo: "Migrando el login a sesiones", siguiente: "Mandar la cookie desde el formulario" }), /^Relevo guardado en .*relevo\.md\. [\s\S]*2 archivos sin commit/);
    const conRelevo = await llamar("get_project_context", { project: "mi" });
    assert.match(conRelevo, /\nAvisos \(atiende el primero antes que nada\):\n- \[alto\] Hay un relevo/);
    assert.match(conRelevo, /\nRelevo de un chat anterior:\n# Relevo[\s\S]*## Haciendo\nMigrando el login[\s\S]*## Siguiente\nMandar la cookie/);
    assert.match(conRelevo, /\nÚltima sesión anotada: 2026-11-08\./);
    const cierre = await llamar("update_status", { project: "mi", sesion: ["Login con sesiones terminado."], nuevos_pasos: ["Probar el login en móvil"], completados: ["nada que encaje"] });
    assert.match(cierre, /^STATUS\.md de mi-web guardado: sesión \d{4}-\d{2}-\d{2}, 1 paso añadido\. Quedan 2 pasos\.\nNo encontrados \(no se han quitado; repite con otro fragmento\): nada que encaje\nRelevo borrado\.\nGit: /);
    assert.ok(!(await llamar("get_project_context", { project: "mi" })).includes("Relevo de un chat"));

    // Prioridad y descripción se cambian con update_status, sin tocar la ficha
    assert.equal(await llamar("update_status", { project: "mi", prioridad: "baja" }), "Hub: mi-web con prioridad baja.");
    assert.match(await llamar("list_projects", { actualizar: false }), /mi-web \| baja \|/);

    assert.match(await llamar("get_project_map", { project: "mi" }), /^Mapa de mi-web/);
    assert.match(await llamar("get_project_map", { project: "mi", path: "" }), /^\d+ archivos:\n[\s\S]*STATUS\.md/);
    assert.match(await llamar("search", { query: "login sesiones" }), /^## mi-web \(1\)\n- Sesión \d{4}-\d{2}-\d{2}: Login con sesiones terminado\.$/);
    assert.match(await llamar("search", { query: "kubernetes" }), /^Nada anotado[\s\S]*en="codigo"/);
    assert.match(await llamar("search", { query: "npm run dev", en: "codigo" }), /^## mi-web \(1\)\nAGENTS\.md:\d+:npm run dev$/);
    const mal = await client.callTool({ name: "get_project_context", arguments: { project: "no-existe" } });
    assert.ok(mal.isError);
  } finally {
    await client.close();
    borrar(datos);
  }
});
