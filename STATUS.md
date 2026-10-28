# Estado del proyecto

> Lo mantiene Claude con `/cerrar`. Es la memoria de trabajo: dónde se quedó y qué viene después.

## Estado actual
Funcionando y en GitHub (`Serwii01/ProjectHub`): registro de proyectos, servidor MCP `project-hub` (9 herramientas), skills `/proyectos`, `/retomar` y `/cerrar`, dashboard en localhost:4310 e instalador para varios equipos. Detecta repos de GitHub no clonados, commits por bajar o sin subir y fichas desactualizadas (commits sin anotar en STATUS.md). Instalado en el equipo de clase; en el de casa hay que hacer `git pull` + `npm run instalar` y reiniciar Claude Code.

## Siguientes pasos
- [ ] En casa: `git pull` + `npm run instalar` en ProjectHub y reiniciar Claude Code (las skills y el MCP cambiaron el 28 oct)
- [ ] Recordatorio automático de `/cerrar`: hook de Claude Code al terminar la sesión si hubo commits y STATUS.md no se actualizó
- [ ] Botón «Sincronizar todo» en el dashboard (pull/push en avance rápido, con confirmación)
- [ ] Aviso al abrir el dashboard si hay proyectos con trabajo del otro equipo sin bajar
- [ ] Dar prioridad y descripción a cinearchive en `hub.config.json` y ocultar el repo antiguo `PlanifyPlus` (JavaFX) de la lista de no clonados
- [ ] Tests automáticos del núcleo (lectura/escritura de STATUS.md con LF y CRLF, reglas de seguridad)
- [ ] Informe semanal (`weekly_report`) a partir de las sesiones de todos los STATUS.md

## Última sesión
### 2026-10-28
- Arreglada la lectura de STATUS.md con saltos de línea CRLF (los pasos no salían en rukujack y cinearchive; en casa habría afectado a todos).
- Detección de fichas desactualizadas: `statusStale` / `unloggedCommits` en el núcleo y el MCP, aviso en tarjeta y detalle del dashboard, y `/retomar` y `/cerrar` las tienen en cuenta.
- `update_status` acepta `fecha` para anotar sesiones de días anteriores (une entradas del mismo día y ordena por fecha).
- Dashboard: última actividad real en git con día y hora, separada de la última sesión anotada.
- Puesta al día de la ficha de cinearchive con los 18 commits del 27 oct hechos sin `/cerrar`.
- Fusionada la exclusión de la carpeta `TFG` hecha desde el otro equipo.

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

## Problemas conocidos
- El repo es público: muestra la lista de proyectos y sus pendientes (no hay rutas ni tokens). Se puede pasar a privado en GitHub.
- ProjectHub está excluido del propio registro, así que no aparece en el dashboard y su STATUS.md se mantiene a mano.
- No verificado: los botones «Abrir en VS Code / carpeta / terminal / GitHub» y la apariencia visual del dashboard (las capturas del panel no llegaban a dibujarse).
- La pestaña Git del detalle solo enseña los últimos 15 commits.
- Sin token, la API de GitHub limita a 60 peticiones por hora (hay caché de 15 min).
