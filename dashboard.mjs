#!/usr/bin/env node
// Dashboard web local del ProjectHub: http://localhost:4310
// Uso: node dashboard.mjs [--open]   (--open abre el navegador)

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  HUB, scanProjects, findProject, getContext, toggleStep, addStep, loadConfig, saveConfig,
  remoteOnlyProjects, cloneProject, hideRepo, fetchProjects, syncPlan, runSyncPlan,
} from "./lib/hub.mjs";
import { syncData } from "./lib/resumen.mjs";

const PORT = Number(process.env.PORT || 4310);
const HOST = "127.0.0.1";

// Escanear cuesta varios segundos (muchas llamadas a git): las peticiones seguidas comparten resultado
let escaneo = null;
const proyectos = () => {
  if (!escaneo || Date.now() - escaneo.at > 5000) escaneo = { at: Date.now(), datos: scanProjects() };
  return escaneo.datos;
};

const json = (res, status, data) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
};

const readBody = (req) =>
  new Promise((ok, ko) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        ok(data ? JSON.parse(data) : {});
      } catch (e) {
        ko(e);
      }
    });
  });

// Lanza programas sin esperar a que terminen
const launch = (cmd, args, opts = {}) => spawn(cmd, args, { detached: true, stdio: "ignore", ...opts }).unref();

const WIN = process.platform === "win32";
const MAC = process.platform === "darwin";

// Abre una URL o una carpeta con el programa por defecto del sistema
function openDefault(target) {
  if (WIN) launch("cmd.exe", ["/c", "start", "", target]);
  else launch(MAC ? "open" : "xdg-open", [target]);
}

function openIn(project, app) {
  const dir = WIN ? project.path.replace(/\//g, "\\") : project.path;
  if (app === "vscode") launch("code", [`"${dir}"`], { shell: true });
  else if (app === "explorer") WIN ? launch("explorer.exe", [dir]) : openDefault(dir);
  else if (app === "terminal") {
    if (WIN) launch("cmd.exe", ["/c", "start", "", "wt.exe", "-d", dir]);
    else if (MAC) launch("open", ["-a", "Terminal", dir]);
    else launch("x-terminal-emulator", [], { cwd: dir });
  } else if (app === "github" && project.remote) openDefault(project.remote.replace(/\.git$/, "").replace(/^git@([^:]+):/, "https://$1/"));
  else throw new Error("Aplicación no soportada.");
}

async function api(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1).map(decodeURIComponent); // quita "api"
  const [resource, name, action] = parts;

  // Las peticiones que cambian algo exigen la cabecera X-Hub: así otra web no puede lanzarlas
  if (req.method !== "GET" && req.headers["x-hub"] !== "1") return json(res, 403, { error: "Prohibido" });
  if (req.method !== "GET") escaneo = null;

  if (req.method === "GET" && resource === "projects" && !name) return json(res, 200, proyectos());
  if (req.method === "POST" && resource === "fetch") return json(res, 200, await fetchProjects());

  // Sincronizar todo: GET enseña el plan; POST lo ejecuta (solo avance rápido) y sincroniza la configuración del hub.
  // Es la única vía por la que el hub hace pull o push en los proyectos, y solo porque el usuario lo pide y confirma aquí.
  if (resource === "sync") {
    if (req.method === "GET") return json(res, 200, syncPlan(proyectos().projects));
    if (req.method === "POST") {
      await fetchProjects();
      const { acciones, omitidos } = syncPlan(scanProjects({ write: false }).projects);
      const resultados = await runSyncPlan(acciones);
      const config = await syncData().catch((e) => ({ activo: true, ok: false, error: e.message }));
      return json(res, 200, { resultados, omitidos, config });
    }
  }

  // Repos de GitHub no clonados en este equipo
  if (resource === "github") {
    if (req.method === "GET" && !name) return json(res, 200, await remoteOnlyProjects({ force: url.searchParams.has("force") }));
    if (req.method === "POST" && action === "clone") return json(res, 200, await cloneProject(name));
    if (req.method === "POST" && action === "hide") return json(res, 200, hideRepo(name));
    return json(res, 404, { error: "No encontrado" });
  }
  if (resource !== "projects" || !name) return json(res, 404, { error: "No encontrado" });

  const project = findProject(name);
  if (req.method === "GET" && !action) return json(res, 200, getContext(project));

  const body = await readBody(req);
  if (req.method === "POST" && action === "open") {
    openIn(project, body.app);
    return json(res, 200, { ok: true });
  }
  if (req.method === "POST" && action === "steps") return json(res, 200, addStep(project, String(body.text || "").trim()));
  if (req.method === "PATCH" && action === "steps") return json(res, 200, toggleStep(project, body.text, Boolean(body.done)));
  if (req.method === "PATCH" && action === "info") {
    const config = loadConfig();
    config.projects ??= {};
    const current = config.projects[project.name] ?? {};
    if (body.prioridad) current.prioridad = body.prioridad;
    if (typeof body.descripcion === "string") current.descripcion = body.descripcion.trim();
    config.projects[project.name] = current;
    saveConfig(config);
    return json(res, 200, current);
  }
  return json(res, 404, { error: "No encontrado" });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  // Solo se atiende a localhost (evita ataques de DNS rebinding)
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || "")) {
    res.writeHead(403).end();
    return;
  }
  try {
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(readFileSync(join(HUB, "public", "index.html")));
    }
    res.writeHead(404).end("No encontrado");
  } catch (e) {
    json(res, 400, { error: e.message });
  }
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.log(`El dashboard ya está abierto en http://localhost:${PORT}`);
    if (process.argv.includes("--open")) openDefault(`http://localhost:${PORT}`);
  } else console.error(e);
});

server.listen(PORT, HOST, () => {
  console.log(`ProjectHub dashboard en http://localhost:${PORT}  (Ctrl+C para cerrar)`);
  if (process.argv.includes("--open")) openDefault(`http://localhost:${PORT}`);
});
