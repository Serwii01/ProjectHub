#!/usr/bin/env node
// Servidor MCP del ProjectHub: intermediario entre Claude y los proyectos del usuario.
// Claude Code lo arranca por stdio (registrado como "project-hub").

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  scanProjects, findProject, getContext, listFiles, readProjectFile,
  searchProjects, gitSummary, updateStatus, loadConfig, saveConfig,
} from "./lib/hub.mjs";

const server = new McpServer(
  { name: "project-hub", version: "1.0.0" },
  {
    instructions:
      "ProjectHub da acceso a todos los proyectos (repos) del usuario por su nombre, desde cualquier carpeta. " +
      "Empieza con list_projects para ver qué hay y en qué estado está cada uno, y con get_project_context antes de trabajar en uno. " +
      "Para consultar código de otro proyecto usa search_projects / read_project_file en vez de buscar rutas a mano. " +
      "Al terminar una sesión de trabajo, guarda el progreso con update_status. Todo en español.",
  },
);

const ok = (data) => ({ content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });
const fail = (e) => ({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
const tool = (name, config, handler) =>
  server.registerTool(name, config, async (args) => {
    try {
      return ok(await handler(args));
    } catch (e) {
      return fail(e);
    }
  });

const projectArg = z.string().describe("Nombre del proyecto (sin distinguir mayúsculas; vale un prefijo, p. ej. 'prest')");

tool(
  "list_projects",
  {
    title: "Listar proyectos",
    description: "Lista todos los proyectos con ruta, stack, prioridad, último commit, estado git (sin commit / sin push / por bajar), estado actual y siguientes pasos de su STATUS.md.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  () => {
    const { projects } = scanProjects();
    return projects.map(({ branches, remote, ...p }) => p);
  },
);

tool(
  "get_project_context",
  {
    title: "Contexto de un proyecto",
    description: "Todo lo necesario para retomar un proyecto en una llamada: datos del registro, CLAUDE.md (cómo está hecho), STATUS.md (dónde se quedó), git (status, ramas, últimos commits) y TODO/FIXME.",
    inputSchema: { project: projectArg },
    annotations: { readOnlyHint: true },
  },
  ({ project }) => getContext(findProject(project)),
);

tool(
  "list_project_files",
  {
    title: "Listar archivos",
    description: "Lista los archivos de un proyecto (respeta .gitignore; nunca incluye .env, node_modules ni vendor). Opcionalmente dentro de una subcarpeta.",
    inputSchema: { project: projectArg, path: z.string().optional().describe("Subcarpeta relativa a la raíz del proyecto") },
    annotations: { readOnlyHint: true },
  },
  ({ project, path }) => listFiles(findProject(project), path ?? ""),
);

tool(
  "read_project_file",
  {
    title: "Leer archivo",
    description: "Lee un archivo de texto de cualquier proyecto por ruta relativa. Bloquea .env, claves y rutas fuera del proyecto.",
    inputSchema: { project: projectArg, path: z.string().describe("Ruta relativa a la raíz del proyecto, p. ej. 'src/lib/api.ts'") },
    annotations: { readOnlyHint: true },
  },
  ({ project, path }) => readProjectFile(findProject(project), path),
);

tool(
  "search_projects",
  {
    title: "Buscar en proyectos",
    description: "Busca texto (o regex) en el código de un proyecto o de todos a la vez. Útil para '¿cómo hice X en otro proyecto?'. Devuelve archivo:línea:contenido.",
    inputSchema: {
      query: z.string().describe("Texto a buscar (sin distinguir mayúsculas)"),
      project: projectArg.optional().describe("Limitar a un proyecto; si se omite, busca en todos"),
      regex: z.boolean().optional().describe("Interpretar query como expresión regular extendida"),
    },
    annotations: { readOnlyHint: true },
  },
  ({ query, project, regex }) => {
    const results = searchProjects(query, { project, regex });
    return results.length ? results : "Sin resultados.";
  },
);

tool(
  "git_summary",
  {
    title: "Resumen git",
    description: "Estado git de un proyecto: rama, commits sin push o por bajar, cambios sin commit, ramas y últimos commits. Con diff=true incluye el diff de los cambios sin commit.",
    inputSchema: { project: projectArg, diff: z.boolean().optional() },
    annotations: { readOnlyHint: true },
  },
  ({ project, diff }) => gitSummary(findProject(project), { diff }),
);

tool(
  "update_status",
  {
    title: "Actualizar STATUS.md",
    description:
      "Guarda el progreso de una sesión en el STATUS.md del proyecto (lo crea si no existe). Añade una entrada fechada en 'Última sesión' (conserva las 5 últimas), " +
      "quita de 'Siguientes pasos' los completados y añade los nuevos, y puede reescribir el estado actual y añadir decisiones o problemas. No hace commit.",
    inputSchema: {
      project: projectArg,
      estado: z.string().optional().describe("Nuevo texto de 'Estado actual' (2–4 líneas)"),
      sesion: z.array(z.string()).optional().describe("Viñetas de lo hecho en esta sesión"),
      completados: z.array(z.string()).optional().describe("Fragmentos de texto de los pasos ya hechos, para quitarlos"),
      nuevos_pasos: z.array(z.string()).optional().describe("Pasos nuevos a añadir al final de 'Siguientes pasos'"),
      decisiones: z.array(z.string()).optional(),
      problemas: z.array(z.string()).optional(),
    },
  },
  ({ project, nuevos_pasos, ...rest }) => {
    const p = findProject(project);
    const status = updateStatus(p, { ...rest, nuevosPasos: nuevos_pasos ?? [] });
    scanProjects();
    return { project: p.name, file: `${p.path}/STATUS.md`, estado: status.estado, siguientesPasos: status.steps };
  },
);

tool(
  "set_project_info",
  {
    title: "Cambiar datos del proyecto en el hub",
    description: "Cambia la descripción o la prioridad de un proyecto en el registro central (hub.config.json).",
    inputSchema: {
      project: projectArg,
      descripcion: z.string().optional(),
      prioridad: z.enum(["alta", "media", "baja", "archivado"]).optional(),
    },
  },
  ({ project, descripcion, prioridad }) => {
    const p = findProject(project);
    const config = loadConfig();
    config.projects ??= {};
    config.projects[p.name] = { ...config.projects[p.name], ...(descripcion && { descripcion }), ...(prioridad && { prioridad }) };
    saveConfig(config);
    scanProjects();
    return { project: p.name, ...config.projects[p.name] };
  },
);

await server.connect(new StdioServerTransport());
