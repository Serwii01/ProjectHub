#!/usr/bin/env node
// Dashboard web local del ProjectHub: http://localhost:4310
// Uso: node dashboard.mjs [--open]   (--open abre el navegador)

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  HUB, scanProjects, findProject, getContext, toggleStep, addStep, loadConfig, saveConfig,
} from "./lib/hub.mjs";

const PORT = Number(process.env.PORT || 4310);
const HOST = "127.0.0.1";

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

function openIn(project, app) {
  const winPath = project.path.replace(/\//g, "\\");
  if (app === "vscode") launch("code", [winPath], { shell: true });
  else if (app === "explorer") launch("explorer.exe", [winPath]);
  else if (app === "terminal") launch("cmd.exe", ["/c", "start", "", "wt.exe", "-d", winPath], { shell: false });
  else if (app === "github" && project.remote) launch("cmd.exe", ["/c", "start", "", project.remote.replace(/\.git$/, "")]);
  else throw new Error("Aplicación no soportada.");
}

async function api(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean).slice(1).map(decodeURIComponent); // quita "api"
  const [resource, name, action] = parts;

  // Las peticiones que cambian algo exigen la cabecera X-Hub: así otra web no puede lanzarlas
  if (req.method !== "GET" && req.headers["x-hub"] !== "1") return json(res, 403, { error: "Prohibido" });

  if (req.method === "GET" && resource === "projects" && !name) return json(res, 200, scanProjects());
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
    if (process.argv.includes("--open")) launch("cmd.exe", ["/c", "start", "", `http://localhost:${PORT}`]);
  } else console.error(e);
});

server.listen(PORT, HOST, () => {
  console.log(`ProjectHub dashboard en http://localhost:${PORT}  (Ctrl+C para cerrar)`);
  if (process.argv.includes("--open")) launch("cmd.exe", ["/c", "start", "", `http://localhost:${PORT}`]);
});
