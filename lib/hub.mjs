// Núcleo del hub: escaneo de repos, acceso seguro a archivos y manejo de STATUS.md.
// Lo usan scan.mjs (CLI), mcp-server.mjs (Claude) y dashboard.mjs (web).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync, statSync, mkdirSync, copyFileSync, rmSync, rmdirSync } from "node:fs";
import { join, basename, dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, hostname } from "node:os";

export const HUB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const VERSION = JSON.parse(readFileSync(join(HUB, "package.json"), "utf8")).version;

// Los datos del usuario viven fuera del código, en ~/.projecthub (o donde diga PROJECTHUB_HOME),
// para que el hub se pueda instalar con npm y actualizar sin perder nada:
//   config.json  común a todos los equipos del usuario: proyectos, exclusiones, usuario de GitHub
//   local.json   propio de cada equipo: carpetas a escanear, dónde clonar, token opcional
//   cache/, projects.json, PROJECTS.md   generados
// Se calcula en cada llamada para que los tests puedan apuntar a una carpeta temporal.
export const dataDir = () => resolve(process.env.PROJECTHUB_HOME || join(homedir(), ".projecthub"));
export const dataFile = (...parts) => join(dataDir(), ...parts);

const toPosix = (p) => p.replace(/\\/g, "/");
const defaultConfig = () => ({ github: { user: "", hideForks: true, ignore: [] }, exclude: [], projects: {} });
const defaultLocal = () => {
  const home = toPosix(homedir());
  const roots = ["Documents", "Documents/Proyectos", "Projects", "projects", "code", "dev", "src"].map((d) => `${home}/${d}`).filter((d) => existsSync(d));
  const cloneDir = roots[0] ?? `${home}/Projects`;
  return { roots: roots.length ? roots : [cloneDir], cloneDir, githubToken: "" };
};

// Crea la carpeta de datos la primera vez. Si el hub se usaba desde su repo (versión 1),
// se trae de allí hub.config.json y hub.local.json.
export function ensureData() {
  const dir = dataDir();
  mkdirSync(dir, { recursive: true });
  const seed = (name, legacy, fallback) => {
    const file = join(dir, name);
    if (existsSync(file)) return;
    if (existsSync(join(HUB, legacy))) return copyFileSync(join(HUB, legacy), file);
    // Si un git pull acaba de borrar el archivo del repo (dejó de versionarse en la versión 2), se recupera del historial
    const borrado = existsSync(join(HUB, ".git")) && git(HUB, "log", "-1", "--diff-filter=D", "--format=%H", "--", legacy);
    const previo = borrado && git(HUB, "show", `${borrado}^:${legacy}`);
    writeFileSync(file, previo ? previo + "\n" : JSON.stringify(fallback(), null, 2) + "\n");
  };
  seed("config.json", "hub.config.json", defaultConfig);
  seed("local.json", "hub.local.json", defaultLocal);
  // Por si el usuario sincroniza esta carpeta con git entre sus equipos
  if (!existsSync(join(dir, ".gitignore"))) writeFileSync(join(dir, ".gitignore"), "local.json\ncache/\nbackups/\nprojects.json\nPROJECTS.md\n");
  return dir;
}

export const loadConfig = () => ({ ...defaultConfig(), ...JSON.parse(readFileSync(join(ensureData(), "config.json"), "utf8")) });
export const saveConfig = (config) => writeFileSync(join(ensureData(), "config.json"), JSON.stringify(config, null, 2) + "\n");
export const loadLocal = () => ({ ...defaultLocal(), ...JSON.parse(readFileSync(join(ensureData(), "local.json"), "utf8")) });
export const saveLocal = (local) => writeFileSync(join(ensureData(), "local.json"), JSON.stringify(local, null, 2) + "\n");

// Archivo de contexto del proyecto: el que cada IA lee al abrir la carpeta. Se usa el primero que exista.
export const CONTEXT_FILES = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".github/copilot-instructions.md", ".cursorrules"];
export const contextFileOf = (dir) => CONTEXT_FILES.find((f) => existsSync(join(dir, f))) ?? null;
// Los commits que solo tocan las fichas no cuentan como trabajo
const NO_FICHAS = [".", ...CONTEXT_FILES.map((f) => `:!${f}`), ":!STATUS.md", ":!HISTORY.md", ":!.projecthub"];

// ---------- Equipos: qué trabajo sin subir hay en cada ordenador del usuario ----------
// Cada equipo anota en datos/equipos/<nombre>.json los proyectos que tiene con commits sin subir o cambios
// sin commit. Si la carpeta de datos se sincroniza (projecthub sync), los demás equipos lo ven y avisan.

export const equipoActual = () => String(loadLocal().equipo || hostname()).trim();
const equipoFile = () => dataFile("equipos", `${equipoActual().replace(/[^\w.-]+/g, "_")}.json`);
const claveDe = (p) => (p.repo || p.name).toLowerCase();

// Anota el estado de estos proyectos. Con replace, lo que no venga se da por limpio.
// La fecha solo cambia si cambia el estado, para no generar cambios en cada escaneo.
export function saveMachineState(projects, { replace = false } = {}) {
  try {
    const antes = readJson(equipoFile())?.proyectos ?? {};
    const ahora = replace ? {} : { ...antes };
    for (const p of projects) {
      const k = claveDe(p);
      if (!p.ahead && !p.uncommitted) {
        delete ahora[k];
        continue;
      }
      const e = { name: p.name, branch: p.branch, ahead: p.ahead, uncommitted: p.uncommitted, head: p.head };
      const igual = antes[k] && Object.keys(e).every((c) => antes[k][c] === e[c]);
      ahora[k] = { ...e, at: igual ? antes[k].at : new Date().toISOString() };
    }
    if (JSON.stringify(antes) === JSON.stringify(ahora)) return;
    mkdirSync(dataFile("equipos"), { recursive: true });
    writeFileSync(equipoFile(), JSON.stringify({ equipo: equipoActual(), proyectos: ahora }, null, 2) + "\n");
  } catch {
    // es información de apoyo: si no se puede escribir, el hub sigue funcionando
  }
}

export function loadOtherMachines() {
  const dir = dataFile("equipos");
  if (!existsSync(dir)) return [];
  const yo = equipoActual();
  return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => readJson(join(dir, f))).filter((e) => e?.equipo && e.equipo !== yo);
}

// Pura. Trabajo de un proyecto que quedó sin subir en otros equipos. `llego(hash)` dice si ese commit ya está aquí:
// entonces sus commits se subieron después de anotarlo y solo cuentan los cambios sin commit.
export function pendingElsewhere(states, clave, llego = () => false) {
  return states
    .map((s) => ({ equipo: s.equipo, ...s.proyectos?.[clave] }))
    .filter((e) => e.at)
    .map(({ equipo, ahead, uncommitted, head, at }) => ({ equipo, ahead: ahead && llego(head) ? 0 : ahead || 0, uncommitted: uncommitted || 0, at }))
    .filter((e) => e.ahead || e.uncommitted);
}

