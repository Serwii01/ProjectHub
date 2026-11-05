# ProjectHub

Intermediario entre Claude y todos los proyectos del usuario: un registro central, un servidor MCP, skills, hooks, reglas globales y un dashboard web local.

Se usa en **varios equipos**: el código y `hub.config.json` se sincronizan por GitHub; cada equipo tiene su `hub.local.json`. El estado de cada proyecto viaja en su propio repo (`STATUS.md`), así que hay que hacer push al cerrar y pull al retomar.

## Archivos
- `hub.config.json` — común a todos los equipos: usuario de GitHub, repos ocultos, carpetas excluidas y datos por proyecto (`repo`, `descripcion`, `prioridad`, `fuenteDe`, `noEditar`, `reglas`). Se casa con cada carpeta por el nombre del repo.
- `hub.local.json` — de este equipo (no se sube): `roots`, `cloneDir` y `githubToken` opcional.
- `lib/hub.mjs` — núcleo compartido: escaneo, resolución de nombres, avisos (`computeAvisos`, `siguienteAccion`), calidad de fichas, acceso seguro a archivos, búsqueda, git, lectura y escritura de `STATUS.md`, GitHub.
- `lib/instalacion.mjs` — lo que se instala fuera del repo (skills, bloque global, hooks) y `hubHealth`.
- `mcp-server.mjs` — servidor MCP `project-hub` (stdio). Herramientas: `list_projects`, `clone_project`, `get_project_context`, `list_project_files`, `read_project_file`, `search_projects`, `git_summary`, `update_status`, `set_project_info`, `hub_health`.
- `hooks/` — `session-start.mjs` da a Claude el estado del proyecto; `stop.mjs` recuerda `/cerrar` una vez por sesión. Nunca deben romper una sesión: ante un error terminan sin decir nada.
- `skills/` — fuente de `/proyectos`, `/retomar` y `/cerrar` (`{{HUB}}` = ruta del hub).
- `templates/` — plantillas de `CLAUDE.md` y `STATUS.md`, y `claude-global.md` (reglas globales).
- `instalar.mjs` — `npm run instalar`: instala todo lo anterior en `~/.claude` con copia de seguridad. Se puede repetir.
- `dashboard.mjs` + `public/index.html` — dashboard en http://localhost:4310 (solo localhost; las escrituras exigen la cabecera `X-Hub: 1`).
- `scan.mjs` — CLI: genera `projects.json` y `PROJECTS.md`.
- `test/` — tests del núcleo.

## Cómo se trabaja
- Cada proyecto tiene en su raíz `CLAUDE.md` (cómo está hecho) y `STATUS.md` (dónde se quedó y qué sigue). ProjectHub también está en el registro.
- La lógica nueva va en `lib/hub.mjs`, con su test. Las funciones de avisos y calidad son puras: reciben datos y no leen disco.
- Una instrucción para Claude que dependa del estado del proyecto va en `computeAvisos` (campo `accion`), no en las skills: así la reciben también el hook y el dashboard. Las skills llevan el procedimiento y el formato.
- El hub nunca hace commit, push ni pull. Eso lo hace Claude con confirmación del usuario.
- Tras cambiar `lib/` o `mcp-server.mjs` hay que reiniciar Claude Code; tras cambiar `skills/` o `templates/claude-global.md`, `npm run instalar`. `hub_health` dice qué falta.

## Comandos
```bash
npm install && npm run instalar   # en un equipo nuevo (o tras cambiar skills/ o las reglas globales)
npm test                          # tests del núcleo
npm run scan                      # regenerar registro
npm run dashboard                 # abrir el dashboard
```
