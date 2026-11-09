#!/usr/bin/env node
// CLI de ProjectHub. Un solo comando para todo: `projecthub <orden>`.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8"));
const [orden = "ayuda"] = process.argv.slice(2);

const AYUDA = `ProjectHub ${version} — tus proyectos y su estado, al alcance de cualquier IA

Uso: projecthub <orden> [opciones]

  instalar     Prepara este equipo: carpeta de datos, servidor MCP en tus clientes de IA
               y extras de Claude Code. Se puede repetir.
                 --clientes a,b | todos | ninguno    --roots dir1,dir2
                 --github usuario                    --sin-extras
  mcp          Arranca el servidor MCP por stdio (lo que ejecutan los clientes de IA)
  dashboard    Abre el dashboard web local (http://localhost:4310). --no-open para no abrir el navegador
  proyectos    Tabla con el estado de todos los proyectos. --json para el registro completo
  informe      Qué se ha hecho en los últimos días. --dias N (por defecto 7)
  sync         Sincroniza la configuración entre tus equipos. La primera vez: --remote <url de un repo privado>
  uso          Tokens que ha devuelto cada herramienta a la IA
  clientes     Clientes de IA conocidos, cuáles hay en este equipo y si tienen el servidor
  doctor       Comprueba la instalación y dice cómo arreglar lo que falle
  version      Muestra la versión

Datos y configuración: ~/.projecthub (o la carpeta de PROJECTHUB_HOME)
`;

const opcion = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? def : process.argv[i + 1];
};

switch (orden) {
  case "instalar":
  case "install":
  case "init":
    await import("../instalar.mjs");
    break;
  case "mcp":
    await import("../mcp-server.mjs");
    break;
  case "dashboard":
    if (!process.argv.includes("--no-open") && !process.argv.includes("--open")) process.argv.push("--open");
    await import("../dashboard.mjs");
    break;
  case "proyectos":
  case "scan":
    await import("../scan.mjs");
    break;
  case "informe": {
    const { fetchProjects, workReport } = await import("../lib/hub.mjs");
    await fetchProjects();
    const r = workReport({ dias: Number(opcion("dias", 7)) });
    console.log(`Trabajo del ${r.desde} al ${r.hasta} (${r.diasConSesion} días con sesión anotada)\n`);
    for (const p of r.proyectos) {
      console.log(`${p.project}`);
      for (const s of p.sesiones) console.log(`  ${s.fecha}\n${s.puntos.map((x) => `    - ${x}`).join("\n")}`);
      if (p.commitsSinAnotar) console.log(`  sin anotar en STATUS.md:\n${p.commitsSinAnotar.map((x) => `    - ${x}`).join("\n")}`);
      console.log();
    }
    if (!r.proyectos.length) console.log("Sin actividad anotada en ese periodo.");
    break;
  }
  case "sync": {
    const { syncActivo, syncData, syncSetup } = await import("../lib/resumen.mjs");
    const { dataDir, ensureData, scanProjects } = await import("../lib/hub.mjs");
    ensureData();
    const remoto = opcion("remote");
    if (remoto) {
      scanProjects(); // anota el estado de este equipo antes de subir
      const r = await syncSetup(remoto);
      console.log(r.ok ? `Sincronización activada: ${dataDir()} ↔ ${remoto} (rama ${r.rama}).\nA partir de ahora el hub baja y sube la configuración solo. En tus otros equipos, ejecuta este mismo comando.` : `No se pudo activar: ${r.error}`);
      process.exitCode = r.ok ? 0 : 1;
    } else if (!syncActivo()) {
      console.log(`La sincronización entre equipos no está activada.\nCrea un repo privado vacío (por ejemplo, en GitHub) y ejecuta:\n  projecthub sync --remote <url del repo>\nSe sincronizan prioridades, descripciones, reglas y el trabajo sin subir de cada equipo. No se suben local.json (rutas y token) ni la caché.`);
    } else {
      scanProjects();
      const r = await syncData();
      console.log(r.remoto === false ? "La carpeta de datos es un repo, pero no tiene remoto. Añádelo con: projecthub sync --remote <url>" : r.ok ? "Configuración sincronizada." : r.error);
      process.exitCode = r.ok || r.remoto === false ? 0 : 1;
    }
    break;
  }
  case "uso": {
    const { usageReport } = await import("../lib/resumen.mjs");
    const filas = usageReport();
    if (!filas.length) console.log("Aún no hay datos: se registran cuando una IA usa las herramientas.");
    else {
      console.log("Tokens aproximados que ha devuelto cada herramienta a la IA\n");
      console.log(`  ${"herramienta".padEnd(22)} ${"llamadas".padStart(8)} ${"media".padStart(7)} ${"máx".padStart(7)} ${"total".padStart(9)}`);
      for (const f of filas) console.log(`  ${f.tool.padEnd(22)} ${String(f.llamadas).padStart(8)} ${String(f.media).padStart(7)} ${String(f.max).padStart(7)} ${String(f.tokens).padStart(9)}`);
    }
    break;
  }
  case "clientes": {
    const { clientes, estaRegistrado } = await import("../lib/clientes.mjs");
    const { existsSync } = await import("node:fs");
    for (const c of clientes()) {
      const estado = !existsSync(c.detect) ? "no encontrado" : estaRegistrado(c) ? "servidor registrado" : "encontrado, sin registrar";
      console.log(`  ${c.id.padEnd(15)} ${c.nombre.padEnd(18)} ${estado}`);
    }
    break;
  }
  case "doctor": {
    const { hubHealth } = await import("../lib/instalacion.mjs");
    const h = hubHealth();
    console.log(`ProjectHub ${h.version} · datos en ${h.datos}\nClientes de IA: ${h.clientes.join(", ") || "ninguno encontrado"}\nSincronización entre equipos: ${h.sync}\n`);
    if (h.ok) console.log("Todo en orden.");
    for (const p of h.problemas) console.log(`  ! ${p.mensaje}\n    → ${p.accion}`);
    process.exitCode = h.ok ? 0 : 1;
    break;
  }
  case "version":
  case "--version":
  case "-v":
    console.log(version);
    break;
  case "ayuda":
  case "help":
  case "--help":
  case "-h":
    console.log(AYUDA);
    break;
  default:
    console.error(`Orden desconocida: ${orden}\n\n${AYUDA}`);
    process.exitCode = 1;
}
