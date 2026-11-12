# Estado del proyecto

> Lo mantiene Claude con `/cerrar`. Es la memoria de trabajo: dónde se quedó y qué viene después.

## Estado actual
Versión 2.0 en GitHub (`Serwii01/ProjectHub`, MIT) con una ronda de ahorro de tokens sin subir: 9 herramientas, contexto breve en texto, skills y reglas globales mínimas, y avisos cuando el hub está desactualizado o sin reinstalar. Instalada en el equipo de clase; falta en el otro equipo. La sincronización entre equipos (`projecthub sync`) sigue sin activar.

## Siguientes pasos
- [ ] Confirmar las prioridades de roam, drogedex, cinearchive, drogedex-nave, drogedex-beton y ProjectHub, y ocultar el repo antiguo `PlanifyPlus` (JavaFX) de la lista de no clonados
- [ ] Reiniciar los clientes de IA y comprobar que `project-hub` aparece en Gemini CLI, VS Code, Antigravity y Claude Desktop
- [ ] Activar la sincronización entre equipos: crear un repo privado vacío y ejecutar `projecthub sync --remote <url>` en clase y en casa; poner nombre a cada equipo con `projecthub instalar --equipo`
- [ ] Acortar los STATUS.md de cinearchive, adminscinearchive y roam, que pasan del presupuesto de 1.500 tokens
- [ ] Traducir al inglés la CLI, el dashboard, los avisos y las descripciones de las herramientas
- [ ] Publicar el paquete en npm como `projecthub` (hace falta cuenta de npm; hoy se instala desde GitHub)
- [ ] Borrar la rama local `version-2`, ya fusionada en main
- [ ] Reiniciar Claude Code y comprobar que el servidor tiene 9 herramientas y que el hook `Stop` recuerda `/cerrar` en una sesión real (`SessionStart` ya funciona)
- [ ] En el otro equipo: `git pull`, `npm ci`, `npm run instalar` y reiniciar el cliente de IA
- [ ] Informe semanal: crear una tarea programada (viernes 14:00) que llame a `work_report` con 7 días; la creación la bloqueó el control de permisos
- [ ] Tras una semana de uso, revisar `projecthub uso` y recortar la herramienta que más tokens devuelva

## Última sesión

### 2026-11-12
- Menos tokens fijos: instrucciones del servidor ~400→170, definiciones de herramientas ~3.500→1.600, bloque global ~420→145 y skills ~1.200→~340, todo con test de máximo.
- De 14 a 9 herramientas: `git_summary`, `list_project_files`, `search_notes`/`search_projects`, `set_project_info` y `hub_health` pasan a opciones de `get_project_context` (detalle), `get_project_map` (path), `search` (en), `update_status` (prioridad, descripcion) y avisos del hub.
- Contexto breve en texto (`briefText`): primero los avisos o «Ahora», 3 pasos, estado cortado; media de 525→354 tokens. El hook `SessionStart` da el mismo texto y `/retomar` no lo repite. `update_status` y `save_handoff` responden en 2–4 líneas.
- Avisos del hub: `hub_desactualizado` (servidor más viejo que su código) y `hub_sin_instalar`; cada equipo anota su versión del hub y `doctor`/`list_projects` avisan de equipos atrasados. `projecthub uso` enseña el coste fijo.
- Documentación con `npm ci`. CI comprobado en verde en Linux, Windows y macOS (Node 20 y 22). 53 tests; reinstalado en este equipo.

### 2026-11-10
- Versión 2.0: datos del usuario en `~/.projecthub`, CLI `projecthub` e instalador que registra el MCP en Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, Gemini CLI, Antigravity y Codex.
- Menos tokens: contexto breve por defecto, panorama en tabla, `get_project_map`, lecturas por rango, presupuesto de STATUS.md con `HISTORY.md` y `projecthub uso`. En los 23 proyectos: panorama de ~13.500 a ~1.300 tokens; retomar, de ~2.100 a ~400 de media.
- Continuidad: `save_handoff` y `/relevo`, aviso `sin_subir_en_otro_equipo`, `projecthub sync` y `search_notes` (decisiones y sesiones de todos los proyectos).
- Dashboard: botón «Sincronizar» (plan, confirmación, solo avance rápido), aviso de trabajo sin bajar y soporte de macOS y Linux. `work_report` y `projecthub informe`.
- Fichas en español o inglés (`--idioma en`), `README.en.md`, licencia MIT y CI en tres sistemas. 48 tests. Instalado en este equipo y subido a main.

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
- La configuración sale del repo y vive en `~/.projecthub`: así el hub se instala con npm y el repo público no lleva datos de nadie. Entre equipos se sincroniza con `projecthub sync` (un repo privado del usuario).
- Las respuestas del servidor son breves por defecto y el detalle se pide aparte; cada una tiene un test con su máximo de tokens. Reducir tokens es un objetivo del proyecto, no una optimización.
- Dos excepciones a «el hub no hace commit ni push»: su propia carpeta de datos (`sync`) y el botón «Sincronizar» del dashboard, que solo hace avance rápido tras confirmación y no se expone por MCP.
- El relevo vive en `.projecthub/relevo.md` dentro del repo y no en STATUS.md, para que guardarlo no haga pasar por anotados los commits pendientes.
- Cada herramienta nueva cabe primero como opción de una existente; lo fijo (instrucciones, definiciones, bloque global, skills) tiene test con máximo de tokens.
- El contexto breve es texto, no JSON: el primer aviso o la línea «Ahora» dicen qué hacer, sin campo `siguienteAccion` aparte.

## Problemas conocidos
- El repo es público. `hub.config.json` (lista de proyectos, sin rutas ni tokens) ya no se versiona, pero sigue en el historial de git.
- No verificado: los botones «Abrir en VS Code / carpeta / terminal / GitHub» del dashboard.
- La pestaña Git del detalle solo enseña los últimos 15 commits.
- Sin token, la API de GitHub limita a 60 peticiones por hora (hay caché de 15 min).
- Los hooks solo actúan si la sesión está en la carpeta del proyecto; desde otra carpeta quedan las reglas globales y los avisos del MCP.
- Sin verificar en real: la sincronización entre los dos equipos, el botón «Sincronizar» sobre repos reales, y las rutas de configuración de Cursor, Windsurf, Codex y Antigravity (salen de su documentación).
- El inglés es parcial: solo las fichas y el README.