// ---------- Relevo: lo que estaba a medias cuando se acabó un chat ----------
// Vive en el repo (.projecthub/relevo.md) para que viaje con git, y se borra al cerrar la sesión.

const RELEVO = ".projecthub/relevo.md";

export function readHandoff(dir) {
  const file = join(dir, RELEVO);
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim();
  const m = text.match(/^# Relevo — (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) · equipo (.+?) · rama (\S+)/);
  return { fecha: m?.[1] ?? null, equipo: m?.[2] ?? null, text };
}

export function saveHandoff(project, { haciendo, hecho = [], siguiente, notas } = {}, { ahora = new Date() } = {}) {
  if (!haciendo?.trim() || !siguiente?.trim()) throw new Error("Hacen falta «haciendo» (qué se estaba haciendo) y «siguiente» (el paso inmediato).");
  const dir = project.path;
  const sinCommit = git(dir, "status", "--short").split("\n").filter(Boolean);
  const head = git(dir, "rev-parse", "--short", "HEAD");
  const lista = (items) => items.map((x) => `- ${x}`).join("\n");
  const text = [
    `# Relevo — ${ahora.toLocaleDateString("sv-SE")} ${ahora.toTimeString().slice(0, 5)} · equipo ${equipoActual()} · rama ${project.branch || "?"}${head ? ` @ ${head}` : ""}`,
    `## Haciendo\n${haciendo.trim()}`,
    hecho.length ? `## Hecho\n${lista(hecho)}` : "",
    `## Siguiente\n${siguiente.trim()}`,
    sinCommit.length ? `## Archivos sin commit en ${equipoActual()}\n${lista(sinCommit.slice(0, 30))}${sinCommit.length > 30 ? `\n- … y ${sinCommit.length - 30} más` : ""}` : "",
    notas?.trim() ? `## Notas\n${notas.trim()}` : "",
  ].filter(Boolean).join("\n\n");
  mkdirSync(join(dir, ".projecthub"), { recursive: true });
  writeFileSync(join(dir, RELEVO), text + "\n");
  return { file: RELEVO, sinCommit: sinCommit.length, ahead: project.ahead ?? 0 };
}

export function clearHandoff(project) {
  const file = join(project.path, RELEVO);
  if (!existsSync(file)) return false;
  rmSync(file);
  try {
    rmdirSync(join(project.path, ".projecthub")); // solo si quedó vacía
  } catch {
    // tiene más cosas
  }
  return true;
}

// "https://github.com/Serwii01/geohub.git" -> "geohub"
export const repoSlug = (remote) => remote?.match(/github\.com[/:][^/]+\/([^/]+?)(\.git)?\/?$/i)?.[1] ?? null;

// Datos manuales de un proyecto: por nombre de carpeta o por nombre del repo en GitHub,
// para que coincidan aunque la carpeta se llame distinto en cada equipo
function metaFor(config, folder, slug) {
  const entries = Object.entries(config.projects ?? {});
  const lower = slug?.toLowerCase();
  // 1) el repo coincide con el declarado; 2) la carpeta coincide con el nombre y no declara otro repo
  const hit =
    (lower && entries.find(([, m]) => m.repo?.toLowerCase() === lower)) ||
    entries.find(([name, m]) => name.toLowerCase() === folder.toLowerCase() && (!m.repo || !lower));
  return hit ?? [folder, {}];
}

export const git = (cwd, ...args) => {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024 }).trimEnd();
  } catch {
    return "";
  }
};

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

// ---------- Escaneo ----------

// Detecta tecnologías en la raíz y un nivel por debajo (p. ej. BackEnd/, angular/)
function detectStack(dir) {
  const stack = new Set();
  const dirs = [dir];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (!entry.startsWith(".") && entry !== "node_modules" && statSafe(p)?.isDirectory()) dirs.push(p);
  }
  for (const d of dirs) {
    const pkg = readJson(join(d, "package.json"));
    if (pkg) {
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps["@angular/core"]) stack.add("Angular");
      if (deps.react) stack.add("React");
      if (deps.vue) stack.add("Vue");
      if (deps.astro) stack.add("Astro");
      if (deps.next) stack.add("Next.js");
      if (deps.nuxt) stack.add("Nuxt");
      if (deps.svelte || deps["@sveltejs/kit"]) stack.add("Svelte");
      if (deps.express) stack.add("Express");
      if (deps["drizzle-orm"]) stack.add("Drizzle");
      if (deps.firebase) stack.add("Firebase");
      if (deps.leaflet) stack.add("Leaflet");
      if (deps.three) stack.add("Three.js");
      if (deps.vite) stack.add("Vite");
      if (deps.typescript) stack.add("TypeScript");
      if (deps["@supabase/supabase-js"]) stack.add("Supabase");
      if (deps.tailwindcss) stack.add("Tailwind");
    }
    if (existsSync(join(d, "composer.json"))) {
      const composer = readJson(join(d, "composer.json"));
      stack.add(composer?.require?.["laravel/framework"] ? "Laravel" : "PHP");
    }
    if (existsSync(join(d, "pom.xml"))) {
      const pom = readFileSync(join(d, "pom.xml"), "utf8");
      stack.add(pom.includes("spring-boot") ? "Spring Boot" : "Java/Maven");
    }
    const has = (...names) => names.some((n) => existsSync(join(d, n)));
    if (has("pyproject.toml", "requirements.txt", "setup.py")) {
      const py = ["pyproject.toml", "requirements.txt"].map((n) => (has(n) ? readFileSync(join(d, n), "utf8").toLowerCase() : "")).join("\n");
      stack.add(py.includes("django") ? "Django" : py.includes("fastapi") ? "FastAPI" : py.includes("flask") ? "Flask" : "Python");
    }
    if (has("go.mod")) stack.add("Go");
    if (has("Cargo.toml")) stack.add("Rust");
    if (has("pubspec.yaml")) stack.add("Flutter");
    if (has("Gemfile")) stack.add("Ruby");
    if (has("build.gradle", "build.gradle.kts")) stack.add("Gradle");
    if (has("docker-compose.yml", "compose.yaml", "Dockerfile")) stack.add("Docker");
    if (existsSync(join(d, "vercel.json"))) stack.add("Vercel");
    if (existsSync(join(d, "supabase"))) stack.add("Supabase");
  }
  if (stack.size === 0 && existsSync(join(dir, "index.html"))) stack.add("HTML/JS");
  return [...stack];
}

