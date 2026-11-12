#!/usr/bin/env node
// Servidor MCP de ProjectHub: intermediario entre una IA y los proyectos del usuario.
// Cualquier cliente MCP lo arranca por stdio (registrado como "project-hub"): Claude Code, Claude Desktop,
// Cursor, VS Code, Windsurf, Gemini CLI, Codex… No depende de ninguno: las instrucciones van en el propio
// servidor (instructions, avisos de cada herramienta y prompts).
// Las respuestas son breves por defecto y en texto: el detalle se da solo si la IA lo pide.
// Las instrucciones y las definiciones de las herramientas van en cada conversación: por eso son pocas
// herramientas, con descripciones cortas (hay un test con su máximo de tokens).

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  VERSION, scanProjects, findProject, getContext, listFiles, readProjectFile,
  searchProjects, updateStatus, loadConfig, saveConfig,
  remoteOnlyProjects, cloneProject, fetchProjects, workReport, saveHandoff, saveMachineState, searchNotes,
} from "./lib/hub.mjs";
import { avisosHub, codeHash, equiposAtrasados, skillPrompt } from "./lib/instalacion.mjs";
import { INSTRUCTIONS, briefContext, briefText, gitText, projectMap, projectsTable, recordUsage, statusText, syncData } from "./lib/resumen.mjs";

const loadedHash = codeHash();

const server = new McpServer({ name: "project-hub", title: "ProjectHub", version: VERSION }, { instructions: INSTRUCTIONS });

