# ProjectHub

Intermediario entre las IAs del usuario y todos sus proyectos: un servidor MCP válido para cualquier cliente, una CLI instalable (`projecthub`), un dashboard web local y, para Claude Code, skills, hooks y reglas globales.

Es un proyecto público (MIT) pensado para que lo instale cualquiera. El código no contiene datos de ningún usuario: la configuración vive en `~/.projecthub` (o `PROJECTHUB_HOME`). El estado de cada proyecto viaja en su propio repo (`STATUS.md`), así que hay que hacer push al cerrar y pull al retomar.

## Archivos
- `bin/projecthub.mjs` — CLI: `instalar`, `mcp`, `dashboard`, `proyectos`, `informe`, `sync`, `uso`, `clientes`, `doctor`.
- `lib/hub.mjs` — núcleo compartido: carpeta de datos (`dataDir`, `ensureData`), escaneo, resolución de nombres, avisos (`computeAvisos`, `siguienteAccion`), calidad de fichas, acceso seguro a archivos, búsqueda, git, lectura y escritura de `STATUS.md`, GitHub, informe (`workReport`), relevo (`saveHandoff`, `readHandoff`), estado de cada equipo (`saveMachineState`, `pendingElsewhere`), búsqueda en lo anotado (`searchNotes`) y plan de sincronización (`syncPlan`, `runSyncPlan`).
- `lib/clientes.mjs` — clientes de IA conocidos (dónde guarda cada uno sus servidores MCP) y registro del servidor en ellos, con copia de seguridad.
- `lib/resumen.mjs` — lo que ahorra tokens: contexto breve (`briefContext`), panorama en tabla (`projectsTable`), mapa del proyecto (`projectMap`), registro de consumo y sincronización de la carpeta de datos (`syncData`, `syncSetup`).
- `lib/instalacion.mjs` — extras de Claude Code (skills, bloque global, hooks), prompts MCP a partir de las skills y `hubHealth`.
- `mcp-server.mjs` — servidor MCP `project-hub` (stdio). Herramientas: `list_projects`, `clone_project`, `get_project_context`, `list_project_files`, `read_project_file`, `search_projects`, `git_summary`, `update_status`, `save_handoff`, `get_project_map`, `search_notes`, `work_report`, `set_project_info`, `hub_health`. Prompts: `proyectos`, `retomar`, `cerrar`, `relevo`.
- `hooks/` — `session-start.mjs` da a Claude el estado del proyecto; `stop.mjs` recuerda `/cerrar` una vez por sesión. Nunca deben romper una sesión: ante un error terminan sin decir nada.
- `skills/` — procedimientos de `/proyectos`, `/retomar`, `/cerrar` y `/relevo`. Son a la vez las skills de Claude Code y los prompts MCP (`{{HUB}}` = carpeta del código, `{{DATA}}` = carpeta de datos).
- `templates/` — plantillas de las fichas (`STATUS.md` y `STATUS.en.md`) y `claude-global.md` (reglas globales de Claude Code).
- `instalar.mjs` — instalador: carpeta de datos, servidor MCP en los clientes detectados y extras de Claude Code. Se puede repetir.
- `dashboard.mjs` + `public/index.html` — dashboard en http://localhost:4310 (solo localhost; las escrituras exigen la cabecera `X-Hub: 1`).
- `scan.mjs` — genera `projects.json` y `PROJECTS.md` en la carpeta de datos.
- `test/` — `hub.test.mjs` (núcleo), `multi.test.mjs` (datos, clientes, informe y el servidor MCP por stdio) y `ahorro.test.mjs` (presupuestos de tokens, relevo, equipos y sync) y `memoria.test.mjs` (búsqueda en lo anotado, sincronizar todo y fichas en inglés).

## Datos del usuario (`~/.projecthub`)
- `config.json` — común a los equipos del usuario: cuenta de GitHub, repos ocultos, carpetas excluidas y datos por proyecto (`repo`, `descripcion`, `prioridad`, `fuenteDe`, `noEditar`, `reglas`). Se casa con cada carpeta por el nombre del repo.
- `local.json` — de cada equipo: `roots`, `cloneDir`, `equipo` (nombre con el que lo ven los demás) y `githubToken` opcional.
- `equipos/<nombre>.json` — proyectos con trabajo sin subir en cada equipo. Se sincroniza.
- `cache/` (GitHub, mapas, consumo), `backups/`, `projects.json`, `PROJECTS.md` — generados.
- Si la carpeta es un repo git (`projecthub sync --remote`), el servidor la baja al retomar y la sube al cerrar.
- `hub.config.json` y `hub.local.json` en la raíz del repo son restos de la versión 1: `ensureData` los copia la primera vez y ya no se leen.

## En cada repo del usuario
- `STATUS.md` — estado, siguientes pasos y las 5 últimas sesiones. Las anteriores pasan a `HISTORY.md`.
- `.projecthub/relevo.md` — trabajo a medias de un chat; se borra al cerrar la sesión.

## Idioma
- `STATUS.md` puede estar en español o en inglés: los apartados se reconocen en los dos (`SECCIONES` en `lib/hub.mjs`) y una ficha conserva el idioma de sus títulos. `idioma` en `config.json` decide el de las fichas nuevas.
- El resto (avisos, descripciones de herramientas, skills, CLI, dashboard) está en español. `README.en.md` es el resumen en inglés.

## Cómo se trabaja
- **Los tokens son el presupuesto.** Toda respuesta del servidor es breve por defecto y el detalle se pide aparte. Una herramienta o un campo nuevo lleva su test con un máximo de tokens. Las descripciones de las herramientas también cuentan: van en cada conversación.
- Nada propio de un usuario o de una IA concreta en el código: ni rutas, ni nombres de proyectos, ni «Claude» en textos que reciben todos los clientes.
- El archivo de contexto de un proyecto es el primero que exista de `CONTEXT_FILES` (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`…).
- La lógica nueva va en `lib/hub.mjs`, con su test. Las funciones de avisos y calidad son puras: reciben datos y no leen disco.
- Una instrucción para la IA que dependa del estado del proyecto va en `computeAvisos` (campo `accion`), no en las skills: así la reciben todos los clientes, el hook y el dashboard.
- Los tests no tocan la carpeta real del usuario: apuntan `PROJECTHUB_HOME` y el home a carpetas temporales.
- El hub nunca hace commit, push ni pull en los proyectos. Eso lo hace la IA con confirmación del usuario. Las dos excepciones son su propia carpeta de datos, con `sync`, y el botón «Sincronizar» del dashboard (`/api/sync`), que solo hace avance rápido tras enseñar el plan y nunca se expone por MCP.
- Tras cambiar `lib/` o `mcp-server.mjs` hay que reiniciar el cliente de IA; tras cambiar `skills/` o `templates/claude-global.md`, volver a instalar. `hub_health` (o `npm run doctor`) dice qué falta.

## Comandos
```bash
npm install && npm run instalar   # en un equipo nuevo, o tras cambiar skills/ o las reglas globales
npm test                          # todos los tests
npm run doctor                    # estado de la instalación
npm run dashboard                 # abrir el dashboard
```