// Commits con trabajo real posteriores al último commit que tocó STATUS.md, es decir,
// lo que se hizo sin pasar por /cerrar. Si STATUS.md tiene cambios sin commit, se da por recién actualizado.
function unloggedCommits(dir) {
  if (git(dir, "status", "--porcelain", "--", "STATUS.md")) return { since: new Date().toISOString(), commits: [] };
  const [hash, since] = git(dir, "log", "-1", "--format=%H%x00%cI", "--", "STATUS.md").split("\0");
  if (!hash) return { since: null, commits: [] };
  const commits = git(dir, "log", "--no-merges", "--format=%h%x00%cI%x00%s", `${hash}..HEAD`, "--", ...NO_FICHAS)
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [h, at, message] = l.split("\0");
      return { hash: h, at, message };
    });
  return { since, commits };
}

function scanRepo(dir, config, otros = loadOtherMachines()) {
  const remote = git(dir, "remote", "get-url", "origin") || null;
  const relevo = readHandoff(dir);
  const [name, meta] = metaFor(config, basename(dir), repoSlug(remote));
  // Último commit con trabajo real: ignora los que solo tocan CLAUDE.md / STATUS.md
  const [lastDate = "", lastMsg = "", lastAt = ""] = (
    git(dir, "log", "-1", "--format=%cs%x00%s%x00%cI", "--", ...NO_FICHAS) || git(dir, "log", "-1", "--format=%cs%x00%s%x00%cI")
  ).split("\0");
  const dirty = git(dir, "status", "--porcelain").split("\n").filter(Boolean).length;
  // Sin upstream configurado, compara con origin/<rama> si existe
  const branch = git(dir, "branch", "--show-current");
  const base = git(dir, "rev-parse", "--abbrev-ref", "@{upstream}") || (git(dir, "rev-parse", "--verify", "--quiet", `origin/${branch}`) && `origin/${branch}`);
  const upstream = base ? git(dir, "rev-list", "--left-right", "--count", `${base}...HEAD`).split(/\s+/) : [];
  // Días naturales en hora local (la fecha del commit, sin hora, se leería como UTC y podría dar -1)
  const daysAgo = lastDate ? Math.max(0, Math.floor((Date.now() - new Date(`${lastDate}T00:00:00`)) / 86400000)) : null;
  const status = readStatus(dir);
  const unlogged = status ? unloggedCommits(dir) : { since: null, commits: [] };
  const contextFile = contextFileOf(dir);
  const contextMd = contextFile ? readText(join(dir, contextFile)) : null;
  const project = {
    name,
    path: toPosix(dir),
    remote,
    repo: repoSlug(remote),
    branch,
    branches: git(dir, "branch", "--format=%(refname:short)").split("\n").filter(Boolean),
    lastCommit: { date: lastDate, message: lastMsg, daysAgo, at: lastAt },
    // Ficha desactualizada: commits con trabajo hechos después de la última vez que se guardó STATUS.md
    statusUpdatedAt: unlogged.since,
    statusStale: unlogged.commits.length > 0,
    unloggedCount: unlogged.commits.length,
    unloggedCommits: unlogged.commits.slice(0, 40),
    uncommitted: dirty,
    ahead: Number(upstream[1] || 0),
    behind: Number(upstream[0] || 0),
    upstream: base || null,
    defaultBranch: git(dir, "symbolic-ref", "--short", "refs/remotes/origin/HEAD").replace(/^origin\//, "") || null,
    stack: detectStack(dir),
    contextFile,
    hasContextFile: contextFile !== null,
    hasStatusMd: status !== null,
    estadoActual: status?.estado ?? "",
    nextSteps: status?.steps.filter((s) => !s.done).map((s) => s.text) ?? [],
    ...meta,
    // Repos que son fuente de este proyecto (p. ej. los diseños de drogedex)
    fuentes: Object.entries(config.projects ?? {}).filter(([, m]) => m.fuenteDe === name).map(([n]) => n),
    head: git(dir, "rev-parse", "HEAD") || null,
    // Trabajo a medias que dejó un chat anterior (el texto se lee aparte, con readHandoff)
    relevo: relevo && { fecha: relevo.fecha, equipo: relevo.equipo },
  };
  // Trabajo de este proyecto que quedó sin subir en otro equipo del usuario
  project.otrosEquipos = pendingElsewhere(otros, claveDe(project), (hash) => Boolean(hash) && git(dir, "cat-file", "-t", hash) === "commit");
  project.calidad = [...(status ? lintStatus(status) : []), ...(contextMd !== null ? lintContext(contextMd, contextFile) : [])];
  project.avisos = computeAvisos(project);
  project.siguienteAccion = siguienteAccion(project);
  return project;
}

// Índice ligero de repos (sin leer su estado): nombre, carpeta y repo de GitHub
function repoIndex() {
  const config = loadConfig();
  const seen = new Set();
  const index = [];
  for (const root of loadLocal().roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const dir = join(root, entry);
      if (entry.startsWith(".") || config.exclude?.includes(entry) || seen.has(dir) || !existsSync(join(dir, ".git"))) continue;
      seen.add(dir);
      const repo = repoSlug(git(dir, "remote", "get-url", "origin"));
      index.push({ name: metaFor(config, entry, repo)[0], dir, repo });
    }
  }
  return index;
}

export function scanProjects({ write = true } = {}) {
  const config = loadConfig();
  const otros = loadOtherMachines();
  const projects = repoIndex().map((r) => scanRepo(r.dir, config, otros));
  projects.sort((a, b) => (b.lastCommit.date || "").localeCompare(a.lastCommit.date || ""));
  const registry = { generatedAt: new Date().toISOString(), projects };
  if (write) {
    saveMachineState(projects, { replace: true });
    writeFileSync(dataFile("projects.json"), JSON.stringify(registry, null, 2) + "\n");
    writeFileSync(dataFile("PROJECTS.md"), renderMarkdown(projects));
  }
  return registry;
}

export function renderMarkdown(projects) {
  const rows = projects.map((p) => {
    const flags = [p.uncommitted && `${p.uncommitted} sin commit`, p.ahead && `${p.ahead} sin push`, p.behind && `${p.behind} por bajar`].filter(Boolean).join(", ");
    const age = p.lastCommit.daysAgo === null ? "—" : p.lastCommit.daysAgo === 0 ? "hoy" : `hace ${p.lastCommit.daysAgo} d`;
    return `| **${p.name}** | ${p.prioridad ?? "—"} | ${p.stack.join(", ")} | ${age} — ${p.lastCommit.message} | ${p.branch} | ${flags || "limpio"} | ${p.nextSteps[0] ?? (p.hasStatusMd ? "—" : "_sin STATUS.md_")} |`;
  });
  return `# Mis proyectos

_Generado por \`scan.mjs\` el ${new Date().toLocaleString("es-ES")}_

| Proyecto | Prioridad | Stack | Último commit | Rama | Git | Siguiente paso |
|---|---|---|---|---|---|---|
${rows.join("\n")}
`;
}

