#!/usr/bin/env node
// Servidor MCP de ProjectHub: intermediario entre una IA y los proyectos del usuario.
// Cualquier cliente MCP lo arranca por stdio (registrado como "project-hub"): Claude Code, Claude Desktop,
// Cursor, VS Code, Windsurf, Gemini CLI, Codex… No depende de ninguno: las instrucciones van en el propio
// servidor (instructions, avisos de cada herramienta y prompts).
// Las respuestas son breves por defecto: el detalle se da solo si la IA lo pide.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  HUB, VERSION, scanProjects, findProject, getContext, listFiles, readProjectFile,
  searchProjects, gitSummary, updateStatus, loadConfig, saveConfig,
  remoteOnlyProjects, cloneProject, fetchProjects, workReport, saveHandoff, saveMachineState, searchNotes,
} from "./lib/hub.mjs";
import { codeHash, hubHealth, skillPrompt } from "./lib/instalacion.mjs";
import { briefContext, projectMap, projectsTable, recordUsage, syncData } from "./lib/resumen.mjs";

const loadedHash = codeHash();

const server = new McpServer(
  { name: "project-hub", title: "ProjectHub", version: VERSION },
  {
    instructions:
      "ProjectHub da acceso a los proyectos (repos git) del usuario por su nombre, desde cualquier carpeta, y guarda en cada repo dónde se quedó el trabajo (STATUS.md), " +
      "para continuar en otro chat o en otro equipo sin volver a explicarlo ni explorar el código. " +
      "Antes de trabajar en un proyecto llama a get_project_context y actúa según siguienteAccion y avisos: traen la instrucción exacta para cada situación " +
      "(relevo a medias, commits por bajar, trabajo sin subir en otro equipo, archivos que no se editan a mano). Atiende primero los avisos de nivel alto. " +
      "Las respuestas son breves a propósito: pide más (detalle, contexto, get_project_map, un rango de líneas) solo cuando lo necesites. " +
      "Si una herramienta dice que un nombre es ambiguo, pregunta al usuario; no elijas tú. Si no está clonado pero sí en GitHub, ofrece clone_project. " +
      "Para consultar otro proyecto usa search_notes (decisiones y sesiones anotadas) antes que search_projects y read_project_file (código). " +
      "Al terminar un bloque de trabajo, guarda el progreso con update_status. Si la conversación se va a quedar sin contexto o el usuario va a seguir en otro chat u otro equipo " +
      "con trabajo a medias, llama antes a save_handoff. " +
      "Este servidor no hace commit, push ni pull en los proyectos: hazlos tú con tus herramientas y solo con confirmación del usuario; nunca force push. " +
      "Si algo del hub falla o parece viejo, llama a hub_health. Responde al usuario en su idioma.",
  },
);

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

const projectArg = z.string().describe("Nombre del proyecto (sin distinguir mayúsculas; vale un prefijo, p. ej. 'prest')");

