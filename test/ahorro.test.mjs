// Tests del ahorro de tokens y de la continuidad entre chats y equipos: respuestas breves con presupuesto,
// lecturas acotadas, relevo, historial, estado de otros equipos y sincronización de la carpeta de datos.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  STATUS_BUDGET, clearHandoff, computeAvisos, findProject, getContext, lintStatus, loadOtherMachines, pendingElsewhere,
  readHandoff, readProjectFile, readStatus, saveHandoff, saveMachineState, scanProjects, searchProjects, updateStatus,
} from "../lib/hub.mjs";
import { approxTokens, briefContext, briefText, projectMap, projectsTable, recomendado, recordUsage, syncData, syncSetup, usageReport } from "../lib/resumen.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "hub-ahorro-"));
const borrar = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
const git = (dir, ...args) => execFileSync("git", ["-C", dir, "-c", "user.name=test", "-c", "user.email=test@test", ...args], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();

// Carpeta de datos temporal con un proyecto «tienda» dentro, de ficha larga, y un commit
async function conHub(fn, { equipo = "portatil" } = {}) {
  const base = tmp();
  const datos = join(base, "datos");
  mkdirSync(datos);
  const antes = process.env.PROJECTHUB_HOME;
  process.env.PROJECTHUB_HOME = datos;
  try {
    const repo = join(base, "proyectos", "tienda");
    mkdirSync(join(repo, "src", "lib"), { recursive: true });
    writeFileSync(join(datos, "config.json"), JSON.stringify({ github: { user: "" }, projects: { tienda: { prioridad: "alta", descripcion: "Tienda online" } } }));
    writeFileSync(join(datos, "local.json"), JSON.stringify({ roots: [join(base, "proyectos")], cloneDir: join(base, "proyectos"), equipo }));
    const sesiones = Array.from({ length: 5 }, (_, i) => `### 2026-11-0${9 - i}\n${Array.from({ length: 6 }, (_, j) => `- Sesión ${i}, punto ${j}: ${"detalle largo de lo que se hizo ".repeat(6)}`).join("\n")}\n`).join("\n");
    writeFileSync(join(repo, "STATUS.md"), `# Estado\n\n## Estado actual\nFunciona el carrito; falta el pago.\n\n## Siguientes pasos\n- [ ] Integrar la pasarela de pago\n- [ ] Revisar la web en móvil\n\n## Última sesión\n\n${sesiones}\n## Decisiones\n- Sin base de datos propia.\n`);
    writeFileSync(join(repo, "AGENTS.md"), `# Tienda\n\n\`\`\`bash\nnpm run dev\n\`\`\`\n\n${"Convención importante del proyecto. ".repeat(120)}\n`);
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { dev: "vite", test: "vitest" }, devDependencies: { vite: "1" } }));
    writeFileSync(join(repo, "src", "lib", "carrito.js"), `// Carrito de la compra: añade, quita y calcula el total\n${Array.from({ length: 300 }, (_, i) => `export const linea${i} = ${i};`).join("\n")}\n`);
    writeFileSync(join(repo, "src", "index.js"), "import './lib/carrito.js';\n");
    git(repo, "init", "-q", "-b", "main");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "Tienda inicial");
    return await fn({ datos, repo });
  } finally {
    if (antes === undefined) delete process.env.PROJECTHUB_HOME;
    else process.env.PROJECTHUB_HOME = antes;
    borrar(base);
  }
}