// Resuelve un nombre: exacto (también por repo de GitHub), luego prefijo y luego subcadena.
// Si varios encajan por igual no elige: pide concretar.
export function resolveName(list, name) {
  const q = String(name).toLowerCase();
  const low = (s) => (s ?? "").toLowerCase();
  const exact = list.find((p) => low(p.name) === q) ?? list.find((p) => low(p.repo) === q);
  if (exact) return exact;
  for (const test of [(p) => low(p.name).startsWith(q), (p) => low(p.name).includes(q)]) {
    const hits = list.filter(test);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) throw new Error(`"${name}" es ambiguo: ${hits.map((p) => p.name).join(", ")}. Pregunta al usuario cuál quiere.`);
  }
  throw new Error(`No hay ningún proyecto llamado "${name}" en este equipo. Proyectos: ${list.map((p) => p.name).join(", ")}. Si existe en GitHub, usa clone_project.`);
}

export function findProject(name) {
  return scanRepo(resolveName(repoIndex(), name).dir, loadConfig());
}

// Proyecto registrado que contiene una carpeta (lo usan los hooks). Null si no es uno de los del hub.
export function projectAt(dir) {
  const top = git(dir, "rev-parse", "--show-toplevel");
  if (!top) return null;
  const hit = repoIndex().find((r) => toPosix(resolve(r.dir)).toLowerCase() === toPosix(resolve(top)).toLowerCase());
  return hit ? scanRepo(hit.dir, loadConfig()) : null;
}

// Comprobación barata para el hook de fin de turno: solo commits sin anotar
export function unloggedAt(dir) {
  const top = git(dir, "rev-parse", "--show-toplevel");
  if (!top || !existsSync(join(top, "STATUS.md"))) return null;
  const inRoot = loadLocal().roots.some((r) => toPosix(resolve(r)).toLowerCase() === toPosix(dirname(resolve(top))).toLowerCase());
  return inRoot ? { name: basename(top), commits: unloggedCommits(top).commits } : null;
}

// ---------- Avisos: qué debe hacer Claude según el estado del proyecto ----------

