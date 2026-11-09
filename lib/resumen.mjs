// Respuestas pensadas para gastar pocos tokens: lo que la IA necesita para decidir, y el detalle solo si lo pide.
// También: mapa del proyecto, registro de consumo y sincronización de la carpeta de datos entre equipos.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, dataFile, ensureData, equipoActual, git, listFiles, parseSessions, readHandoff } from "./hub.mjs";

// Aproximación habitual: 1 token ≈ 4 caracteres. Sirve para comparar y poner límites, no para facturar.
export const approxTokens = (text) => Math.ceil(String(text).length / 4);

const corta = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

// "al día" o lo que haya pendiente respecto al remoto
export function gitLine(p) {
  const partes = [p.behind && `${p.behind} por bajar`, p.ahead && `${p.ahead} sin subir`, p.uncommitted && `${p.uncommitted} sin commit`].filter(Boolean);
  return partes.length ? partes.join(", ") : "al día";
}

const hace = (d) => (d === null || d === undefined ? "—" : d === 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} d`);
const ORDEN = { alta: 0, media: 1, baja: 2 };

// Proyecto por el que conviene seguir: primero lo que hay que resolver, luego prioridad y actividad. Pura.
export function recomendado(projects) {
  const vivos = projects.filter((p) => p.prioridad !== "archivado");
  const urgente = vivos.find((p) => p.behind || p.otrosEquipos?.length || p.relevo);
  if (urgente) {
    const motivo = urgente.relevo ? "tiene un relevo a medias" : urgente.behind ? "hay commits por bajar" : "hay trabajo sin subir en otro equipo";
    return { name: urgente.name, motivo };
  }
  const alta = vivos.find((p) => p.prioridad === "alta" && p.nextSteps?.length);
  if (alta) return { name: alta.name, motivo: `prioridad alta; siguiente paso: ${corta(alta.nextSteps[0], 100)}` };
  const reciente = vivos.find((p) => p.nextSteps?.length) ?? vivos[0];
  return reciente ? { name: reciente.name, motivo: "es el de actividad más reciente" } : null;
}

// Panorama de todos los proyectos en texto: una línea por proyecto en vez de un objeto con veinte campos. Pura.
export function projectsTable(projects, { noClonados = [], fetchFallido = [] } = {}) {
  const vivos = projects.filter((p) => p.prioridad !== "archivado");
  const archivados = projects.length - vivos.length;
  const filas = [...vivos]
    .sort((a, b) => (ORDEN[a.prioridad] ?? 3) - (ORDEN[b.prioridad] ?? 3))
    .map((p) => [p.name, p.prioridad ?? "—", hace(p.lastCommit?.daysAgo), gitLine(p), p.nextSteps?.[0] ? corta(p.nextSteps[0], 90) : p.hasStatusMd ? "—" : "(sin STATUS.md)"].join(" | "));

  // Solo lo que cambia qué hacer hoy; el resto de avisos llega al retomar el proyecto
  const ver = new Set(["inactivo", "rama_con_otro_nombre"]);
  const avisos = vivos.flatMap((p) => (p.avisos ?? []).filter((a) => a.nivel !== "info" || ver.has(a.codigo)).map((a) => `- ${p.name} [${a.nivel}]: ${a.mensaje}`));

  const out = [
    `${plural(vivos.length, "proyecto", "proyectos")} en este equipo (${equipoActual()})${archivados ? `, más ${plural(archivados, "archivado", "archivados")}` : ""}.`,
    "proyecto | prioridad | último trabajo | git | siguiente paso",
    ...filas,
  ];
  if (avisos.length) out.push("", "Avisos:", ...avisos);
  const rec = recomendado(projects);
  if (rec) out.push("", `Recomendado: ${rec.name} (${rec.motivo}).`);
  if (typeof noClonados === "string") out.push("", noClonados);
  else if (noClonados.length) {
    const recientes = [...noClonados].sort((a, b) => (b.ultimoPush ?? "").localeCompare(a.ultimoPush ?? "")).slice(0, 5).map((r) => r.name);
    out.push("", `En GitHub sin clonar aquí: ${noClonados.length} (${recientes.join(", ")}${noClonados.length > 5 ? "…" : ""}). Se clonan con clone_project.`);
  }
  if (fetchFallido.length) out.push("", `No se pudo consultar el remoto de: ${fetchFallido.join(", ")}. Su estado respecto a él puede estar desfasado.`);
  return out.join("\n");
}

// Avisos informativos que no cambian cómo se trabaja hoy: en el contexto breve solo se cuentan
const SECUNDARIOS = new Set(["sin_prioridad", "inactivo", "calidad_ficha"]);

// Lo justo para retomar un proyecto. `contexto: true` añade el archivo de contexto, para cuando el cliente
// no lo ha cargado ya (sesión abierta en otra carpeta).
export function briefContext(project, { contexto = false } = {}) {
  const dir = project.path;
  const leer = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8").replace(/\r\n/g, "\n") : null);
  const sesion = parseSessions(leer("STATUS.md") ?? "")[0];
  const avisos = project.avisos.filter((a) => !SECUNDARIOS.has(a.codigo));
  const otros = project.avisos.length - avisos.length;
  const porBajar = project.behind && project.upstream ? git(dir, "log", "-8", "--format=%cs %an: %s", `HEAD..${project.upstream}`).split("\n").filter(Boolean) : [];
  const brief = {
    siguienteAccion: project.siguienteAccion,
    avisos,
    ...(otros && { otrosAvisos: `${otros} de menor importancia (detalle: "completo")` }),
    relevo: readHandoff(dir)?.text,
    proyecto: {
      nombre: project.name,
      ruta: project.path,
      descripcion: project.descripcion,
      prioridad: project.prioridad,
      stack: project.stack?.join(", ") || undefined,
      rama: project.branch,
      git: gitLine(project),
      ultimoTrabajo: project.lastCommit?.date ? `${project.lastCommit.date} · ${project.lastCommit.message}` : undefined,
      archivoDeContexto: project.contextFile ?? undefined,
    },
    estado: project.estadoActual || undefined,
    siguientesPasos: project.nextSteps.slice(0, 8),
    ...(project.nextSteps.length > 8 && { masPasos: project.nextSteps.length - 8 }),
    ultimaSesion: sesion && { fecha: sesion.fecha, puntos: sesion.puntos.map((x) => corta(x, 300)) },
    ...(project.unloggedCount && { sinAnotar: project.unloggedCommits.slice(0, 12).map((c) => `${c.at.slice(0, 10)} ${c.message}`), ...(project.unloggedCount > 12 && { masSinAnotar: project.unloggedCount - 12 }) }),
    ...(porBajar.length && { porBajar }),
    ...(contexto && project.contextFile && { contextMd: leer(project.contextFile) }),
  };
  return brief;
}

// ---------- Mapa del proyecto ----------

const FUENTE = /\.(m?[jt]sx?|vue|svelte|astro|py|go|rs|java|kt|php|rb|cs|dart|swift|c|cc|cpp|h|sql|css|scss|html)$/i;
const comentario = (text) => {
  for (const l of text.split(/\r?\n/).slice(0, 12)) {
    const m = l.match(/^\s*(?:\/\/+|#(?!!)|\/\*+|\*|<!--|--)\s*(.{8,})$/);
    if (m && !/eslint|prettier|@ts-|copyright|license|coding[:=]/i.test(m[1])) return corta(m[1].replace(/\s*(\*\/|-->)\s*$/, "").trim(), 110);
  }
  return "";
};

// Estructura del repo en pocas líneas: carpetas con su tamaño, scripts y los archivos de código principales
// con su primera línea de comentario. Evita explorar el proyecto a ciegas. Se guarda por commit.
export function projectMap(project) {
  const head = git(project.path, "rev-parse", "--short", "HEAD") || "sin-commits";
  const cache = dataFile("cache", "mapas", `${(project.repo || project.name).toLowerCase().replace(/[^\w.-]+/g, "_")}-${head}-${project.uncommitted}.txt`);
  if (existsSync(cache)) return readFileSync(cache, "utf8");

  const { files, total } = listFiles(project, "", 20_000);
  const carpetas = new Map();
  const raiz = [];
  for (const f of files) {
    const partes = f.split("/");
    if (partes.length === 1) raiz.push(f);
    else {
      // Dos niveles en las carpetas de código habituales, uno en el resto
      const clave = partes.length > 2 && /^(src|app|lib|packages|apps|server|client|backend|frontend)$/i.test(partes[0]) ? `${partes[0]}/${partes[1]}/` : `${partes[0]}/`;
      const c = carpetas.get(clave) ?? { n: 0, ext: {} };
      c.n++;
      const ext = f.match(/\.([\w]+)$/)?.[1] ?? "";
      if (ext) c.ext[ext] = (c.ext[ext] ?? 0) + 1;
      carpetas.set(clave, c);
    }
  }
  const lineasCarpetas = [...carpetas].sort((a, b) => b[1].n - a[1].n).slice(0, 30).map(([dir, c]) => {
    const exts = Object.entries(c.ext).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([e]) => e).join(", ");
    return `  ${dir} — ${plural(c.n, "archivo", "archivos")}${exts ? ` (${exts})` : ""}`;
  });

  const principales = files
    .filter((f) => FUENTE.test(f) && !/(^|\/)(dist|build|out|coverage|\.next)\//.test(f) && !/\.(min|d)\.\w+$/.test(f))
    .map((f) => ({ f, size: statSync(join(project.path, f), { throwIfNoEntry: false })?.size ?? 0 }))
    .filter((x) => x.size > 0 && x.size < 400_000)
    .sort((a, b) => b.size - a.size)
    .slice(0, 15)
    .map(({ f }) => {
      const text = readFileSync(join(project.path, f), "utf8");
      const nota = comentario(text);
      return `  ${f} (${text.split("\n").length} líneas)${nota ? ` — ${nota}` : ""}`;
    });

  let scripts = "";
  try {
    const pkg = JSON.parse(readFileSync(join(project.path, "package.json"), "utf8"));
    scripts = Object.keys(pkg.scripts ?? {}).join(", ");
  } catch {
    // no es un proyecto de Node o no tiene scripts
  }

  const mapa = [
    `Mapa de ${project.name} (${total} archivos, commit ${head}). Stack: ${project.stack?.join(", ") || "sin detectar"}.`,
    `Raíz: ${raiz.slice(0, 25).join(", ")}${raiz.length > 25 ? "…" : ""}`,
    scripts && `Scripts de npm: ${scripts}`,
    lineasCarpetas.length && `Carpetas:\n${lineasCarpetas.join("\n")}`,
    principales.length && `Archivos de código más grandes:\n${principales.join("\n")}`,
    "Para ver una carpeta, list_project_files con path; para leer, read_project_file (admite desde y hasta).",
  ].filter(Boolean).join("\n");
  mkdirSync(dataFile("cache", "mapas"), { recursive: true });
  writeFileSync(cache, mapa);
  return mapa;
}

// ---------- Consumo: cuántos tokens devuelve cada herramienta ----------

const usoFile = () => dataFile("cache", "uso.json");
const leerUso = () => {
  try {
    return JSON.parse(readFileSync(usoFile(), "utf8"));
  } catch {
    return {};
  }
};

export function recordUsage(tool, text) {
  try {
    const uso = leerUso();
    const u = (uso[tool] ??= { llamadas: 0, tokens: 0, max: 0 });
    const t = approxTokens(text);
    u.llamadas++;
    u.tokens += t;
    u.max = Math.max(u.max, t);
    mkdirSync(dataFile("cache"), { recursive: true });
    writeFileSync(usoFile(), JSON.stringify(uso));
  } catch {
    // medir nunca debe hacer fallar una herramienta
  }
}

export function usageReport() {
  return Object.entries(leerUso())
    .map(([tool, u]) => ({ tool, llamadas: u.llamadas, tokens: u.tokens, media: Math.round(u.tokens / u.llamadas), max: u.max }))
    .sort((a, b) => b.tokens - a.tokens);
}

// ---------- Sincronización de la carpeta de datos entre equipos ----------
// Si ~/.projecthub es un repo git con remoto (projecthub sync --remote <url>), aquí se guarda, se baja y se sube.
// Es la configuración del propio hub, no un proyecto del usuario: por eso sí hace commit y push él solo.

const run = (args, timeout = 20_000) =>
  new Promise((ok) => execFile("git", ["-C", dataDir(), ...args], { timeout }, (err, out, errOut) => ok({ ok: !err, out: String(out ?? "").trim(), err: String(errOut || err?.message || "").trim() })));

// Identidad para los commits de la carpeta de datos si el usuario no tiene una configurada
async function identidad() {
  return (await run(["config", "user.email"])).out ? [] : ["-c", "user.name=ProjectHub", "-c", "user.email=projecthub@localhost"];
}

export const syncActivo = () => existsSync(dataFile(".git"));

export async function syncData({ pull = true, push = true } = {}) {
  if (!syncActivo()) return { activo: false };
  ensureData(); // garantiza el .gitignore que deja fuera local.json y la caché
  const id = await identidad();
  await run(["add", "-A"]);
  let guardado = false;
  if ((await run(["status", "--porcelain"])).out) guardado = (await run([...id, "commit", "-q", "-m", `ProjectHub: cambios desde ${equipoActual()}`])).ok;
  if (!(await run(["remote"])).out) return { activo: true, remoto: false, guardado };
  const rama = (await run(["branch", "--show-current"])).out || "main";
  if (pull) {
    const r = await run([...id, "pull", "--no-rebase", "--no-edit", "-q", "origin", rama]);
    // Remoto vacío (primer equipo) no es un error; un conflicto sí: se deshace y se avisa
    if (!r.ok && !/couldn't find remote ref|no such ref/i.test(r.err)) {
      await run(["merge", "--abort"]);
      return { activo: true, ok: false, guardado, error: `No se pudo bajar la configuración: ${corta(r.err, 200)}` };
    }
  }
  if (push) {
    const r = await run(["push", "-q", "-u", "origin", rama]);
    if (!r.ok) return { activo: true, ok: false, guardado, error: `No se pudo subir la configuración: ${corta(r.err, 200)}` };
  }
  return { activo: true, ok: true, guardado };
}

// Primera vez: convierte la carpeta de datos en un repo y la une al remoto. Si el remoto ya tiene configuración
// (segundo equipo), gana la del remoto en lo que choque: la de este equipo queda en el historial de git.
export async function syncSetup(url) {
  ensureData(); // crea la carpeta y el .gitignore que deja fuera local.json y la caché
  if (!syncActivo()) await run(["init", "-q", "-b", "main"]);
  const id = await identidad();
  const remoto = (await run(["remote", "get-url", "origin"])).out;
  if (!remoto) await run(["remote", "add", "origin", url]);
  else if (remoto !== url) await run(["remote", "set-url", "origin", url]);
  await run(["add", "-A"]);
  if ((await run(["status", "--porcelain"])).out) await run([...id, "commit", "-q", "-m", `ProjectHub: configuración de ${equipoActual()}`]);
  const rama = (await run(["branch", "--show-current"])).out || "main";
  const f = await run(["fetch", "-q", "origin"], 30_000);
  if (!f.ok) return { ok: false, error: `No se pudo conectar con ${url}: ${corta(f.err, 200)}` };
  if ((await run(["rev-parse", "--verify", "--quiet", `origin/${rama}`])).ok) {
    const m = await run([...id, "merge", "-q", "--no-edit", "--allow-unrelated-histories", "-X", "theirs", `origin/${rama}`]);
    if (!m.ok) {
      await run(["merge", "--abort"]);
      return { ok: false, error: `No se pudo unir con la configuración del remoto: ${corta(m.err, 200)}` };
    }
  }
  const p = await run(["push", "-q", "-u", "origin", rama], 30_000);
  return p.ok ? { ok: true, rama } : { ok: false, error: `No se pudo subir: ${corta(p.err, 200)}` };
}
