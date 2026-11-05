// Tests del núcleo: node --test (o npm test). No tocan proyectos reales: trabajan en carpetas temporales.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeAvisos, lintClaudeMd, lintStatus, readProjectFile, readStatus, repoSlug, resolveName, safePath, siguienteAccion, toggleStep, updateStatus,
} from "../lib/hub.mjs";
import { mergeHooks, upsertBlock } from "../lib/instalacion.mjs";

const STATUS = `# Estado del proyecto

## Estado actual
Funciona casi todo.

## Siguientes pasos
- [ ] Publicar la web en Vercel
- [ ] Revisar la web en móvil
- [x] Paso ya hecho antes

## Última sesión
### 2026-10-01
- Algo antiguo.

## Decisiones

## Problemas conocidos
`;

function conProyecto(contenido, fn) {
  const dir = mkdtempSync(join(tmpdir(), "hub-test-"));
  try {
    writeFileSync(join(dir, "STATUS.md"), contenido);
    return fn({ path: dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("readStatus lee igual con saltos de línea LF y CRLF", () => {
  for (const texto of [STATUS, STATUS.replace(/\n/g, "\r\n")]) {
    conProyecto(texto, (p) => {
      const s = readStatus(p.path);
      assert.equal(s.estado, "Funciona casi todo.");
      assert.deepEqual(s.steps.map((x) => x.done), [false, false, true]);
      assert.equal(s.steps[0].text, "Publicar la web en Vercel");
    });
  }
});

test("updateStatus quita el paso señalado y añade el nuevo", () => {
  conProyecto(STATUS, (p) => {
    const r = updateStatus(p, { completados: ["Publicar"], nuevosPasos: ["Escribir la memoria final"] });
    assert.deepEqual(r.cambios.pasosQuitados, ["Publicar la web en Vercel"]);
    assert.deepEqual(r.cambios.pasosAnadidos, ["Escribir la memoria final"]);
    assert.ok(!r.steps.some((s) => s.text.startsWith("Publicar")));
    assert.ok(r.steps.some((s) => s.text === "Escribir la memoria final"));
  });
});

test("updateStatus avisa de pasos no encontrados o ambiguos y no los toca", () => {
  conProyecto(STATUS, (p) => {
    const r = updateStatus(p, { completados: ["no existe", "la web"] });
    assert.deepEqual(r.cambios.noEncontrados, ["no existe"]);
    assert.deepEqual(r.cambios.ambiguos, ["la web"]);
    assert.equal(r.steps.length, 3);
  });
});

test("updateStatus no duplica un paso que ya existe", () => {
  conProyecto(STATUS, (p) => {
    const r = updateStatus(p, { nuevosPasos: ["Publicar la web en Vercel"] });
    assert.deepEqual(r.cambios.pasosAnadidos, []);
    assert.equal(r.steps.length, 3);
  });
});

test("updateStatus une sesiones del mismo día y ordena por fecha", () => {
  conProyecto(STATUS, (p) => {
    updateStatus(p, { sesion: ["Uno"], fecha: "2026-10-05" });
    updateStatus(p, { sesion: ["Dos"], fecha: "2026-10-05" });
    updateStatus(p, { sesion: ["Tres"], fecha: "2026-10-03" });
    const t = readFileSync(join(p.path, "STATUS.md"), "utf8");
    assert.equal(t.match(/### 2026-10-05/g).length, 1);
    assert.ok(t.indexOf("- Uno") < t.indexOf("- Dos"));
    assert.ok(t.indexOf("2026-10-05") < t.indexOf("2026-10-03") && t.indexOf("2026-10-03") < t.indexOf("2026-10-01"));
  });
});

test("updateStatus conserva 5 sesiones e informa de las descartadas", () => {
  conProyecto(STATUS, (p) => {
    let r;
    for (let d = 2; d <= 6; d++) r = updateStatus(p, { sesion: ["x"], fecha: `2026-10-0${d}` });
    assert.equal(r.cambios.sesionesDescartadas, 1);
    assert.ok(!readFileSync(join(p.path, "STATUS.md"), "utf8").includes("2026-10-01"));
  });
});

test("updateStatus rechaza fechas no válidas y llamadas vacías", () => {
  conProyecto(STATUS, (p) => {
    assert.throws(() => updateStatus(p, { sesion: ["x"], fecha: "ayer" }), /Fecha no válida/);
    assert.throws(() => updateStatus(p, {}), /nada que actualizar/);
  });
});

test("toggleStep funciona con CRLF", () => {
  conProyecto(STATUS.replace(/\n/g, "\r\n"), (p) => {
    const s = toggleStep(p, "Revisar la web", true);
    assert.equal(s.steps.find((x) => x.text.startsWith("Revisar")).done, true);
  });
});

test("resolveName: exacto, por repo, prefijo y ambiguo", () => {
  const list = [{ name: "drogedex", repo: "drogedex" }, { name: "drogedex-nave", repo: "drogedex-nave" }, { name: "CreaFlow", repo: "lamostudio" }];
  assert.equal(resolveName(list, "DROGEDEX").name, "drogedex");
  assert.equal(resolveName(list, "lamostudio").name, "CreaFlow");
  assert.equal(resolveName(list, "crea").name, "CreaFlow");
  assert.equal(resolveName(list, "nave").name, "drogedex-nave");
  assert.throws(() => resolveName(list, "drog"), /ambiguo/);
  assert.throws(() => resolveName(list, "nada"), /clone_project/);
});

test("repoSlug entiende https y ssh", () => {
  assert.equal(repoSlug("https://github.com/Serwii01/geohub.git"), "geohub");
  assert.equal(repoSlug("git@github.com:Serwii01/geohub.git"), "geohub");
  assert.equal(repoSlug(null), null);
});

test("seguridad: bloquea .env, claves y rutas fuera del proyecto", () => {
  const dir = mkdtempSync(join(tmpdir(), "hub-test-"));
  try {
    mkdirSync(join(dir, "src"));
    for (const f of [".env", ".env.local", ".env.example", "id.pem", "src/a.ts"]) writeFileSync(join(dir, f), "x");
    const p = { path: dir };
    for (const f of [".env", ".env.local", "id.pem", "node_modules/a.js", ".git/config"]) assert.throws(() => safePath(p, f), /bloqueado/);
    assert.throws(() => safePath(p, "../fuera.txt"), /fuera del proyecto/);
    assert.equal(readProjectFile(p, ".env.example"), "x");
    assert.equal(readProjectFile(p, "src/a.ts"), "x");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const base = { name: "x", branch: "main", ahead: 0, behind: 0, uncommitted: 0, hasStatusMd: true, hasClaudeMd: true, prioridad: "media", nextSteps: ["Hacer la cosa pendiente"], lastCommit: { daysAgo: 2 } };
const codigos = (p) => computeAvisos(p).map((a) => a.codigo);

test("avisos: proyecto al día no tiene ninguno y sigue con su paso", () => {
  const p = { ...base, avisos: computeAvisos(base) };
  assert.deepEqual(p.avisos, []);
  assert.equal(siguienteAccion(p), "Seguir con: Hacer la cosa pendiente");
});

test("avisos: commits por bajar va primero y cambia si hay cambios locales", () => {
  const p = { ...base, behind: 2, statusStale: true, unloggedCount: 3 };
  assert.deepEqual(codigos(p), ["commits_por_bajar", "ficha_desactualizada"]);
  assert.match(computeAvisos(p)[0].accion, /git pull/);
  assert.match(computeAvisos({ ...p, uncommitted: 1 })[0].accion, /pregunta/);
});

test("avisos: ramas divergidas prohíben force push", () => {
  const a = computeAvisos({ ...base, behind: 1, ahead: 1 })[0];
  assert.equal(a.codigo, "ramas_divergidas");
  assert.match(a.accion, /nunca hagas force push/);
});

test("avisos: rama con otro nombre da el comando de push correcto", () => {
  const a = computeAvisos({ ...base, branch: "feature/x", upstream: "origin/main" }).find((x) => x.codigo === "rama_con_otro_nombre");
  assert.match(a.accion, /git push origin HEAD:main/);
});

test("avisos: rutas generadas, fuentes y reglas del proyecto", () => {
  const c = codigos({ ...base, noEditar: ["src/themes/"], fuentes: ["drogedex-nave"], fuenteDe: "drogedex", reglas: ["Nunca incluir dosis"] });
  for (const x of ["no_editar", "tiene_fuentes", "fuente_de_otro", "regla"]) assert.ok(c.includes(x), x);
});

test("siguienteAccion ignora los avisos informativos", () => {
  const p = { ...base, noEditar: ["dist/"] };
  assert.equal(siguienteAccion({ ...p, avisos: computeAvisos(p) }), "Seguir con: Hacer la cosa pendiente");
});

test("calidad de fichas", () => {
  assert.deepEqual(lintStatus({ text: "", estado: "Va bien", steps: [{ done: false, text: "Publicar la web en Vercel" }] }), []);
  const m = lintStatus({ text: "### AAAA-MM-DD", estado: "", steps: [{ done: false, text: "Mejorar todo" }] });
  assert.equal(m.length, 3);
  assert.equal(lintStatus({ text: "", estado: "x", steps: [] })[0], "No hay siguientes pasos pendientes.");
  assert.equal(lintClaudeMd("# Proyecto\nTexto suelto.").length, 1);
  assert.equal(lintClaudeMd("## Comandos\nnpm run dev").length, 0);
});

test("upsertBlock conserva lo demás y no duplica", () => {
  const bloque = (t) => `<!-- project-hub:inicio (lo genera npm run instalar; no editar a mano) -->\n${t}\n<!-- project-hub:fin -->`;
  const uno = upsertBlock("# Mis notas\nHola\n", bloque("v1"));
  assert.ok(uno.startsWith("# Mis notas\nHola\n"));
  const dos = upsertBlock(uno + "\nFinal\n", bloque("v2"));
  assert.equal(dos.match(/project-hub:inicio/g).length, 1);
  assert.ok(dos.includes("v2") && !dos.includes("v1") && dos.includes("Final") && dos.includes("Hola"));
  assert.equal(upsertBlock("", bloque("v1")), bloque("v1") + "\n");
});

test("mergeHooks conserva hooks ajenos y no duplica los suyos", () => {
  const ajeno = { matcher: "Bash", hooks: [{ type: "command", command: "echo hola" }] };
  const una = mergeHooks({ model: "x", hooks: { Stop: [{ hooks: [{ type: "command", command: "echo fin" }] }], PreToolUse: [ajeno] } });
  const dos = mergeHooks(una);
  assert.equal(dos.model, "x");
  assert.deepEqual(dos.hooks.PreToolUse, [ajeno]);
  assert.equal(dos.hooks.Stop.length, 2);
  assert.equal(dos.hooks.SessionStart.length, 1);
  assert.equal(dos.hooks.Stop[0].hooks[0].command, "echo fin");
});
