#!/usr/bin/env node
// Servidor MCP del ProjectHub: intermediario entre Claude y los proyectos del usuario.
// Claude Code lo arranca por stdio (registrado como "project-hub").

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  HUB, scanProjects, findProject, getContext, listFiles, readProjectFile,
  searchProjects, gitSummary, updateStatus, loadConfig, saveConfig,
  remoteOnlyProjects, cloneProject, fetchProjects,
} from "./lib/hub.mjs";
import { codeHash, hubHealth } from "./lib/instalacion.mjs";

const loadedHash = codeHash();

const server = new McpServer(
  { name: "project-hub", version: "1.1.0" },
  {
    instructions:
      "ProjectHub da acceso a los proyectos (repos) del usuario por su nombre, desde cualquier carpeta. El usuario trabaja en dos equipos. " +
      "Antes de trabajar en un proyecto llama a get_project_context y actúa según siguienteAccion y avisos: traen la instrucción exacta para cada situación " +
      "(commits por bajar, ficha desactualizada, ramas, archivos que no se editan a mano). Atiende primero los avisos de nivel alto. " +
      "Si una herramienta dice que un nombre es ambiguo, pregunta al usuario; no elijas tú. Si no está clonado pero sí en GitHub, ofrece clone_project. " +
      "Para consultar otro proyecto usa search_projects y read_project_file. Al terminar un bloque de trabajo, guarda el progreso con update_status y revisa su campo cambios. " +
      "Este servidor no hace commit, push ni pull: eso lo hace Claude con sus herramientas y con confirmación del usuario. Si algo del hub falla o parece viejo, llama a hub_health. Todo en español.",
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
    description:
      "Lista los proyectos clonados en este equipo (ruta, stack, prioridad, último commit, estado git, avisos, siguienteAccion y siguientes pasos) " +
      "y, aparte, los repos de la cuenta de GitHub que no están clonados aquí. Hace git fetch antes, salvo con actualizar=false, para saber qué hay por bajar.",
    inputSchema: { actualizar: z.boolean().optional().describe("Hacer git fetch de todos antes de calcular el estado (por defecto true). false si solo importa la lista.") },
    annotations: { readOnlyHint: true },
  },
  async ({ actualizar = true }) => {
    const sinConexion = actualizar ? (await fetchProjects()).filter((r) => !r.ok).map((r) => r.project) : [];
    const { projects } = scanProjects();
    let noClonados;
    try {
      noClonados = (await remoteOnlyProjects()).map(({ name, repo, description, descripcion, pushedAt, private: priv }) => ({
        name, repo, descripcion: descripcion || description, ultimoPush: pushedAt?.slice(0, 10), privado: priv,
      }));
    } catch (e) {
      noClonados = `No se pudo consultar GitHub: ${e.message}`;
    }
    const clonados = projects.map(({ branches, remote, unloggedCommits, calidad, ...p }) => p);
    return { clonados, noClonadosEnEsteEquipo: noClonados, ...(sinConexion.length && { fetchFallido: sinConexion }) };
  },
);

tool(
  "clone_project",
  {
    title: "Clonar proyecto",
    description: "Clona en este equipo un repo de la cuenta de GitHub del usuario (en la carpeta de clonado de hub.local.json) y lo añade al hub. Úsalo cuando el usuario quiera trabajar en un proyecto que solo tiene en otro equipo.",
    inputSchema: { repo: z.string().describe("Nombre del repo en GitHub o nombre del proyecto en el hub") },
  },
  async ({ repo }) => {
    const p = await cloneProject(repo);
    return { clonado: p.name, path: p.path, tieneStatus: p.hasStatusMd, siguientesPasos: p.nextSteps };
  },
);

tool(
  "get_project_context",
  {
    title: "Contexto de un proyecto",
    description:
      "Todo para retomar un proyecto en una llamada, tras hacer git fetch: siguienteAccion (qué hacer ahora), avisos (cada uno con su instrucción en accion), datos del registro, " +
      "CLAUDE.md, STATUS.md, git y TODO/FIXME. project.unloggedCommits son commits posteriores a la última actualización de STATUS.md; project.fuentes y project.fuenteDe, repos relacionados.",
    inputSchema: { project: projectArg },
    annotations: { readOnlyHint: true },
  },
  async ({ project }) => {
    const p = findProject(project);
    await fetchProjects([p]); // trae las novedades de otros equipos antes de calcular ahead/behind
    return getContext(findProject(p.name));
  },
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
      "quita de 'Siguientes pasos' los completados y añade los nuevos, y puede reescribir el estado actual y añadir decisiones o problemas. No hace commit. " +
      "Devuelve cambios: revisa noEncontrados y ambiguos, porque esos pasos no se han quitado; repite con un fragmento más concreto.",
    inputSchema: {
      project: projectArg,
      estado: z.string().optional().describe("Nuevo texto de 'Estado actual' (2–4 líneas)"),
      sesion: z.array(z.string()).optional().describe("Viñetas de lo hecho en esta sesión"),
      fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Día de la sesión (AAAA-MM-DD) si no es hoy, p. ej. para anotar commits de un día anterior que no se cerraron"),
      completados: z.array(z.string()).optional().describe("Fragmento del texto de cada paso ya hecho, para quitarlo. Debe señalar un único paso"),
      nuevos_pasos: z.array(z.string()).optional().describe("Pasos nuevos a añadir al final de 'Siguientes pasos'"),
      decisiones: z.array(z.string()).optional(),
      problemas: z.array(z.string()).optional(),
    },
  },
  ({ project, nuevos_pasos, ...rest }) => {
    const p = findProject(project);
    const status = updateStatus(p, { ...rest, nuevosPasos: nuevos_pasos ?? [] });
    scanProjects();
    return { project: p.name, file: `${p.path}/STATUS.md`, cambios: status.cambios, estado: status.estado, siguientesPasos: status.steps };
  },
);

tool(
  "hub_health",
  {
    title: "Estado del propio hub",
    description:
      "Comprueba que el hub está al día en este equipo: versión del MCP en marcha, skills, reglas globales, hooks, dependencias, carpetas y commits del hub por bajar o subir. " +
      "Devuelve problemas, cada uno con su accion. Úsala si algo del hub falla o parece viejo, y al empezar en un equipo tras cambiar el hub.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => {
    await fetchProjects([{ name: "ProjectHub", path: HUB, remote: true }]);
    return hubHealth({ loadedHash });
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
