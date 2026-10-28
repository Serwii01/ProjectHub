// Núcleo del hub: escaneo de repos, acceso seguro a archivos y manejo de STATUS.md.
// Lo usan scan.mjs (CLI), mcp-server.mjs (Claude) y dashboard.mjs (web).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { join, basename, dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

export const HUB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// hub.config.json: común a todos los equipos (se sube a git): proyectos, exclusiones, usuario de GitHub.
// hub.local.json: propio de cada equipo (no se sube): carpetas a escanear, dónde clonar, token opcional.
const CONFIG_FILE = join(HUB, "hub.config.json");
const LOCAL_FILE = join(HUB, "hub.local.json");
const CACHE_DIR = join(HUB, ".cache");

const toPosix = (p) => p.replace(/\\/g, "/");
const defaultLocal = () => {
  const docs = toPosix(join(homedir(), "Documents"));
  return { roots: [docs, `${docs}/Proyectos`], cloneDir: `${docs}/Proyectos`, githubToken: "" };
};

export const loadConfig = () => JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
export const saveConfig = (config) => writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");

export function loadLocal() {
  if (!existsSync(LOCAL_FILE)) writeFileSync(LOCAL_FILE, JSON.stringify(defaultLocal(), null, 2) + "\n");
  return { ...defaultLocal(), ...JSON.parse(readFileSync(LOCAL_FILE, "utf8")) };
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
    if (!entry.startsWith(".") && entry !== "node_modules" && statSync(p).isDirectory()) dirs.push(p);
  }
  for (const d of dirs) {
    const pkg = readJson(join(d, "package.json"));
    if (pkg) {
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps["@angular/core"]) stack.add("Angular");
      if (deps.react) stack.add("React");
      if (deps.vue) stack.add("Vue");
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
    if (existsSync(join(d, "docker-compose.yml")) || existsSync(join(d, "Dockerfile"))) stack.add("Docker");
    if (existsSync(join(d, "vercel.json"))) stack.add("Vercel");
    if (existsSync(join(d, "supabase"))) stack.add("Supabase");
  }
  if (stack.size === 0 && existsSync(join(dir, "index.html"))) stack.add("HTML/JS");
  return [...stack];
}

function scanRepo(dir, config) {
  const remote = git(dir, "remote", "get-url", "origin") || null;
  const [name, meta] = metaFor(config, basename(dir), repoSlug(remote));
  // Último commit con trabajo real: ignora los que solo tocan CLAUDE.md / STATUS.md
  const [lastDate = "", lastMsg = ""] = (
    git(dir, "log", "-1", "--format=%cs%x00%s", "--", ".", ":!CLAUDE.md", ":!STATUS.md") || git(dir, "log", "-1", "--format=%cs%x00%s")
  ).split("\0");
  const dirty = git(dir, "status", "--porcelain").split("\n").filter(Boolean).length;
  // Sin upstream configurado, compara con origin/<rama> si existe
  const branch = git(dir, "branch", "--show-current");
  const base = git(dir, "rev-parse", "--abbrev-ref", "@{upstream}") || (git(dir, "rev-parse", "--verify", "--quiet", `origin/${branch}`) && `origin/${branch}`);
  const upstream = base ? git(dir, "rev-list", "--left-right", "--count", `${base}...HEAD`).split(/\s+/) : [];
  const daysAgo = lastDate ? Math.floor((Date.now() - new Date(lastDate)) / 86400000) : null;
  const status = readStatus(dir);
  return {
    name,
    path: toPosix(dir),
    remote,
    repo: repoSlug(remote),
    branch,
    branches: git(dir, "branch", "--format=%(refname:short)").split("\n").filter(Boolean),
    lastCommit: { date: lastDate, message: lastMsg, daysAgo },
    uncommitted: dirty,
    ahead: Number(upstream[1] || 0),
    behind: Number(upstream[0] || 0),
    stack: detectStack(dir),
    hasClaudeMd: existsSync(join(dir, "CLAUDE.md")),
    hasStatusMd: status !== null,
    estadoActual: status?.estado ?? "",
    nextSteps: status?.steps.filter((s) => !s.done).map((s) => s.text) ?? [],
    ...meta,
  };
}