// Calidad de STATUS.md. Pura: recibe lo que devuelve readStatus.
export function lintStatus(status) {
  const out = [];
  const pending = status.steps.filter((s) => !s.done);
  if (!status.estado) out.push("«Estado actual» está vacío.");
  if (!pending.length) out.push("No hay siguientes pasos pendientes.");
  for (const s of pending) {
    if (s.text.replace(/[`*]/g, "").trim().split(/\s+/).length < 3) out.push(`Paso demasiado vago: «${s.text}».`);
  }
  if (/AAAA-MM-DD/.test(status.text)) out.push("Sigue la entrada de ejemplo de la plantilla en «Última sesión».");
  // La ficha se relee en cada sesión: lo que pese aquí se paga siempre
  const tokens = Math.ceil(status.text.length / 4);
  if (tokens > STATUS_BUDGET) out.push(`STATUS.md ocupa unos ${tokens} tokens (lo razonable son ${STATUS_BUDGET}): resume las sesiones en viñetas cortas; el detalle ya está en git.`);
  else if (status.text.split("\n").some((l) => /^\s*[-*]\s/.test(l) && l.length > 500)) out.push("Hay viñetas de más de 500 caracteres en STATUS.md: una línea o dos por viñeta bastan.");
  return out;
}

export function lintContext(text, file = "El archivo de contexto") {
  return /comando|command|npm run|```/i.test(text) ? [] : [`${file} no explica cómo arrancar o compilar el proyecto.`];
}

export const STATUS_BUDGET = 1500; // tokens aproximados
const NIVEL = { alto: 0, medio: 1, info: 2 };
const commits = (n) => `${n} ${n === 1 ? "commit" : "commits"}`;
const archivos = (n) => `${n} ${n === 1 ? "archivo" : "archivos"}`;

// Avisos ordenados por urgencia. Pura: solo mira los campos de scanRepo; `accion` es la instrucción para Claude.
export function computeAvisos(p) {
  const a = [];
  const add = (nivel, codigo, mensaje, accion) => a.push({ nivel, codigo, mensaje, accion });
  const upstreamBranch = p.upstream?.replace(/^origin\//, "");

  if (p.behind && p.ahead) {
    add("alto", "ramas_divergidas", `${commits(p.behind)} en GitHub y ${p.ahead} aquí sin subir.`,
      "Revisa qué archivos tocan ambos lados (git log y git diff). Propón git pull --no-rebase; nunca hagas force push.");
  } else if (p.behind) {
    add("alto", "commits_por_bajar", `${commits(p.behind)} por bajar: hay trabajo de otro equipo.`,
      p.uncommitted
        ? "Hay cambios locales sin commit: pregunta al usuario cómo seguir antes de hacer git pull."
        : "Propón git pull antes de nada. El STATUS.md bueno es el que llega con el pull.");
  }
  for (const e of p.otrosEquipos ?? []) {
    const que = [e.ahead && `${commits(e.ahead)} sin subir`, e.uncommitted && `${archivos(e.uncommitted)} sin commit`].filter(Boolean).join(" y ");
    add("alto", "sin_subir_en_otro_equipo", `En el equipo ${e.equipo} quedó trabajo que no está aquí: ${que} (visto el ${e.at.slice(0, 10)}).`,
      "Dilo antes de trabajar: lo que se haga aquí puede chocar con ello. Lo mejor es subirlo desde aquel equipo primero; si el usuario decide seguir, que sea en otros archivos.");
  }
  if (p.relevo) {
    add("alto", "relevo_pendiente", `Hay un relevo${p.relevo.fecha ? ` del ${p.relevo.fecha}` : ""}${p.relevo.equipo ? ` (equipo ${p.relevo.equipo})` : ""}: un chat anterior dejó trabajo a medias.`,
      "Continúa desde el relevo: es más reciente que «Última sesión». Si cita archivos sin commit que aquí no están, se quedaron en el otro equipo: dilo. Al cerrar la sesión con update_status se borra solo.");
  }
  if (p.statusStale) {
    add("medio", "ficha_desactualizada", `STATUS.md no recoge ${commits(p.unloggedCount)} posterior${p.unloggedCount === 1 ? "" : "es"}.`,
      "No des «Última sesión» por lo último hecho. Resume esos commits y ofrece anotarlos con update_status, con la fecha real de cada día.");
  }
  if (!p.hasStatusMd) add("medio", "sin_status", "No tiene STATUS.md.", "Ofrece crearlo analizando el repo.");
  if (!p.hasContextFile) add("medio", "sin_contexto", "No tiene archivo de contexto (AGENTS.md o CLAUDE.md).", "Ofrece crearlo analizando el repo, con el nombre que lea la IA que se está usando.");
  if (p.uncommitted) add("medio", "cambios_sin_commit", `${archivos(p.uncommitted)} sin commit.`, "Dilo al usuario y pregúntale antes de hacer commit.");
  if (p.ahead && !p.behind) add("medio", "commits_sin_subir", `${commits(p.ahead)} sin subir.`, "Recuérdalo al cerrar: sin push, el otro equipo no los ve. Pregunta antes de hacer push.");
  if (upstreamBranch && p.branch && upstreamBranch !== p.branch) {
    add("info", "rama_con_otro_nombre", `La rama ${p.branch} sigue a ${p.upstream}.`, `git push a secas falla: usa git push origin HEAD:${upstreamBranch}, y solo con confirmación.`);
  } else if (p.defaultBranch && p.branch && p.branch !== p.defaultBranch) {
    add("info", "rama_secundaria", `Estás en ${p.branch}, no en ${p.defaultBranch}.`, "Tenlo presente al publicar: lo que se despliega suele salir de la rama principal.");
  }
  if (p.fuenteDe) {
    add("info", "fuente_de_otro", `Este repo es una fuente de ${p.fuenteDe}.`, `Los cambios no llegan solos a ${p.fuenteDe}: hay que reimportarlos allí. Avísalo tras subirlos.`);
  }
  if (p.fuentes?.length) add("info", "tiene_fuentes", `Partes de este proyecto vienen de: ${p.fuentes.join(", ")}.`, "Los cambios de esas partes se hacen en su repo, no aquí.");
  if (p.noEditar?.length) add("info", "no_editar", `No editar a mano: ${p.noEditar.join(", ")}.`, "Son archivos generados y se pierden al regenerarlos. Nunca los edites; cambia su origen.");
  for (const r of p.reglas ?? []) add("info", "regla", r, r);
  if (!p.prioridad) add("info", "sin_prioridad", "No tiene prioridad en el hub.", "Si el usuario la indica, guárdala con set_project_info.");
  if (p.prioridad !== "archivado" && (p.lastCommit?.daysAgo ?? 0) > 30) add("info", "inactivo", `${p.lastCommit.daysAgo} días sin tocar.`, "Pregunta si sigue activo o se archiva.");
  for (const c of p.calidad ?? []) add("info", "calidad_ficha", c, "Corrígelo con update_status al cerrar la sesión.");
  return a.sort((x, y) => NIVEL[x.nivel] - NIVEL[y.nivel]);
}

export function siguienteAccion(p) {
  const urgente = p.avisos?.find((x) => x.nivel !== "info");
  if (urgente) return urgente.accion;
  return p.nextSteps?.length ? `Seguir con: ${p.nextSteps[0]}` : "No hay siguiente paso definido: pregunta al usuario qué quiere hacer.";
}

// ---------- Acceso seguro a archivos ----------

const BLOCKED = [/(^|\/)\.env(\.|$)(?!example)/i, /(^|\/)node_modules\//, /(^|\/)\.git\//, /(^|\/)vendor\//, /\.(pem|key|p12|pfx|jks)$/i];

export function safePath(project, rel = "") {
  const root = resolve(project.path);
  const full = resolve(root, rel);
  if (full !== root && !full.startsWith(root + sep)) throw new Error("Ruta fuera del proyecto.");
  const relPosix = relative(root, full).replace(/\\/g, "/");
  if (BLOCKED.some((re) => re.test(relPosix + (statSafe(full)?.isDirectory() ? "/" : "")))) {
    throw new Error(`Acceso bloqueado por seguridad: ${relPosix}`);
  }
  return full;
}

const statSafe = (p) => {
  try {
    return statSync(p);
  } catch {
    return null;
  }
};

// Lista archivos versionados o no ignorados (respeta .gitignore)
export function listFiles(project, sub = "", limit = 400) {
  const dir = safePath(project, sub);
  const out = git(project.path, "ls-files", "--cached", "--others", "--exclude-standard", "--", relative(project.path, dir) || ".");
  const files = out.split("\n").filter(Boolean).filter((f) => !BLOCKED.some((re) => re.test(f)));
  return { total: files.length, files: files.slice(0, limit), truncated: files.length > limit };
}

// Lee un archivo entero o solo un rango de líneas (desde/hasta, empezando en 1). Sin rango, corta a maxBytes
// y dice cómo pedir el resto, para no gastar contexto en archivos grandes.
export function readProjectFile(project, rel, { maxBytes = 60_000, desde, hasta } = {}) {
  const full = safePath(project, rel);
  const st = statSafe(full);
  if (!st) throw new Error(`No existe: ${rel}`);
  if (st.isDirectory()) throw new Error(`${rel} es una carpeta; usa list_project_files.`);
  const buf = readFileSync(full);
  if (buf.subarray(0, 8000).includes(0)) throw new Error(`${rel} parece binario.`);
  if (desde || hasta) {
    const lines = buf.toString("utf8").split(/\r?\n/);
    const a = Math.max(1, desde ?? 1);
    const b = Math.min(lines.length, hasta ?? a + 399);
    if (a > lines.length) throw new Error(`${rel} solo tiene ${lines.length} líneas.`);
    return `[${rel}: líneas ${a}–${b} de ${lines.length}]\n${lines.slice(a - 1, b).join("\n")}`;
  }
  if (st.size <= maxBytes) return buf.toString("utf8");
  const text = buf.subarray(0, maxBytes).toString("utf8");
  const vistas = text.split("\n").length - 1;
  return `${text.slice(0, text.lastIndexOf("\n"))}\n\n[… cortado en la línea ${vistas}: el archivo ocupa ${st.size} bytes. Pide el resto con desde=${vistas + 1}, o busca con search_projects.]`;
}

// Por proyecto se devuelven pocas coincidencias (más si se busca en uno solo); `total` dice cuántas hay
export function searchProjects(query, { project, regex = false, max } = {}) {
  const targets = project ? [findProject(project)] : scanProjects({ write: false }).projects;
  const maxPerProject = max ?? (project ? 25 : 8);
  const results = [];
  for (const p of targets) {
    const out = git(p.path, "grep", "-n", "-I", "--untracked", regex ? "-E" : "-F", "-i", "-e", query, "--", ".", ":!*lock*", ":!*.min.*", ":!dist", ":!*.map");
    const lines = out.split("\n").filter(Boolean).filter((l) => !BLOCKED.some((re) => re.test(l.split(":")[0])));
    if (lines.length) results.push({ project: p.name, total: lines.length, matches: lines.slice(0, maxPerProject).map((l) => (l.length > 200 ? `${l.slice(0, 200)}…` : l)) });
  }
  return results;
}

// ---------- Git ----------

// git fetch en paralelo para saber si hay commits nuevos subidos desde otro equipo
export async function fetchProjects(projects = repoIndex().map((r) => ({ name: r.name, path: r.dir, remote: r.repo })), { timeout = 30_000 } = {}) {
  const { execFile } = await import("node:child_process");
  const run = (p) =>
    new Promise((ok) =>
      execFile("git", ["-C", p.path, "fetch", "--quiet", "--prune"], { timeout }, (err) => ok({ project: p.name, ok: !err })),
    );
  return Promise.all(projects.filter((p) => p.remote).map(run));
}

export function gitSummary(project, { diff = false } = {}) {
  const dir = project.path;
  const summary = {
    branch: project.branch,
    ahead: project.ahead,
    behind: project.behind,
    status: git(dir, "status", "--short"),
    branches: git(dir, "branch", "-vv"),
    log: git(dir, "log", "-15", "--format=%h %cs %s"),
  };
  if (diff) summary.diff = git(dir, "diff", "--stat") + "\n\n" + git(dir, "diff").slice(0, 30_000);
  return summary;
}

export function todos(project, limit = 20) {
  return git(project.path, "grep", "-n", "-I", "-E", "\\b(TODO|FIXME|HACK)\\b", "--", ".", ":!*lock*", ":!*.min.*", ":!dist")
    .split("\n")
    .filter(Boolean)
    .slice(0, limit);
}

// ---------- STATUS.md ----------

// Git en Windows (autocrlf) deja los archivos con CRLF: se normaliza a LF para que los regex por línea funcionen
const readText = (file) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const STATUS_TEMPLATE = (idioma = "es") => readText(join(HUB, "templates", idioma === "en" ? "STATUS.en.md" : "STATUS.md"));

function splitSections(text) {
  // [{ title, body }] — el primer elemento (title null) es la cabecera antes del primer "## "
  const parts = text.split(/^## /m);
  return [{ title: null, body: parts[0] }, ...parts.slice(1).map((p) => {
    const nl = p.indexOf("\n");
    return { title: p.slice(0, nl === -1 ? undefined : nl).trim(), body: nl === -1 ? "" : p.slice(nl + 1) };
  })];
}

const joinSections = (sections) => sections.map((s) => (s.title === null ? s.body : `## ${s.title}\n${s.body}`)).join("");
// Los apartados de STATUS.md se reconocen en español y en inglés; internamente se nombran en español
const SECCIONES = {
  "Estado actual": "Current status",
  "Siguientes pasos": "Next steps",
  "Última sesión": "Last session",
  "Decisiones": "Decisions",
  "Problemas conocidos": "Known issues",
};
const findSection = (sections, name) => {
  const nombres = [name, SECCIONES[name]].filter(Boolean).map((n) => n.toLowerCase());
  return sections.find((s) => nombres.some((n) => s.title?.toLowerCase().startsWith(n)));
};
// Una ficha está en inglés si usa alguno de los títulos ingleses
const enIngles = (sections) => sections.some((s) => Object.values(SECCIONES).some((n) => s.title?.toLowerCase().startsWith(n.toLowerCase())));

export function readStatus(dir) {
  const file = join(dir, "STATUS.md");
  if (!existsSync(file)) return null;
  const text = readText(file);
  const sections = splitSections(text);
  const estado = (findSection(sections, "Estado actual")?.body ?? "").replace(/<!--[\s\S]*?-->/g, "").trim();
  const steps = (findSection(sections, "Siguientes pasos")?.body ?? "")
    .split("\n")
    .map((l) => l.match(/^\s*[-*]\s*(?:\[( |x|X)\]\s*)?(.*)$/))
    .filter((m) => m && m[2].trim())
    .map((m) => ({ done: m[1]?.toLowerCase() === "x", text: m[2].trim() }));
  return { text, estado, steps };
}

// Aplica cambios a STATUS.md: estado, sesión nueva, pasos completados/nuevos
// `idioma` ("es" o "en") solo cuenta al crear la ficha: una que ya existe conserva el idioma de sus títulos.
export function updateStatus(project, { estado, sesion, fecha, completados = [], nuevosPasos = [], decisiones = [], problemas = [], idioma = "es" }) {
  if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error(`Fecha no válida: ${fecha}. Usa AAAA-MM-DD.`);
  if (!estado && !sesion?.length && !completados.length && !nuevosPasos.length && !decisiones.length && !problemas.length) {
    throw new Error("No hay nada que actualizar.");
  }
  const cambios = { pasosQuitados: [], pasosAnadidos: [], noEncontrados: [], ambiguos: [], sesionesDescartadas: 0 };
  const file = join(project.path, "STATUS.md");
  const sections = splitSections(existsSync(file) ? readText(file) : STATUS_TEMPLATE(idioma));
  const ingles = enIngles(sections);
  const ensure = (name) => {
    let s = findSection(sections, name);
    if (!s) sections.push((s = { title: ingles ? SECCIONES[name] : name, body: "\n" }));
    return s;
  };

  if (estado) ensure("Estado actual").body = `${estado.trim()}\n\n`;

  const pasos = ensure("Siguientes pasos");
  if (completados.length || nuevosPasos.length) {
    let lines = pasos.body.split("\n").filter((l) => l.trim() && !/^\s*[-*]\s*(\[ \]\s*)?$/.test(l));
    // Lo completado se quita: el histórico ya queda en "Última sesión" y en git.
    // Un fragmento debe señalar un único paso: si no, no se toca nada y se informa.
    for (const c of completados) {
      const hits = lines.filter((l) => /^\s*[-*]\s/.test(l) && l.toLowerCase().includes(c.toLowerCase()));
      if (hits.length === 1) {
        lines = lines.filter((l) => l !== hits[0]);
        cambios.pasosQuitados.push(hits[0].replace(/^\s*[-*]\s*(\[[ xX]\]\s*)?/, ""));
      } else (hits.length ? cambios.ambiguos : cambios.noEncontrados).push(c);
    }
    for (const p of nuevosPasos) {
      if (lines.some((l) => l.toLowerCase().includes(p.toLowerCase()))) continue;
      lines.push(`- [ ] ${p}`);
      cambios.pasosAnadidos.push(p);
    }
    pasos.body = lines.join("\n") + "\n\n";
  }

  if (sesion?.length) {
    const s = ensure("Última sesión");
    // Fecha local (no UTC) salvo que se indique otra, p. ej. al anotar commits de un día anterior
    const day = fecha ?? new Date().toLocaleDateString("sv-SE");
    const entries = s.body.split(/^(?=### )/m).filter((e) => e.startsWith("### ") && !/AAAA-MM-DD/.test(e));
    // Si ya hay una entrada de ese día, se añaden las viñetas a ella en vez de duplicarla
    const i = entries.findIndex((e) => e.startsWith(`### ${day}\n`) || e.startsWith(`### ${day} `));
    const bullets = sesion.map((x) => `- ${x}`).join("\n");
    if (i !== -1) entries[i] = `${entries[i].trimEnd()}\n${bullets}\n\n`;
    else entries.push(`### ${day}\n${bullets}\n\n`);
    // Más reciente primero (las cabeceras empiezan por la fecha AAAA-MM-DD)
    entries.sort((a, b) => b.slice(4, 14).localeCompare(a.slice(4, 14)));
    // Solo quedan las 5 últimas: las anteriores pasan a HISTORY.md, que no se relee en cada sesión
    const viejas = entries.slice(5);
    cambios.sesionesDescartadas = viejas.length;
    if (viejas.length) {
      const hist = join(project.path, "HISTORY.md");
      const previo = existsSync(hist) ? readText(hist).replace(/^# .*\n+(?:>.*\n+)?/, "") : "";
      writeFileSync(hist, `# Historial de sesiones\n\n> Sesiones antiguas de STATUS.md, de más reciente a más antigua. No hace falta leerlo al retomar.\n\n${viejas.map((e) => e.trimEnd() + "\n\n").join("")}${previo}`.trimEnd() + "\n");
      cambios.historial = "HISTORY.md";
    }
    s.body = "\n" + entries.slice(0, 5).map((e) => e.trimEnd() + "\n\n").join("");
    // Cerrar la sesión deja sin sentido el relevo: lo que había a medias ya está anotado
    if (clearHandoff(project)) cambios.relevoBorrado = true;
  }

  const append = (name, items) => {
    if (!items.length) return;
    const s = ensure(name);
    s.body = s.body.replace(/<!--[\s\S]*?-->\n?/g, "").trimEnd() + "\n" + items.map((x) => `- ${x}`).join("\n") + "\n\n";
  };
  append("Decisiones", decisiones);
  append("Problemas conocidos", problemas);

  writeFileSync(file, joinSections(sections).trimEnd() + "\n");
  return { ...readStatus(project.path), cambios };
}

// Marca o desmarca un paso concreto (lo usa el dashboard)
export function toggleStep(project, text, done) {
  const file = join(project.path, "STATUS.md");
  const lines = readText(file).split("\n");
  const i = lines.findIndex((l) => /^\s*[-*]\s*\[( |x|X)\]/.test(l) && l.includes(text));
  if (i === -1) throw new Error("Paso no encontrado.");
  lines[i] = lines[i].replace(/\[( |x|X)\]/, done ? "[x]" : "[ ]");
  writeFileSync(file, lines.join("\n"));
  return readStatus(project.path);
}

export function addStep(project, text) {
  return updateStatus(project, { nuevosPasos: [text] });
}

// ---------- GitHub: repos que existen en la cuenta pero no están clonados en este equipo ----------

export async function githubRepos({ force = false } = {}) {
  const config = loadConfig();
  const user = config.github?.user;
  if (!user) return [];
  const cacheFile = dataFile("cache", "github.json");
  if (!force && existsSync(cacheFile)) {
    const cache = JSON.parse(readFileSync(cacheFile, "utf8"));
    if (cache.user === user && Date.now() - cache.at < 15 * 60_000) return cache.repos;
  }
  const { githubToken } = loadLocal();
  // Con token se ven también los privados (/user/repos); sin token, solo los públicos
  const url = githubToken
    ? "https://api.github.com/user/repos?per_page=100&sort=pushed&affiliation=owner"
    : `https://api.github.com/users/${encodeURIComponent(user)}/repos?per_page=100&sort=pushed`;
  const res = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "project-hub", ...(githubToken && { Authorization: `Bearer ${githubToken}` }) },
  });
  if (!res.ok) throw new Error(`GitHub respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const repos = (await res.json()).map((r) => ({
    repo: r.name,
    description: r.description ?? "",
    url: r.html_url,
    cloneUrl: r.clone_url,
    private: r.private,
    fork: r.fork,
    archived: r.archived,
    language: r.language,
    pushedAt: r.pushed_at,
  }));
  mkdirSync(dirname(cacheFile), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify({ user, at: Date.now(), repos }, null, 2));
  return repos;
}

export async function remoteOnlyProjects({ force = false } = {}) {
  const config = loadConfig();
  const ignore = new Set((config.github?.ignore ?? []).map((x) => x.toLowerCase()));
  const cloned = new Set(repoIndex().map((p) => p.repo?.toLowerCase()).filter(Boolean));
  return (await githubRepos({ force }))
    .filter((r) => !cloned.has(r.repo.toLowerCase()) && !ignore.has(r.repo.toLowerCase()) && !(r.fork && config.github?.hideForks !== false))
    .map((r) => {
      const [name, meta] = metaFor(config, r.repo, r.repo);
      return { name, ...r, ...meta };
    });
}

// Oculta un repo de GitHub de la lista de "no clonados" (en todos los equipos)
export function hideRepo(repoName) {
  const config = loadConfig();
  config.github ??= {};
  config.github.ignore = [...new Set([...(config.github.ignore ?? []), repoName])];
  saveConfig(config);
  return config.github.ignore;
}

// Clona un repo de la cuenta en la carpeta de clonado de este equipo
export async function cloneProject(repoName) {
  const repos = await githubRepos();
  const repo = repos.find((r) => r.repo.toLowerCase() === String(repoName).toLowerCase())
    ?? repos.find((r) => metaFor(loadConfig(), r.repo, r.repo)[0].toLowerCase() === String(repoName).toLowerCase());
  if (!repo) throw new Error(`"${repoName}" no está en tu cuenta de GitHub.`);
  const { cloneDir } = loadLocal();
  const target = join(cloneDir, repo.repo);
  if (existsSync(target)) throw new Error(`Ya existe la carpeta ${toPosix(target)}.`);
  mkdirSync(cloneDir, { recursive: true });
  try {
    execFileSync("git", ["clone", repo.cloneUrl, target], { stdio: ["ignore", "pipe", "pipe"], timeout: 10 * 60_000 });
  } catch (e) {
    throw new Error(`No se pudo clonar: ${e.stderr?.toString().trim() || e.message}`);
  }
  scanProjects();
  return findProject(repo.repo);
}

export function getContext(project) {
  const read = (f) => (existsSync(join(project.path, f)) ? readText(join(project.path, f)) : null);
  const { avisos, siguienteAccion, ...datos } = project;
  return {
    // Lo primero: qué hacer ahora y qué tener en cuenta
    siguienteAccion,
    avisos,
    relevo: readHandoff(project.path)?.text ?? null,
    project: datos,
    // Archivo de contexto del proyecto (AGENTS.md, CLAUDE.md…): cómo está hecho
    contextFile: project.contextFile,
    contextMd: project.contextFile ? read(project.contextFile) : null,
    statusMd: read("STATUS.md"),
    git: gitSummary(project),
    todos: todos(project),
  };
}

// ---------- Informe: qué se ha hecho en los últimos días ----------

// Entradas de «Última sesión» de un STATUS.md. Pura: [{ fecha, puntos }]
const vinetas = (body) => body.split("\n").map((l) => l.match(/^\s*[-*]\s+(?:\[[ xX]\]\s*)?(.*\S)/)?.[1]).filter(Boolean);
const sesionesDe = (body) =>
  body
    .split(/^(?=### )/m)
    .map((e) => {
      const fecha = e.match(/^### (\d{4}-\d{2}-\d{2})/)?.[1];
      const puntos = vinetas(e.split("\n").slice(1).join("\n"));
      return fecha && puntos.length ? { fecha, puntos } : null;
    })
    .filter(Boolean);

export function parseSessions(text) {
  return sesionesDe(findSection(splitSections(text.replace(/\r\n/g, "\n")), "Última sesión")?.body ?? "");
}

// ---------- Memoria: decisiones, problemas y sesiones de todos los proyectos ----------

const norm = (s) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// Lo anotado en las fichas de un proyecto, como notas sueltas. Pura: recibe los textos.
export function notesOf(statusText = "", historyText = "") {
  const sections = splitSections(statusText.replace(/\r\n/g, "\n"));
  const de = (name) => findSection(sections, name)?.body.replace(/<!--[\s\S]*?-->/g, "") ?? "";
  const estado = de("Estado actual").trim();
  return [
    ...vinetas(de("Decisiones")).map((t) => ({ tipo: "Decisión", texto: t })),
    ...vinetas(de("Problemas conocidos")).map((t) => ({ tipo: "Problema", texto: t })),
    ...(estado ? [{ tipo: "Estado", texto: estado.replace(/\s+/g, " ") }] : []),
    ...[...sesionesDe(de("Última sesión")), ...sesionesDe(historyText.replace(/\r\n/g, "\n"))].flatMap((s) => s.puntos.map((t) => ({ tipo: `Sesión ${s.fecha}`, texto: t }))),
  ];
}

// Busca en lo que ya está escrito sobre los proyectos (decisiones, problemas, sesiones), sin leer código.
// Encaja la nota que contiene todas las palabras, sin distinguir mayúsculas ni acentos.
export function searchNotes(query, { project, max = 5, projects } = {}) {
  const palabras = norm(query).split(/\s+/).filter((w) => w.length > 1);
  if (!palabras.length) throw new Error("Indica al menos una palabra de dos letras o más.");
  const targets = projects ?? (project ? [findProject(project)] : scanProjects({ write: false }).projects);
  const leer = (p, f) => (existsSync(join(p.path, f)) ? readText(join(p.path, f)) : "");
  const results = [];
  for (const p of targets) {
    const hits = notesOf(leer(p, "STATUS.md"), leer(p, "HISTORY.md")).filter((n) => palabras.every((w) => norm(n.texto).includes(w)));
    if (hits.length) results.push({ project: p.name, total: hits.length, notas: hits.slice(0, project ? max * 3 : max).map((n) => `${n.tipo}: ${n.texto.length > 320 ? `${n.texto.slice(0, 320)}…` : n.texto}`) });
  }
  return results;
}

// ---------- Sincronizar todo: bajar y subir lo que se pueda sin riesgo ----------

// Qué se haría en cada proyecto. Pura. Solo avance rápido: lo que necesite una decisión se deja y se dice por qué.
export function syncPlan(projects) {
  const acciones = [];
  const omitidos = [];
  for (const p of projects) {
    if (!p.behind && !p.ahead) continue;
    const otraRama = p.upstream && p.branch && p.upstream.replace(/^origin\//, "") !== p.branch;
    if (p.behind && p.ahead) omitidos.push({ name: p.name, motivo: `ramas divergidas (${p.behind} por bajar y ${p.ahead} sin subir)` });
    else if (p.behind && p.uncommitted) omitidos.push({ name: p.name, motivo: `${p.behind} por bajar, pero hay ${p.uncommitted} archivos sin commit` });
    else if (p.behind) acciones.push({ name: p.name, path: p.path, accion: "pull", n: p.behind });
    else if (otraRama) omitidos.push({ name: p.name, motivo: `la rama ${p.branch} sigue a ${p.upstream}` });
    else acciones.push({ name: p.name, path: p.path, accion: "push", n: p.ahead });
  }
  return { acciones, omitidos };
}

export async function runSyncPlan(acciones, { timeout = 60_000 } = {}) {
  const { execFile } = await import("node:child_process");
  const run = (a) =>
    new Promise((ok) =>
      execFile("git", ["-C", a.path, ...(a.accion === "pull" ? ["pull", "--ff-only", "--quiet"] : ["push", "--quiet"])], { timeout }, (err, _out, errOut) =>
        ok({ name: a.name, accion: a.accion, n: a.n, ok: !err, ...(err && { error: String(errOut || err.message).trim().split("\n").slice(-2).join(" ").slice(0, 200) }) }),
      ),
    );
  return Promise.all(acciones.map(run));
}

// Sesiones anotadas y commits sin anotar de todos los proyectos desde hace `dias` días
export function workReport({ dias = 7, projects = scanProjects({ write: false }).projects, hoy = new Date() } = {}) {
  const desde = new Date(hoy.getTime() - dias * 86400000).toLocaleDateString("sv-SE");
  const proyectos = [];
  for (const p of projects) {
    const status = existsSync(join(p.path, "STATUS.md")) ? readText(join(p.path, "STATUS.md")) : "";
    const sesiones = parseSessions(status).filter((s) => s.fecha >= desde);
    const sinAnotar = (p.unloggedCommits ?? []).filter((c) => c.at.slice(0, 10) >= desde).map((c) => `${c.at.slice(0, 10)} ${c.message}`);
    if (sesiones.length || sinAnotar.length) proyectos.push({ project: p.name, sesiones, ...(sinAnotar.length && { commitsSinAnotar: sinAnotar }) });
  }
  const dias_ = new Set(proyectos.flatMap((p) => p.sesiones.map((s) => s.fecha)));
  return { desde, hasta: hoy.toLocaleDateString("sv-SE"), diasConSesion: dias_.size, proyectos };
}
