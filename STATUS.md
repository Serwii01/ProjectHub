# Estado del proyecto

> Lo mantiene Claude con `/cerrar`. Es la memoria de trabajo: dónde se quedó y qué viene después.

## Estado actual
Funcionando y en GitHub (`Serwii01/ProjectHub`): registro de proyectos, servidor MCP `project-hub` (10 herramientas), skills, reglas globales, hooks `SessionStart` y `Stop`, dashboard en localhost:4310 e instalador para varios equipos. El hub dice a Claude qué hacer en cada caso con `siguienteAccion` y `avisos`. Instalado en el equipo de clase; en el de casa falta `git pull` + `npm run instalar` y reiniciar Claude Code.

## Siguientes pasos
- [ ] Botón «Sincronizar todo» en el dashboard (pull/push en avance rápido, con confirmación)
- [ ] Aviso al abrir el dashboard si hay proyectos con trabajo del otro equipo sin bajar
- [ ] Informe semanal (`weekly_report`) a partir de las sesiones de todos los STATUS.md
- [ ] En casa: `git pull` + `npm run instalar` en ProjectHub y reiniciar Claude Code (cambian MCP, skills, reglas globales y hooks)
- [ ] Confirmar las prioridades de roam, drogedex, cinearchive, drogedex-nave, drogedex-beton y ProjectHub, y ocultar el repo antiguo `PlanifyPlus` (JavaFX) de la lista de no clonados
- [ ] Comprobar en una sesión real que los hooks `SessionStart` y `Stop` se disparan (solo se han probado ejecutándolos a mano)

## Última sesión

### 2026-11-05
- Reglas globales en `~/.claude/CLAUDE.md` y hooks `SessionStart` y `Stop`: el hub ya no depende de que se use una skill.
- `computeAvisos` y `siguienteAccion`: cada situación trae su instrucción exacta, y la reciben MCP, hook y dashboard.
- `list_projects` hace `git fetch`; nombres ambiguos ya no se resuelven al azar; `update_status` informa de pasos no encontrados o ambiguos.
- Nueva herramienta `hub_health`; relaciones `fuenteDe`, `noEditar` y `reglas` en `hub.config.json`; ProjectHub entra en su propio registro.
- Skills reescritas con tablas de casos y formato fijo. 20 tests del núcleo (`npm test`). Fichas de drogedex-nave y drogedex-beton.
- Rendimiento: `list_projects` de 14 a 6 s; caché de 5 s en el dashboard.

### 2026-10-28
- Arreglada la lectura de STATUS.md con saltos de línea CRLF (los pasos no salían en rukujack y cinearchive; en casa habría afectado a todos).
- Detección de fichas desactualizadas: `statusStale` / `unloggedCommits` en el núcleo y el MCP, aviso en tarjeta y detalle del dashboard, y `/retomar` y `/cerrar` las tienen en cuenta.
- `update_status` acepta `fecha` para anotar sesiones de días anteriores (une entradas del mismo día y ordena por fecha).
- Dashboard: última actividad real en git con día y hora, separada de la última sesión anotada.
- Puesta al día de la ficha de cinearchive con los 18 commits del 27 oct hechos sin `/cerrar`.
- Fusionada la exclusión de la carpeta `TFG` hecha desde el otro equipo.
- Detección de stacks ampliada: Astro, Next.js, Nuxt, Svelte, Express, Drizzle, Firebase, Leaflet y Three.js (cinearchive, CreaFlow y drogedex ya salen con su stack completo).
- Usado en un caso real: `/retomar drogedex` → fichas creadas y fusión de los tres diseños de drogedex publicada (el trabajo está anotado en el STATUS.md de drogedex).

### 2026-10-27
- Creado el hub: núcleo `lib/hub.mjs`, escáner, servidor MCP, skills y dashboard.
- `CLAUDE.md` y `STATUS.md` creados en GeoHub, PlanifyPlus, CreaFlow, PrestArte, ropa y rukujack, y subidos (con merge del trabajo de otro equipo en PrestArte y rukujack).
- Uso en varios equipos: `hub.config.json` común + `hub.local.json` por equipo, repos de GitHub no clonados con «Clonar aquí» / `clone_project`, `git fetch` al actualizar y al retomar, e instalador `npm run instalar`.
- README completo y repo publicado en GitHub.

## Decisiones
- Las fichas viven dentro de cada repo (no en el hub) para que viajen con él por GitHub entre equipos.
- Toda la lógica en `lib/hub.mjs`, compartida por MCP, dashboard y CLI, para que vean los mismos datos.
- El MCP y el dashboard nunca hacen commit, push ni borrados; eso lo hace Claude preguntando.
- Cada carpeta se empareja con su ficha por el nombre del repo en GitHub (campo `repo`), no por el nombre de la carpeta.
- Una ficha está desactualizada si hay commits con trabajo posteriores al último commit que tocó STATUS.md; si STATUS.md tiene cambios sin commit, se da por recién actualizada.
- Sin `gh` CLI: la lista de repos sale de la API pública de GitHub (token opcional en `hub.local.json` para los privados).
- Las instrucciones que dependen del estado van en `computeAvisos`, no en las skills, para que las reciban también el hook y el dashboard.
- El hook `Stop` avisa una vez por sesión y nunca bloquea: se dispara en cada turno y más sería ruido.
- Un fragmento de `completados` que encaja con varios pasos no quita ninguno: se informa para evitar borrar el paso equivocado.

## Problemas conocidos
- El repo es público: muestra la lista de proyectos y sus pendientes (no hay rutas ni tokens). Se puede pasar a privado en GitHub.
- ProjectHub está excluido del propio registro, así que no aparece en el dashboard y su STATUS.md se mantiene a mano.
- No verificado: los botones «Abrir en VS Code / carpeta / terminal / GitHub» y la apariencia visual del dashboard (las capturas del panel no llegaban a dibujarse).
- La pestaña Git del detalle solo enseña los últimos 15 commits.
- Sin token, la API de GitHub limita a 60 peticiones por hora (hay caché de 15 min).
- Los hooks solo actúan si la sesión está en la carpeta del proyecto; desde otra carpeta quedan las reglas globales y los avisos del MCP.