export function scanProjects({ write = true } = {}) {
  const config = loadConfig();
  const local = loadLocal();
  const seen = new Set();
  const projects = [];
  for (const root of local.roots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root)) {
      const dir = join(root, entry);
      if (config.exclude?.includes(entry) || seen.has(dir)) continue;
      if (existsSync(join(dir, ".git"))) {
        seen.add(dir);
        projects.push(scanRepo(dir, config));
      }
    }
  }
  projects.sort((a, b) => (b.lastCommit.date || "").localeCompare(a.lastCommit.date || ""));
  const registry = { generatedAt: new Date().toISOString(), projects };
  if (write) {
    writeFileSync(join(HUB, "projects.json"), JSON.stringify(registry, null, 2) + "\n");
    writeFileSync(join(HUB, "PROJECTS.md"), renderMarkdown(projects));
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

// Busca un proyecto por nombre: exacto, sin mayúsculas o por prefijo/subcadena
export function findProject(name) {
  const { projects } = scanProjects({ write: false });
  const q = String(name).toLowerCase();
  const match =
    projects.find((p) => p.name.toLowerCase() === q) ||
    projects.find((p) => p.name.toLowerCase().startsWith(q)) ||
    projects.find((p) => p.name.toLowerCase().includes(q));
  if (!match) throw new Error(`No hay ningún proyecto llamado "${name}". Proyectos: ${projects.map((p) => p.name).join(", ")}`);
  return match;
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

export function readProjectFile(project, rel, { maxBytes = 200_000 } = {}) {
  const full = safePath(project, rel);
  const st = statSafe(full);
  if (!st) throw new Error(`No existe: ${rel}`);
  if (st.isDirectory()) throw new Error(`${rel} es una carpeta; usa list_project_files.`);
  const buf = readFileSync(full);
  if (buf.subarray(0, 8000).includes(0)) throw new Error(`${rel} parece binario.`);
  const text = buf.subarray(0, maxBytes).toString("utf8");
  return st.size > maxBytes ? `${text}\n\n[… truncado: ${st.size} bytes en total]` : text;
}

export function searchProjects(query, { project, regex = false, maxPerProject = 30 } = {}) {
  const targets = project ? [findProject(project)] : scanProjects({ write: false }).projects;
  const results = [];
  for (const p of targets) {
    const out = git(p.path, "grep", "-n", "-I", "--untracked", regex ? "-E" : "-F", "-i", "-e", query, "--", ".", ":!*lock*", ":!*.min.*", ":!dist", ":!*.map");
    const lines = out.split("\n").filter(Boolean).filter((l) => !BLOCKED.some((re) => re.test(l.split(":")[0])));
    if (lines.length) results.push({ project: p.name, matches: lines.slice(0, maxPerProject).map((l) => l.slice(0, 300)), total: lines.length });
  }
  return results;
}

// ---------- Git ----------

// git fetch en paralelo para saber si hay commits nuevos subidos desde otro equipo
export async function fetchProjects(projects = scanProjects({ write: false }).projects) {
  const { execFile } = await import("node:child_process");
  const run = (p) =>
    new Promise((ok) =>
      execFile("git", ["-C", p.path, "fetch", "--quiet", "--prune"], { timeout: 30_000 }, (err) => ok({ project: p.name, ok: !err })),
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
const STATUS_TEMPLATE = () => readText(join(HUB, "templates", "STATUS.md"));

function splitSections(text) {
  // [{ title, body }] — el primer elemento (title null) es la cabecera antes del primer "## "
  const parts = text.split(/^## /m);
  return [{ title: null, body: parts[0] }, ...parts.slice(1).map((p) => {
    const nl = p.indexOf("\n");
    return { title: p.slice(0, nl === -1 ? undefined : nl).trim(), body: nl === -1 ? "" : p.slice(nl + 1) };
  })];
}

const joinSections = (sections) => sections.map((s) => (s.title === null ? s.body : `## ${s.title}\n${s.body}`)).join("");
const findSection = (sections, name) => sections.find((s) => s.title?.toLowerCase().startsWith(name.toLowerCase()));

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
export function updateStatus(project, { estado, sesion, completados = [], nuevosPasos = [], decisiones = [], problemas = [] }) {
  const file = join(project.path, "STATUS.md");
  const sections = splitSections(existsSync(file) ? readText(file) : STATUS_TEMPLATE());
  const ensure = (name) => {
    let s = findSection(sections, name);
    if (!s) sections.push((s = { title: name, body: "\n" }));
    return s;
  };

  if (estado) ensure("Estado actual").body = `${estado.trim()}\n\n`;

  const pasos = ensure("Siguientes pasos");
  if (completados.length || nuevosPasos.length) {
    const lower = completados.map((c) => c.toLowerCase());
    let lines = pasos.body.split("\n").filter((l) => l.trim() && !/^\s*[-*]\s*(\[ \]\s*)?$/.test(l));
    // Lo completado se quita: el histórico ya queda en "Última sesión" y en git
    lines = lines.filter((l) => !lower.some((c) => l.toLowerCase().includes(c)));
    lines.push(...nuevosPasos.map((p) => `- [ ] ${p}`));
    pasos.body = lines.join("\n") + "\n\n";
  }

  if (sesion?.length) {
    const s = ensure("Última sesión");
    const today = new Date().toISOString().slice(0, 10);
    const entries = s.body.split(/^(?=### )/m).filter((e) => e.startsWith("### ") && !/AAAA-MM-DD/.test(e));
    entries.unshift(`### ${today}\n${sesion.map((x) => `- ${x}`).join("\n")}\n\n`);
    s.body = "\n" + entries.slice(0, 5).map((e) => e.trimEnd() + "\n\n").join("");
  }

  const append = (name, items) => {
    if (!items.length) return;
    const s = ensure(name);
    s.body = s.body.replace(/<!--[\s\S]*?-->\n?/g, "").trimEnd() + "\n" + items.map((x) => `- ${x}`).join("\n") + "\n\n";
  };
  append("Decisiones", decisiones);
  append("Problemas conocidos", problemas);

  writeFileSync(file, joinSections(sections).trimEnd() + "\n");
  return readStatus(project.path);
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
  const cacheFile = join(CACHE_DIR, "github.json");
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
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cacheFile, JSON.stringify({ user, at: Date.now(), repos }, null, 2));
  return repos;
}

export async function remoteOnlyProjects({ force = false } = {}) {
  const config = loadConfig();
  const ignore = new Set((config.github?.ignore ?? []).map((x) => x.toLowerCase()));
  const cloned = new Set(scanProjects({ write: false }).projects.map((p) => p.repo?.toLowerCase()).filter(Boolean));
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
  return {
    project,
    claudeMd: read("CLAUDE.md"),
    statusMd: read("STATUS.md"),
    git: gitSummary(project),
    todos: todos(project),
  };
}
