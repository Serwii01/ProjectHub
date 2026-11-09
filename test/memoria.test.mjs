// Tests de la búsqueda en lo anotado, de «Sincronizar todo» y de las fichas en inglés.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { notesOf, parseSessions, readStatus, runSyncPlan, searchNotes, syncPlan, updateStatus } from "../lib/hub.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "hub-memoria-"));
const borrar = (dir) => rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
const git = (dir, ...args) => execFileSync("git", ["-C", dir, "-c", "user.name=test", "-c", "user.email=test@test", ...args], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();

const STATUS = `# Estado

## Estado actual
Funciona el carrito; falta el pago.

## Siguientes pasos
- [ ] Integrar la pasarela de pago

## Última sesión

### 2026-11-08
- Login con sesiones en vez de JWT.

## Decisiones
- Sesiones en el servidor y no JWT: así se puede cerrar la sesión desde el panel.
- Sin base de datos propia.

## Problemas conocidos
<!-- Bugs, deuda técnica -->
- El envío de correos no se ha probado en producción.
`;
const HISTORY = "# Historial de sesiones\n\n> Sesiones antiguas.\n\n### 2026-09-02\n- Primera versión del catálogo con paginación.\n";

test("notesOf saca decisiones, problemas, estado y sesiones, también las del historial", () => {
  const notas = notesOf(STATUS, HISTORY);
  assert.deepEqual(notas.map((n) => n.tipo), ["Decisión", "Decisión", "Problema", "Estado", "Sesión 2026-11-08", "Sesión 2026-09-02"]);
  assert.equal(notas[3].texto, "Funciona el carrito; falta el pago.");
  assert.deepEqual(notesOf("", ""), []);
});

test("searchNotes encuentra por todas las palabras, sin acentos ni mayúsculas, sin leer código", () => {
  const dir = tmp();
  try {
    for (const [name, status, hist] of [["tienda", STATUS, HISTORY], ["blog", STATUS.replace(/JWT/g, "tokens"), ""], ["vacio", null, ""]]) {
      mkdirSync(join(dir, name));
      if (status) writeFileSync(join(dir, name, "STATUS.md"), status);
      if (hist) writeFileSync(join(dir, name, "HISTORY.md"), hist);
    }
    const projects = ["tienda", "blog", "vacio"].map((name) => ({ name, path: join(dir, name) }));
    const r = searchNotes("SESION jwt", { projects });
    assert.deepEqual(r.map((x) => [x.project, x.total]), [["tienda", 2]]);
    assert.deepEqual(r[0].notas, [
      "Decisión: Sesiones en el servidor y no JWT: así se puede cerrar la sesión desde el panel.",
      "Sesión 2026-11-08: Login con sesiones en vez de JWT.",
    ]);
    assert.deepEqual(searchNotes("paginación", { projects })[0].notas, ["Sesión 2026-09-02: Primera versión del catálogo con paginación."]);
    assert.equal(searchNotes("correos produccion", { projects }).length, 2);
    assert.deepEqual(searchNotes("kubernetes", { projects }), []);
    assert.throws(() => searchNotes(" a ", { projects }), /al menos una palabra/);
  } finally {
    borrar(dir);
  }
});

test("syncPlan: solo avance rápido; lo dudoso se deja y se explica", () => {
  const p = (name, extra) => ({ name, path: `/p/${name}`, branch: "main", upstream: "origin/main", ahead: 0, behind: 0, uncommitted: 0, ...extra });
  const plan = syncPlan([
    p("al-dia"),
    p("bajar", { behind: 2 }),
    p("subir", { ahead: 3, uncommitted: 4 }),
    p("divergido", { ahead: 1, behind: 1 }),
    p("sucio", { behind: 1, uncommitted: 2 }),
    p("otra-rama", { ahead: 1, branch: "dev" }),
    p("solo-cambios", { uncommitted: 5 }),
  ]);
  assert.deepEqual(plan.acciones.map((a) => [a.name, a.accion, a.n]), [["bajar", "pull", 2], ["subir", "push", 3]]);
  assert.deepEqual(plan.omitidos.map((o) => o.name), ["divergido", "sucio", "otra-rama"]);
  assert.match(plan.omitidos[1].motivo, /2 archivos sin commit/);
});

test("runSyncPlan baja y sube de verdad, y cuenta lo que falla sin tocar nada", async () => {
  const base = tmp();
  try {
    const remoto = join(base, "remoto.git");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", remoto]);
    const a = join(base, "a");
    const b = join(base, "b");
    execFileSync("git", ["clone", "-q", remoto, a], { stdio: "ignore" });
    writeFileSync(join(a, "uno.txt"), "1");
    git(a, "add", "-A");
    git(a, "commit", "-q", "-m", "uno");
    git(a, "push", "-q", "-u", "origin", "main");
    execFileSync("git", ["clone", "-q", remoto, b], { stdio: "ignore" });
    writeFileSync(join(a, "dos.txt"), "2");
    git(a, "add", "-A");
    git(a, "commit", "-q", "-m", "dos");

    const r = await runSyncPlan([{ name: "a", path: a, accion: "push", n: 1 }]);
    assert.deepEqual(r, [{ name: "a", accion: "push", n: 1, ok: true }]);
    git(b, "fetch", "-q");
    assert.deepEqual(await runSyncPlan([{ name: "b", path: b, accion: "pull", n: 1 }]), [{ name: "b", accion: "pull", n: 1, ok: true }]);
    assert.equal(readFileSync(join(b, "dos.txt"), "utf8"), "2");

    // Si entre el plan y la ejecución las ramas divergen, el pull en avance rápido falla y no cambia nada
    writeFileSync(join(a, "tres.txt"), "3");
    git(a, "add", "-A");
    git(a, "commit", "-q", "-m", "tres");
    git(a, "push", "-q");
    writeFileSync(join(b, "local.txt"), "x");
    git(b, "add", "-A");
    git(b, "commit", "-q", "-m", "local");
    const antes = git(b, "rev-parse", "HEAD");
    const [mal] = await runSyncPlan([{ name: "b", path: b, accion: "pull", n: 1 }]);
    assert.equal(mal.ok, false);
    assert.ok(mal.error.length > 0);
    assert.equal(git(b, "rev-parse", "HEAD"), antes);
  } finally {
    borrar(base);
  }
});

test("fichas en inglés: se crean con idioma en, se leen igual y conservan sus títulos", () => {
  const dir = tmp();
  try {
    const p = { path: dir };
    updateStatus(p, { idioma: "en", estado: "Cart works; payment missing.", sesion: ["Added the cart."], fecha: "2026-11-09", nuevosPasos: ["Integrate the payment gateway"], decisiones: ["No database of our own."] });
    const text = readFileSync(join(dir, "STATUS.md"), "utf8");
    for (const titulo of ["## Current status", "## Next steps", "## Last session", "## Decisions", "## Known issues"]) assert.ok(text.includes(titulo), titulo);
    assert.ok(!/Estado actual|Siguientes pasos|AAAA-MM-DD/.test(text));
    const s = readStatus(dir);
    assert.equal(s.estado, "Cart works; payment missing.");
    assert.deepEqual(s.steps, [{ done: false, text: "Integrate the payment gateway" }]);
    assert.deepEqual(parseSessions(text), [{ fecha: "2026-11-09", puntos: ["Added the cart."] }]);
    assert.deepEqual(notesOf(text).map((n) => n.tipo), ["Decisión", "Estado", "Sesión 2026-11-09"]);

    // Una ficha que ya está en inglés sigue en inglés aunque no se indique el idioma
    const dos = updateStatus(p, { completados: ["payment gateway"], problemas: ["Emails untested."] });
    assert.deepEqual(dos.cambios.pasosQuitados, ["Integrate the payment gateway"]);
    const despues = readFileSync(join(dir, "STATUS.md"), "utf8");
    assert.match(despues, /## Known issues\n+- Emails untested\./);
    assert.ok(!despues.includes("Problemas conocidos"));
  } finally {
    borrar(dir);
  }
});