test("el contexto breve cuesta una fracción del completo y cabe en su presupuesto", async () => {
  await conHub(() => {
    const p = findProject("tienda");
    const completo = approxTokens(JSON.stringify(getContext(p)));
    const brief = briefContext(p);
    const texto = briefText(brief);
    const breve = approxTokens(texto);
    assert.ok(breve < 450, `el contexto breve ocupa ~${breve} tokens`);
    assert.ok(breve < completo * 0.25, `breve ${breve} frente a completo ${completo}`);
    // Sin avisos, qué hacer es el primer paso, y no se repite en la lista
    assert.equal(brief.ahora, "Integrar la pasarela de pago");
    assert.deepEqual(brief.siguientesPasos, ["Revisar la web en móvil"]);
    assert.equal(brief.proyecto.git, "al día");
    assert.equal(brief.ultimaSesion.fecha, "2026-11-09");
    assert.ok(brief.ultimaSesion.puntos.every((x) => x.length <= 200));
    // Ruta, descripción y archivo de contexto solo si la sesión está fuera de la carpeta del proyecto
    assert.equal(brief.contextMd, undefined);
    assert.equal(brief.proyecto.ruta, undefined);
    // Los avisos de mantenimiento (ficha larga…) no ocupan sitio: solo se cuentan
    assert.deepEqual(brief.avisos, []);
    assert.equal(brief.otrosAvisos, 1);
    assert.match(texto, /^ProjectHub: tienda · rama main · al día · prioridad alta · último trabajo \d{4}-\d{2}-\d{2} · Tienda inicial\n/);
    assert.match(texto, /\nAhora: Integrar la pasarela de pago\nDespués:\n- Revisar la web en móvil\n/);
    assert.ok(!texto.includes("Avisos"));
    const fuera = briefContext(p, { contexto: true });
    assert.match(fuera.contextMd, /npm run dev/);
    assert.match(briefText(fuera), /\nRuta: .*tienda · Vite\nTienda online\n[\s\S]*--- AGENTS\.md ---\n# Tienda/);
  });
});

test("el contexto breve no repite: con avisos, el primero manda y los avisos del hub se ordenan por nivel", async () => {
  await conHub(({ repo }) => {
    writeFileSync(join(repo, "nuevo.js"), "x\n");
    const brief = briefContext(findProject("tienda"));
    assert.equal(brief.ahora, undefined);
    assert.deepEqual(brief.siguientesPasos, ["Integrar la pasarela de pago", "Revisar la web en móvil"]);
    const hub = { nivel: "alto", codigo: "hub_desactualizado", mensaje: "Servidor viejo.", accion: "Reinicia." };
    const texto = briefText(brief, { avisosHub: [{ ...hub, nivel: "info" }, hub] });
    assert.match(texto, /\nAvisos \(atiende el primero antes que nada\):\n- \[alto\] Servidor viejo\. → Reinicia\.\n- \[medio\] 1 archivo sin commit\.[^\n]*\n- \[info\] Servidor viejo/);
    assert.match(texto, /\nSiguientes pasos:\n- Integrar la pasarela de pago\n- Revisar la web en móvil/);
  });
});

test("projectsTable: una línea por proyecto, avisos que importan y recomendación", () => {
  const base = { branch: "main", ahead: 0, behind: 0, uncommitted: 0, hasStatusMd: true, lastCommit: { daysAgo: 2 }, avisos: [] };
  const projects = [
    { ...base, name: "blog", prioridad: "baja", nextSteps: ["Escribir la entrada de noviembre"], lastCommit: { daysAgo: 0 } },
    { ...base, name: "tienda", prioridad: "alta", nextSteps: ["Integrar la pasarela de pago"], uncommitted: 3, avisos: [{ nivel: "medio", codigo: "cambios_sin_commit", mensaje: "3 archivos sin commit." }, { nivel: "info", codigo: "sin_prioridad", mensaje: "No tiene prioridad." }] },
    { ...base, name: "viejo", prioridad: "archivado", nextSteps: [] },
    { ...base, name: "nuevo", nextSteps: [], hasStatusMd: false, lastCommit: { daysAgo: null } },
  ];
  const lineas = projectsTable(projects, { noClonados: [{ name: "otro", ultimoPush: "2026-11-01" }], fetchFallido: ["blog"] }).split("\n");
  assert.match(lineas[0], /^3 proyectos en este equipo .*más 1 archivado/);
  assert.deepEqual(lineas.slice(2, 5), [
    "tienda | alta | hace 2 d | 3 sin commit | Integrar la pasarela de pago",
    "blog | baja | hoy | al día | Escribir la entrada de noviembre",
    "nuevo | — | — | al día | (sin STATUS.md)",
  ]);
  const texto = lineas.join("\n");
  assert.ok(texto.includes("- tienda [medio]: 3 archivos sin commit.") && !texto.includes("No tiene prioridad"));
  assert.ok(texto.includes("Recomendado: tienda (prioridad alta") && texto.includes("sin clonar aquí: 1 (otro)") && texto.includes("remoto de: blog"));
  // Con 25 proyectos, el panorama entero sigue siendo barato
  const muchos = Array.from({ length: 25 }, (_, i) => ({ ...base, name: `proyecto-${i}`, prioridad: "media", nextSteps: ["Un siguiente paso de longitud normal para el proyecto"] }));
  assert.ok(approxTokens(projectsTable(muchos)) < 900);
});

test("recomendado: primero lo que hay que resolver antes de trabajar", () => {
  const p = (name, extra) => ({ name, nextSteps: ["x"], prioridad: "media", ...extra });
  assert.equal(recomendado([p("a", { prioridad: "alta" }), p("b", { behind: 2 })]).name, "b");
  assert.match(recomendado([p("a"), p("b", { relevo: { fecha: "2026-11-09 10:00" } })]).motivo, /relevo/);
  assert.equal(recomendado([p("a"), p("b", { prioridad: "alta" })]).name, "b");
  assert.equal(recomendado([p("a", { prioridad: "archivado" })]), null);
});

test("read_project_file: rango de líneas y corte con indicación de cómo seguir", async () => {
  await conHub(() => {
    const p = findProject("tienda");
    const trozo = readProjectFile(p, "src/lib/carrito.js", { desde: 2, hasta: 4 });
    assert.equal(trozo, "[src/lib/carrito.js: líneas 2–4 de 302]\nexport const linea0 = 0;\nexport const linea1 = 1;\nexport const linea2 = 2;");
    assert.equal(readProjectFile(p, "src/lib/carrito.js", { desde: 300 }).split("\n").length, 4);
    assert.throws(() => readProjectFile(p, "src/lib/carrito.js", { desde: 999 }), /solo tiene 302 líneas/);
    assert.match(readProjectFile(p, "src/lib/carrito.js", { maxBytes: 500 }), /cortado en la línea \d+[\s\S]*desde=\d+/);
    assert.equal(readProjectFile(p, "src/index.js"), "import './lib/carrito.js';\n");
    // Buscar devuelve pocas coincidencias y dice cuántas hay
    const [r] = searchProjects("export const linea");
    assert.equal(r.total, 300);
    assert.equal(r.matches.length, 8);
    assert.equal(searchProjects("export const linea", { project: "tienda" })[0].matches.length, 25);
  });
});

test("projectMap resume la estructura y se guarda por commit", async () => {
  await conHub(({ datos }) => {
    const mapa = projectMap(findProject("tienda"));
    assert.match(mapa, /^Mapa de tienda \(5 archivos/);
    assert.match(mapa, /Scripts de npm: dev, test/);
    assert.match(mapa, /src\/lib\/ — 1 archivo \(js\)/);
    assert.match(mapa, /src\/lib\/carrito\.js \(302 líneas\) — Carrito de la compra: añade, quita y calcula el total/);
    assert.ok(approxTokens(mapa) < 400);
    assert.equal(readdirSync(join(datos, "cache", "mapas")).length, 1);
    assert.equal(projectMap(findProject("tienda")), mapa);
  });
});

test("relevo: se guarda con lo que hay sin commit, avisa al retomar y se borra al cerrar", async () => {
  await conHub(({ repo }) => {
    writeFileSync(join(repo, "src", "pago.js"), "// a medias\n");
    assert.throws(() => saveHandoff(findProject("tienda"), { haciendo: "algo" }), /siguiente/);
    const r = saveHandoff(findProject("tienda"), { haciendo: "Integrando la pasarela", hecho: ["Cuenta de pruebas creada"], siguiente: "Llamar a la API desde src/pago.js", notas: "La clave de pruebas está en .env.example" }, { ahora: new Date("2026-11-10T09:05:00") });
    assert.equal(r.sinCommit, 1);
    const h = readHandoff(repo);
    assert.deepEqual([h.fecha, h.equipo], ["2026-11-10 09:05", "portatil"]);
    assert.match(h.text, /^# Relevo — 2026-11-10 09:05 · equipo portatil · rama main @ \w+\n\n## Haciendo\nIntegrando la pasarela\n\n## Hecho\n- Cuenta de pruebas creada\n\n## Siguiente\nLlamar a la API desde src\/pago\.js\n\n## Archivos sin commit en portatil\n- \?\? src\/pago\.js\n\n## Notas\nLa clave/);

    const p = findProject("tienda");
    assert.deepEqual(p.relevo, { fecha: "2026-11-10 09:05", equipo: "portatil" });
    assert.equal(p.avisos[0].codigo, "relevo_pendiente");
    assert.match(p.siguienteAccion, /Continúa desde el relevo/);
    assert.match(briefContext(p).relevo, /## Siguiente\nLlamar a la API/);
    // Con relevo, la última sesión ya no es lo más reciente: solo su fecha
    assert.deepEqual(briefContext(p).ultimaSesion, { fecha: "2026-11-09" });
    // El relevo no cuenta como trabajo sin anotar
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "wip", "--", ".projecthub");
    assert.equal(findProject("tienda").unloggedCount, 0);

    assert.equal(updateStatus(p, { sesion: ["Pasarela integrada."] }).cambios.relevoBorrado, true);
    assert.equal(readHandoff(repo), null);
    assert.ok(!existsSync(join(repo, ".projecthub")));
    assert.equal(clearHandoff(p), false);
  });
});

test("las sesiones antiguas pasan a HISTORY.md en vez de perderse", async () => {
  await conHub(({ repo }) => {
    const p = findProject("tienda");
    const uno = updateStatus(p, { sesion: ["Sesión nueva."], fecha: "2026-11-10" });
    assert.equal(uno.cambios.sesionesDescartadas, 1);
    assert.equal(uno.cambios.historial, "HISTORY.md");
    updateStatus(p, { sesion: ["Otra más."], fecha: "2026-11-11" });
    const hist = readFileSync(join(repo, "HISTORY.md"), "utf8");
    assert.match(hist, /^# Historial de sesiones\n\n> [^\n]+\n\n### 2026-11-06\n[\s\S]*### 2026-11-05\n/);
    assert.equal(hist.match(/^# Historial/gm).length, 1);
    assert.equal(readStatus(repo).text.match(/^### /gm).length, 5);
  });
});

test("lintStatus avisa de fichas que cuestan demasiado en cada sesión", () => {
  const base = { estado: "Va bien", steps: [{ done: false, text: "Publicar la web en Vercel" }] };
  assert.deepEqual(lintStatus({ ...base, text: "## Última sesión\n- Corto.\n" }), []);
  assert.match(lintStatus({ ...base, text: "x".repeat(STATUS_BUDGET * 4 + 400) })[0], /ocupa unos \d+ tokens/);
  assert.match(lintStatus({ ...base, text: `- ${"muy largo ".repeat(60)}\n` })[0], /viñetas de más de 500/);
});

test("pendingElsewhere: lo que quedó sin subir en otros equipos, salvo que ya haya llegado", () => {
  const states = [
    { equipo: "clase", proyectos: { tienda: { ahead: 3, uncommitted: 0, head: "abc", at: "2026-11-09T10:00:00Z" }, blog: { ahead: 0, uncommitted: 2, head: "def", at: "2026-11-08T10:00:00Z" } } },
    { equipo: "sobremesa", proyectos: {} },
  ];
  assert.deepEqual(pendingElsewhere(states, "tienda"), [{ equipo: "clase", ahead: 3, uncommitted: 0, at: "2026-11-09T10:00:00Z" }]);
  assert.deepEqual(pendingElsewhere(states, "tienda", (h) => h === "abc"), []); // ese commit ya está aquí: se subió
  assert.deepEqual(pendingElsewhere(states, "blog", () => true).map((e) => e.uncommitted), [2]); // los cambios sin commit no se pueden comprobar
  assert.deepEqual(pendingElsewhere(states, "otro"), []);

  const avisos = computeAvisos({ name: "tienda", branch: "main", hasStatusMd: true, hasContextFile: true, prioridad: "alta", nextSteps: ["x y z"], lastCommit: { daysAgo: 1 }, otrosEquipos: pendingElsewhere(states, "tienda") });
  assert.equal(avisos[0].codigo, "sin_subir_en_otro_equipo");
  assert.match(avisos[0].mensaje, /equipo clase .* 3 commits sin subir \(visto el 2026-11-09\)/);
});

test("cada equipo anota su trabajo sin subir y los demás lo ven", async () => {
  await conHub(({ datos, repo }) => {
    scanProjects();
    // Nada pendiente: solo queda anotada la versión del hub de este equipo
    assert.deepEqual(JSON.parse(readFileSync(join(datos, "equipos", "portatil.json"), "utf8")).proyectos, {});
    writeFileSync(join(repo, "nuevo.txt"), "x");
    scanProjects();
    const mio = JSON.parse(readFileSync(join(datos, "equipos", "portatil.json"), "utf8"));
    assert.deepEqual([mio.equipo, mio.proyectos.tienda.uncommitted, mio.proyectos.tienda.ahead], ["portatil", 1, 0]);
    // Sin cambios, la fecha no se toca (para no ensuciar la sincronización)
    saveMachineState([findProject("tienda")]);
    assert.equal(JSON.parse(readFileSync(join(datos, "equipos", "portatil.json"), "utf8")).proyectos.tienda.at, mio.proyectos.tienda.at);

    assert.deepEqual(loadOtherMachines(), []); // el propio no cuenta
    writeFileSync(join(datos, "equipos", "clase.json"), JSON.stringify({ equipo: "clase", proyectos: { tienda: { ahead: 2, uncommitted: 1, head: "0000000000000000000000000000000000000000", at: "2026-11-09T18:00:00Z" } } }));
    const p = findProject("tienda");
    assert.deepEqual(p.otrosEquipos, [{ equipo: "clase", ahead: 2, uncommitted: 1, at: "2026-11-09T18:00:00Z" }]);
    assert.equal(p.avisos[0].codigo, "sin_subir_en_otro_equipo");
    // Si el commit que tenía aquel equipo ya está aquí, es que lo subió: quedan solo los cambios sin commit
    const head = git(repo, "rev-parse", "HEAD");
    writeFileSync(join(datos, "equipos", "clase.json"), JSON.stringify({ equipo: "clase", proyectos: { tienda: { ahead: 2, uncommitted: 0, head, at: "2026-11-09T18:00:00Z" } } }));
    assert.deepEqual(findProject("tienda").otrosEquipos, []);
  });
});

test("sync: dos equipos comparten configuración y estado a través de un repo", async () => {
  const remoto = tmp();
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remoto]);
  try {
    let datosA;
    await conHub(async ({ datos, repo }) => {
      datosA = datos;
      assert.deepEqual(await syncData(), { activo: false });
      writeFileSync(join(repo, "a-medias.txt"), "x");
      scanProjects();
      const r = await syncSetup(remoto);
      assert.deepEqual(r, { ok: true, rama: "main" });
      const subidos = execFileSync("git", ["-C", remoto, "ls-tree", "-r", "--name-only", "main"]).toString().split("\n").filter(Boolean).sort();
      assert.deepEqual(subidos, [".gitignore", "config.json", "equipos/clase.json"]); // ni local.json ni la caché

      // El segundo equipo se une y recibe prioridades y el estado del primero
      await conHub(async ({ datos: datosB }) => {
        assert.deepEqual(await syncSetup(remoto), { ok: true, rama: "main" });
        assert.equal(loadOtherMachines()[0].equipo, "clase");
        const p = findProject("tienda");
        assert.equal(p.avisos[0].codigo, "sin_subir_en_otro_equipo");
        assert.match(p.avisos[0].mensaje, /equipo clase .*1 archivo sin commit/);
        // Un cambio de configuración en este equipo llega al otro
        const config = JSON.parse(readFileSync(join(datosB, "config.json"), "utf8"));
        config.projects.tienda.prioridad = "baja";
        writeFileSync(join(datosB, "config.json"), JSON.stringify(config));
        assert.deepEqual(await syncData(), { activo: true, ok: true, guardado: true });
      }, { equipo: "casa" });

      process.env.PROJECTHUB_HOME = datosA;
      assert.deepEqual(await syncData(), { activo: true, ok: true, guardado: false });
      assert.equal(JSON.parse(readFileSync(join(datosA, "config.json"), "utf8")).projects.tienda.prioridad, "baja");
    }, { equipo: "clase" });
  } finally {
    borrar(remoto);
  }
});

test("el consumo de cada herramienta queda registrado", async () => {
  await conHub(() => {
    assert.deepEqual(usageReport(), []);
    recordUsage("get_project_context", "x".repeat(400));
    recordUsage("get_project_context", "x".repeat(800));
    recordUsage("list_projects", "x".repeat(40));
    assert.deepEqual(usageReport(), [
      { tool: "get_project_context", llamadas: 2, tokens: 300, media: 150, max: 200 },
      { tool: "list_projects", llamadas: 1, tokens: 10, media: 10, max: 10 },
    ]);
  });
});

test("lo que se paga en cada conversación o en cada /comando cabe en su presupuesto", async () => {
  const { globalBlock, renderSkill, skillNames } = await import("../lib/instalacion.mjs");
  // Las skills se cargan enteras al usarlas: deben costar menos que la respuesta que piden
  for (const name of skillNames()) {
    const t = approxTokens(renderSkill(name));
    assert.ok(t < 500, `la skill ${name} ocupa ~${t} tokens`);
  }
  // El bloque de ~/.claude/CLAUDE.md va en todas las conversaciones de Claude Code, también fuera de los proyectos
  assert.ok(approxTokens(globalBlock()) < 160, `el bloque global ocupa ~${approxTokens(globalBlock())} tokens`);
});

test("el hub avisa de sí mismo: servidor viejo y pull del propio hub", async () => {
  const { avisosHub } = await import("../lib/instalacion.mjs");
  assert.equal(avisosHub({ loadedHash: "otra-version" })[0].codigo, "hub_desactualizado");
  const base = { name: "ProjectHub", branch: "main", ahead: 0, behind: 2, uncommitted: 0, hasStatusMd: true, hasContextFile: true, prioridad: "media", nextSteps: [] };
  assert.match(computeAvisos({ ...base, esHub: true })[0].accion, /npm ci y npm run instalar/);
  assert.doesNotMatch(computeAvisos(base)[0].accion, /npm run instalar/);
});

test("statusText: lo que cambió en una línea y solo lo que hay que revisar", async () => {
  const { statusText } = await import("../lib/resumen.mjs");
  const cambios = { pasosQuitados: ["a"], pasosAnadidos: [], noEncontrados: [], ambiguos: ["login"], sesionesDescartadas: 1, sesion: "2026-11-12", decisiones: 1 };
  assert.equal(
    statusText({ name: "tienda" }, cambios, 4, [{ mensaje: "2 archivos sin commit.", accion: "Pregunta antes de hacer commit." }]),
    "STATUS.md de tienda guardado: sesión 2026-11-12, 1 paso quitado, 1 decisión. Quedan 4 pasos.\nAmbiguos (encajan con varios pasos; no se han quitado): login\n1 sesión antigua pasada a HISTORY.md.\nGit: 2 archivos sin commit. Pregunta antes de hacer commit.",
  );
});

test("cada equipo anota qué versión del hub tiene", async () => {
  await conHub(({ datos }) => {
    saveMachineState([{ name: "tienda", ahead: 1, uncommitted: 0, branch: "main", head: "abc" }]);
    const estado = JSON.parse(readFileSync(join(datos, "equipos", "portatil.json"), "utf8"));
    assert.equal(estado.hub.version, JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version);
  });
});