tool(
  "list_projects",
  {
    title: "Listar proyectos",
    description:
      "Panorama de los proyectos clonados en este equipo: una línea por proyecto (prioridad, último trabajo, estado git, siguiente paso), los avisos que importan hoy, " +
      "el proyecto recomendado y los repos de GitHub sin clonar. Hace git fetch antes, salvo con actualizar=false. " +
      "Con detalle=true devuelve todos los campos en JSON: úsalo solo si necesitas rutas, stack o descripciones.",
    inputSchema: {
      actualizar: z.boolean().optional().describe("Hacer git fetch de todos antes de calcular el estado (por defecto true). false si solo importa la lista."),
      detalle: z.boolean().optional().describe("Todos los campos de cada proyecto en JSON (por defecto false: tabla breve)"),
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
    if (!detalle) return projectsTable(projects, { noClonados, fetchFallido });
    const clonados = projects.map(({ branches, remote, unloggedCommits, calidad, head, ...p }) => p);
    return { clonados, noClonadosEnEsteEquipo: noClonados, ...(fetchFallido.length && { fetchFallido }) };
  },
);

tool(
  "clone_project",
  {
    title: "Clonar proyecto",
    description: "Clona en este equipo un repo de la cuenta de GitHub del usuario (en la carpeta cloneDir de local.json) y lo añade al hub. Úsalo cuando el usuario quiera trabajar en un proyecto que solo tiene en otro equipo.",
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
      "Lo necesario para retomar un proyecto, tras hacer git fetch: siguienteAccion (qué hacer ahora), avisos (cada uno con su instrucción en accion), relevo (trabajo a medias de un chat anterior), " +
      "estado, siguientes pasos, última sesión, commits sin anotar (sinAnotar) y commits por bajar. " +
      "Pasa contexto=true si la sesión NO está abierta en la carpeta del proyecto, para recibir también su archivo de contexto (AGENTS.md, CLAUDE.md…); si está en ella, tu cliente ya lo ha cargado. " +
      "detalle=\"completo\" añade STATUS.md entero, el log de git, los TODO del código y todos los campos: pídelo solo si lo breve no basta.",
    inputSchema: {
      project: projectArg,
      contexto: z.boolean().optional().describe("Incluir el archivo de contexto del proyecto (por defecto false)"),
      detalle: z.enum(["breve", "completo"]).optional().describe("Por defecto \"breve\""),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ project, contexto = false, detalle = "breve" }) => {
    const [p] = await Promise.all([Promise.resolve(findProject(project)), bajarConfig()]);
    await fetchProjects([p]); // trae las novedades de otros equipos antes de calcular ahead/behind
    const actual = findProject(p.name);
    saveMachineState([actual]);
    return detalle === "completo" ? getContext(actual) : briefContext(actual, { contexto });
  },
);

tool(
  "get_project_map",
  {
    title: "Mapa de un proyecto",
    description:
      "Estructura de un proyecto en pocas líneas: carpetas con su tamaño, scripts y los archivos de código principales con lo que dice su primer comentario. " +
      "Úsalo antes de explorar un proyecto que no conoces, en vez de listar y abrir archivos a ciegas.",
    inputSchema: { project: projectArg },
    annotations: { readOnlyHint: true },
  },
  ({ project }) => projectMap(findProject(project)),
);

tool(
  "list_project_files",
  {
    title: "Listar archivos",
    description: "Lista los archivos de un proyecto (respeta .gitignore; nunca incluye .env, node_modules ni vendor). Opcionalmente dentro de una subcarpeta.",
    inputSchema: { project: projectArg, path: z.string().optional().describe("Subcarpeta relativa a la raíz del proyecto") },
    annotations: { readOnlyHint: true },
  },
  ({ project, path }) => {
    const r = listFiles(findProject(project), path ?? "");
    return `${r.total} archivos${r.truncated ? ` (se muestran ${r.files.length}; acota con path)` : ""}:\n${r.files.join("\n")}`;
  },
);

tool(
  "read_project_file",
  {
    title: "Leer archivo",
    description:
      "Lee un archivo de texto de cualquier proyecto por ruta relativa. Con desde y hasta devuelve solo esas líneas: úsalo en archivos grandes, a partir del número de línea que da search_projects. " +
      "Bloquea .env, claves y rutas fuera del proyecto.",
    inputSchema: {
      project: projectArg,
      path: z.string().describe("Ruta relativa a la raíz del proyecto, p. ej. 'src/lib/api.ts'"),
      desde: z.number().int().min(1).optional().describe("Primera línea a devolver (empieza en 1)"),
      hasta: z.number().int().min(1).optional().describe("Última línea a devolver (por defecto, 400 líneas desde «desde»)"),
    },
    annotations: { readOnlyHint: true },
  },
  ({ project, path, desde, hasta }) => readProjectFile(findProject(project), path, { desde, hasta }),
);

tool(
  "search_projects",
  {
    title: "Buscar en proyectos",
    description:
      "Busca texto (o regex) en el código de un proyecto o de todos a la vez. Útil para «¿cómo hice X en otro proyecto?». Devuelve archivo:línea:contenido, " +
      "pocas coincidencias por proyecto (total dice cuántas hay): acota con project o sube max si hacen falta más.",
    inputSchema: {
      query: z.string().describe("Texto a buscar (sin distinguir mayúsculas)"),
      project: projectArg.optional().describe("Limitar a un proyecto; si se omite, busca en todos"),
      regex: z.boolean().optional().describe("Interpretar query como expresión regular extendida"),
      max: z.number().int().min(1).max(200).optional().describe("Coincidencias por proyecto (por defecto 8 al buscar en todos, 25 en uno)"),
    },
    annotations: { readOnlyHint: true },
  },
  ({ query, project, regex, max }) => {
    const results = searchProjects(query, { project, regex, max });
    if (!results.length) return "Sin resultados.";
    return results.map((r) => `## ${r.project} (${r.total}${r.total > r.matches.length ? `, se muestran ${r.matches.length}` : ""})\n${r.matches.join("\n")}`).join("\n\n");
  },
);

tool(
  "search_notes",
  {
    title: "Buscar en lo anotado",
    description:
      "Busca en lo que ya está escrito sobre los proyectos: decisiones y su porqué, problemas conocidos, estado y sesiones de trabajo (también las antiguas). " +
      "Úsalo antes de buscar en el código para «¿por qué hice esto así?», «¿cómo resolví X?» o «¿cuándo cambié Y?»: es mucho más barato. Encaja las notas que contienen todas las palabras.",
    inputSchema: {
      query: z.string().describe("Palabras que debe contener la nota, p. ej. 'login sesiones'"),
      project: projectArg.optional().describe("Limitar a un proyecto; si se omite, busca en todos"),
    },
    annotations: { readOnlyHint: true },
  },
  ({ query, project }) => {
    const results = searchNotes(query, { project });
    if (!results.length) return "Nada anotado con esas palabras. Prueba con menos palabras o busca en el código con search_projects.";
    return results.map((r) => `## ${r.project} (${r.total}${r.total > r.notas.length ? `, se muestran ${r.notas.length}` : ""})\n${r.notas.map((n) => `- ${n}`).join("\n")}`).join("\n\n");
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
      "Guarda el progreso de una sesión en el STATUS.md del proyecto (lo crea si no existe). Añade una entrada fechada en «Última sesión» (quedan las 5 últimas; las anteriores pasan a HISTORY.md), " +
      "quita de «Siguientes pasos» los completados y añade los nuevos, y puede reescribir el estado actual y añadir decisiones o problemas. Borra el relevo pendiente. No hace commit. " +
      "Escribe viñetas de una o dos líneas: la ficha se relee en cada sesión y el detalle ya está en git. " +
      "Devuelve cambios: revisa noEncontrados y ambiguos, porque esos pasos no se han quitado; repite con un fragmento más concreto.",
    inputSchema: {
      project: projectArg,
      estado: z.string().optional().describe("Nuevo texto de «Estado actual» (2–4 líneas)"),
      sesion: z.array(z.string()).optional().describe("Viñetas de lo hecho en esta sesión, cortas"),
      fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Día de la sesión (AAAA-MM-DD) si no es hoy, p. ej. para anotar commits de un día anterior que no se cerraron"),
      completados: z.array(z.string()).optional().describe("Fragmento del texto de cada paso ya hecho, para quitarlo. Debe señalar un único paso"),
      nuevos_pasos: z.array(z.string()).optional().describe("Pasos nuevos a añadir al final de «Siguientes pasos»"),
      decisiones: z.array(z.string()).optional(),
      problemas: z.array(z.string()).optional(),
    },
  },
  ({ project, nuevos_pasos, ...rest }) => {
    const p = findProject(project);
    const status = updateStatus(p, { ...rest, nuevosPasos: nuevos_pasos ?? [], idioma: loadConfig().idioma });
    const actual = findProject(p.name);
    saveMachineState([actual]);
    subirConfig();
    return { project: p.name, file: `${p.path}/STATUS.md`, cambios: status.cambios, siguientesPasos: status.steps.filter((s) => !s.done).map((s) => s.text), git: actual.avisos.filter((a) => ["cambios_sin_commit", "commits_sin_subir"].includes(a.codigo)).map((a) => `${a.mensaje} ${a.accion}`) };
  },
);

tool(
  "save_handoff",
  {
    title: "Guardar relevo",
    description:
      "Deja anotado el trabajo que está a medias para que otro chat, u otro equipo, lo continúe sin perder nada. Úsalo cuando la conversación se vaya a quedar sin contexto, " +
      "cuando el usuario diga que sigue en otro chat o en otro ordenador, o antes de una pausa con algo sin terminar. No sustituye a update_status: el relevo es para lo que aún no está hecho. " +
      "Se guarda en .projecthub/relevo.md dentro del repo, con la lista de archivos sin commit, y se borra al cerrar la sesión. " +
      "Escribe pensando en alguien que no ha visto esta conversación.",
    inputSchema: {
      project: projectArg,
      haciendo: z.string().describe("Qué se estaba haciendo y en qué punto exacto quedó"),
      siguiente: z.string().describe("El paso inmediato para continuar, concreto: archivo, función, comando"),
      hecho: z.array(z.string()).optional().describe("Lo ya terminado en este tramo, incluido lo probado y lo descartado con su porqué"),
      notas: z.string().optional().describe("Lo que costó averiguar y no se ve en el código: causas, trampas, decisiones pendientes del usuario"),
    },
  },
  ({ project, ...datos }) => {
    const p = findProject(project);
    const r = saveHandoff(p, datos);
    saveMachineState([findProject(p.name)]);
    subirConfig();
    const pendiente = r.sinCommit + r.ahead;
    return {
      guardado: `${p.path}/${r.file}`,
      aviso: pendiente
        ? `El relevo y ${r.sinCommit} archivos sin commit solo están en este equipo. En otro chat de este equipo ya se puede continuar. Para seguir en otro equipo hay que subirlos: ` +
          "propón al usuario un commit de lo que está a medias (si no está para la rama principal, en una rama wip/<tema>) y push, y hazlo solo si lo confirma."
        : "El relevo está guardado. Para que llegue a otro equipo hay que hacer commit y push del archivo: propónselo al usuario.",
    };
  },
);

tool(
  "hub_health",
  {
    title: "Estado del propio hub",
    description:
      "Comprueba que el hub está al día en este equipo: versión del MCP en marcha, clientes de IA donde está registrado, extras de Claude Code (skills, reglas globales, hooks), carpetas y sincronización del hub y de su configuración. " +
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
  "work_report",
  {
    title: "Informe de trabajo",
    description:
      "Qué se ha hecho en todos los proyectos en los últimos días (7 por defecto): las sesiones anotadas en cada STATUS.md y los commits que aún no se han anotado. " +
      "Úsala para «¿qué hice esta semana?», informes, memorias o para preparar una reunión. Resume por proyecto; no inventes nada que no esté en la respuesta.",
    inputSchema: { dias: z.number().int().min(1).max(365).optional().describe("Cuántos días hacia atrás (por defecto 7)") },
    annotations: { readOnlyHint: true },
  },
  ({ dias = 7 }) => workReport({ dias }),
);

tool(
  "set_project_info",
  {
    title: "Cambiar datos del proyecto en el hub",
    description: "Cambia la descripción o la prioridad de un proyecto en la configuración del hub (config.json).",
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
    subirConfig();
    return { project: p.name, ...config.projects[p.name] };
  },
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