// JSON sin sangría: la IA lo lee igual y ocupa bastante menos
const texto = (data) => (typeof data === "string" ? data : JSON.stringify(data));
const tool = (name, config, handler) =>
  server.registerTool(name, config, async (args) => {
    try {
      const text = texto(await handler(args));
      recordUsage(name, text);
      return { content: [{ type: "text", text }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  });

// La configuración sincronizada entre equipos se baja antes de leer y se sube después de escribir.
// Nunca debe retrasar ni romper una herramienta.
const bajarConfig = () => Promise.race([syncData({ push: false }), new Promise((r) => setTimeout(r, 8000))]).catch(() => {});
const subirConfig = () => void syncData().catch(() => {});

// Avisos del propio hub (servidor viejo, skills sin reinstalar): van delante de los del proyecto
const delHub = () => avisosHub({ loadedHash });
const lineasHub = (avisos) => avisos.map((a) => `[${a.nivel}] ProjectHub: ${a.mensaje} → ${a.accion}`);

const projectArg = z.string().describe("Nombre o prefijo");

tool(
  "list_projects",
  {
    title: "Listar proyectos",
    description: "Panorama de los proyectos de este equipo, una línea por proyecto (prioridad, último trabajo, git, siguiente paso), avisos, recomendado y repos de GitHub sin clonar. Hace git fetch.",
    inputSchema: {
      actualizar: z.boolean().optional().describe("false: sin git fetch"),
      detalle: z.boolean().optional().describe("JSON con todos los campos"),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ actualizar = true, detalle = false }) => {
    if (actualizar) await bajarConfig();
    const fetchFallido = actualizar ? (await fetchProjects()).filter((r) => !r.ok).map((r) => r.project) : [];
    const { projects } = scanProjects();
    let noClonados;
    try {
      noClonados = (await remoteOnlyProjects()).map(({ name, repo, description, descripcion, pushedAt, private: priv }) => ({
        name, repo, descripcion: descripcion || description, ultimoPush: pushedAt?.slice(0, 10), privado: priv,
      }));
    } catch (e) {
      noClonados = `No se pudo consultar GitHub: ${e.message}`;
    }
    if (detalle) {
      const clonados = projects.map(({ branches, remote, unloggedCommits, calidad, head, ...p }) => p);
      return { clonados, noClonadosEnEsteEquipo: noClonados, ...(fetchFallido.length && { fetchFallido }) };
    }
    const hub = [
      ...lineasHub(delHub()),
      ...equiposAtrasados().map((e) => `[info] ProjectHub: el equipo ${e.equipo} tiene una versión anterior (${e.version}) → allí: git pull en el hub, npm ci, npm run instalar y reiniciar el cliente.`),
    ];
    const tabla = projectsTable(projects, { noClonados, fetchFallido });
    return hub.length ? `${hub.join("\n")}\n\n${tabla}` : tabla;
  },
);

tool(
  "clone_project",
  {
    title: "Clonar proyecto",
    description: "Clona en este equipo un repo de la cuenta de GitHub del usuario y lo añade al hub.",
    inputSchema: { repo: z.string().describe("Repo de GitHub o proyecto del hub") },
  },
  async ({ repo }) => {
    const p = await cloneProject(repo);
    return `Clonado ${p.name} en ${p.path}.${p.hasStatusMd ? "" : " No tiene STATUS.md."}${p.nextSteps[0] ? ` Siguiente paso: ${p.nextSteps[0]}` : ""}`;
  },
);

tool(
  "get_project_context",
  {
    title: "Contexto de un proyecto",
    description:
      "Para retomar un proyecto, tras git fetch: avisos con su acción, relevo, estado, siguientes pasos, última sesión y commits sin anotar o por bajar. " +
      "contexto=true si la sesión no está en su carpeta. detalle: \"git\" (estado, ramas, log; diff=true añade el diff) o \"completo\" (todo, caro).",
    inputSchema: {
      project: projectArg,
      contexto: z.boolean().optional().describe("Añadir ruta y archivo de contexto"),
      detalle: z.enum(["breve", "git", "completo"]).optional(),
      diff: z.boolean().optional(),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ project, contexto = false, detalle = "breve", diff = false }) => {
    const [p] = await Promise.all([Promise.resolve(findProject(project)), bajarConfig()]);
    await fetchProjects([p]); // trae las novedades de otros equipos antes de calcular ahead/behind
    const actual = findProject(p.name);
    saveMachineState([actual]);
    if (detalle === "git") return gitText(actual, { diff });
    if (detalle === "completo") return getContext(actual);
    return briefText(briefContext(actual, { contexto }), { avisosHub: delHub() });
  },
);

tool(
  "get_project_map",
  {
    title: "Mapa de un proyecto",
    description: "Estructura de un proyecto en pocas líneas: carpetas, scripts y archivos principales con su primer comentario. Úsalo antes de explorar. Con path, lista los archivos de esa subcarpeta.",
    inputSchema: { project: projectArg, path: z.string().optional().describe("Subcarpeta a listar") },
    annotations: { readOnlyHint: true },
  },
  ({ project, path }) => {
    const p = findProject(project);
    if (path === undefined) return projectMap(p);
    const r = listFiles(p, path);
    return `${r.total} archivos${r.truncated ? ` (se muestran ${r.files.length}; acota con path)` : ""}:\n${r.files.join("\n")}`;
  },
);

tool(
  "read_project_file",
  {
    title: "Leer archivo",
    description: "Lee un archivo de texto de un proyecto. En archivos grandes, pide solo las líneas desde–hasta. Bloquea .env, claves y rutas fuera del proyecto.",
    inputSchema: {
      project: projectArg,
      path: z.string().describe("Ruta relativa al proyecto"),
      desde: z.number().int().min(1).optional(),
      hasta: z.number().int().min(1).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  ({ project, path, desde, hasta }) => readProjectFile(findProject(project), path, { desde, hasta }),
);

tool(
  "search",
  {
    title: "Buscar",
    description:
      "Busca en uno o todos los proyectos. en=\"notas\" (por defecto): lo anotado (decisiones, problemas, sesiones, también antiguas), para «¿por qué/cómo/cuándo hice X?»; es lo barato. " +
      "en=\"codigo\": texto o regex en el código, devuelve archivo:línea.",
    inputSchema: {
      query: z.string().describe("Notas: palabras que deben aparecer. Código: texto"),
      en: z.enum(["notas", "codigo"]).optional(),
      project: projectArg.optional(),
      regex: z.boolean().optional(),
      max: z.number().int().min(1).max(200).optional().describe("Coincidencias de código por proyecto"),
    },
    annotations: { readOnlyHint: true },
  },
  ({ query, en = "notas", project, regex, max }) => {
    const cabecera = (r, n, total) => `## ${r.project} (${total}${total > n ? `, se muestran ${n}` : ""})`;
    if (en === "notas") {
      const results = searchNotes(query, { project });
      if (!results.length) return "Nada anotado con esas palabras. Prueba con menos palabras o con en=\"codigo\".";
      return results.map((r) => `${cabecera(r, r.notas.length, r.total)}\n${r.notas.map((n) => `- ${n}`).join("\n")}`).join("\n\n");
    }
    const results = searchProjects(query, { project, regex, max });
    if (!results.length) return "Sin resultados.";
    return results.map((r) => `${cabecera(r, r.matches.length, r.total)}\n${r.matches.join("\n")}`).join("\n\n");
  },
);

tool(
  "update_status",
  {
    title: "Actualizar STATUS.md",
    description:
      "Guarda el progreso en el STATUS.md del proyecto (lo crea si falta): sesión fechada, pasos completados y nuevos, estado, decisiones y problemas. Borra el relevo. No hace commit. " +
      "Viñetas de una o dos líneas: la ficha se relee siempre. También cambia la prioridad o la descripción del proyecto en el hub.",
    inputSchema: {
      project: projectArg,
      sesion: z.array(z.string()).optional().describe("Lo hecho, en viñetas cortas"),
      fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("AAAA-MM-DD si la sesión no es de hoy"),
      completados: z.array(z.string()).optional().describe("Fragmento único de cada paso hecho"),
      nuevos_pasos: z.array(z.string()).optional(),
      estado: z.string().optional().describe("Nuevo «Estado actual», 2–4 líneas"),
      decisiones: z.array(z.string()).optional(),
      problemas: z.array(z.string()).optional(),
      prioridad: z.enum(["alta", "media", "baja", "archivado"]).optional(),
      descripcion: z.string().optional(),
    },
  },
  ({ project, nuevos_pasos, prioridad, descripcion, ...rest }) => {
    const p = findProject(project);
    const out = [];
    if (prioridad || descripcion) {
      const config = loadConfig();
      config.projects ??= {};
      config.projects[p.name] = { ...config.projects[p.name], ...(descripcion && { descripcion }), ...(prioridad && { prioridad }) };
      saveConfig(config);
      out.push(`Hub: ${p.name}${prioridad ? ` con prioridad ${prioridad}` : ""}${descripcion ? `, descripción «${descripcion}»` : ""}.`);
    }
    const hayFicha = Object.values(rest).some((v) => (Array.isArray(v) ? v.length : v)) || nuevos_pasos?.length;
    if (hayFicha || !out.length) {
      const status = updateStatus(p, { ...rest, nuevosPasos: nuevos_pasos ?? [], idioma: loadConfig().idioma });
      const actual = findProject(p.name);
      saveMachineState([actual]);
      const avisosGit = actual.avisos.filter((a) => ["cambios_sin_commit", "commits_sin_subir"].includes(a.codigo));
      out.push(statusText(p, status.cambios, status.steps.filter((s) => !s.done).length, avisosGit));
    }
    subirConfig();
    return out.join("\n");
  },
);

tool(
  "save_handoff",
  {
    title: "Guardar relevo",
    description:
      "Deja anotado el trabajo a medias para que otro chat u otro equipo lo continúe: cuando se vaya a acabar el contexto, el usuario siga en otro sitio o haya una pausa con algo sin terminar. " +
      "Lo terminado va en update_status. Escribe para alguien que no ha visto esta conversación.",
    inputSchema: {
      project: projectArg,
      haciendo: z.string().describe("Qué y en qué punto exacto quedó"),
      siguiente: z.string().describe("Paso inmediato: archivo, función o comando"),
      hecho: z.array(z.string()).optional().describe("Terminado, probado o descartado, con su porqué"),
      notas: z.string().optional().describe("Lo que costó averiguar y no se ve en el código"),
    },
  },
  ({ project, ...datos }) => {
    const p = findProject(project);
    const r = saveHandoff(p, datos);
    saveMachineState([findProject(p.name)]);
    subirConfig();
    return `Relevo guardado en ${p.path}/${r.file}. En otro chat de este equipo ya se puede seguir. ` +
      (r.sinCommit + r.ahead
        ? `Para otro equipo hay que subirlo junto con ${r.sinCommit} archivos sin commit: propón commit (en wip/<tema> si no es para la rama principal) y push, solo si lo confirma.`
        : "Para otro equipo hay que hacer commit y push del relevo: propónselo.");
  },
);

tool(
  "work_report",
  {
    title: "Informe de trabajo",
    description: "Lo hecho en todos los proyectos en los últimos días (7 por defecto): sesiones anotadas y commits sin anotar. Para «¿qué hice esta semana?» o informes; no inventes nada más.",
    inputSchema: { dias: z.number().int().min(1).max(365).optional() },
    annotations: { readOnlyHint: true },
  },
  ({ dias = 7 }) => workReport({ dias }),
);

// Prompts: los mismos procedimientos que las skills de Claude Code, para cualquier cliente MCP.
// Se leen al pedirlos, así que un cambio en skills/ no exige reiniciar.
const prompt = (name, title, argsSchema, intro) =>
  server.registerPrompt(name, { title, description: skillPrompt(name).description, argsSchema }, (args) => ({
    messages: [{ role: "user", content: { type: "text", text: `${intro(args ?? {})}\n\n${skillPrompt(name).body}` } }],
  }));

prompt("proyectos", "Panorama de mis proyectos", {}, () => "Dame el panorama de mis proyectos siguiendo este procedimiento.");
prompt(
  "retomar",
  "Retomar un proyecto",
  { proyecto: z.string().optional().describe("Nombre del proyecto (vale un prefijo)") },
  ({ proyecto }) => (proyecto ? `Retomemos el proyecto «${proyecto}» siguiendo este procedimiento.` : "Quiero retomar un proyecto. Sigue este procedimiento."),
);
prompt("cerrar", "Cerrar la sesión de trabajo", {}, () => "Cerramos la sesión de trabajo. Guarda el progreso siguiendo este procedimiento.");
prompt("relevo", "Dejar un relevo para otro chat o equipo", {}, () => "Voy a seguir en otro chat o en otro equipo. Deja un relevo siguiendo este procedimiento.");

await server.connect(new StdioServerTransport());
