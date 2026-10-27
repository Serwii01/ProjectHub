# ProjectHub

Intermediario entre Claude y todos los proyectos del usuario: un registro central, un servidor MCP y un dashboard web local.

Se usa en **varios equipos**: el código y `hub.config.json` se sincronizan por GitHub; cada equipo tiene su `hub.local.json`. El estado de cada proyecto viaja en su propio repo (`STATUS.md`), así que hay que hacer push al cerrar y pull al retomar.

## Archivos
- `hub.config.json` — común a todos los equipos: usuario de GitHub, repos ocultos, carpetas excluidas y datos manuales por proyecto (`repo` en GitHub, descripción, prioridad). Se casa con cada carpeta por el nombre del repo, así que da igual cómo se llame la carpeta en cada equipo.
- `hub.local.json` — de este equipo (no se sube): `roots` a escanear, `cloneDir` donde clonar y `githubToken` opcional (para ver repos privados). Se crea solo con valores por defecto.
- `instalar.mjs` — `npm run instalar`: crea `hub.local.json`, copia `skills/` a `~/.claude/skills` con las rutas de este equipo y registra el MCP en `~/.claude.json`. Se puede repetir.
- `skills/` — fuente de las skills `/proyectos`, `/retomar`, `/cerrar` (con `{{HUB}}` como marcador de ruta). Edita aquí y vuelve a ejecutar el instalador.
- `lib/hub.mjs` — núcleo compartido: escaneo de repos, acceso seguro a archivos (bloquea `.env`, claves, `node_modules`, rutas fuera del proyecto), búsqueda, git y lectura/escritura de `STATUS.md`.
- `scan.mjs` — CLI: genera `projects.json` y `PROJECTS.md`. `node scan.mjs --json` imprime el registro.
- `mcp-server.mjs` — servidor MCP `project-hub` (stdio), registrado a nivel de usuario en `~/.claude.json`. Herramientas: `list_projects` (incluye repos de GitHub no clonados aquí), `clone_project`, `get_project_context` (hace `git fetch` antes), `list_project_files`, `read_project_file`, `search_projects`, `git_summary`, `update_status`, `set_project_info`.
- `dashboard.mjs` + `public/index.html` — dashboard en http://localhost:4310 (solo localhost; las peticiones de escritura exigen la cabecera `X-Hub: 1`). `Abrir dashboard.cmd` lo arranca con doble clic.
- `templates/` — plantillas de `CLAUDE.md` y `STATUS.md` para cada proyecto.

## Cómo se trabaja
- Cada proyecto tiene en su raíz `CLAUDE.md` (cómo está hecho) y `STATUS.md` (dónde se quedó y qué sigue).
- Skills de usuario (`~/.claude/skills/`): `/proyectos`, `/retomar <proyecto>` y `/cerrar`, que usan el MCP por debajo.
- Cualquier lógica nueva va en `lib/hub.mjs` para que la compartan el MCP, el dashboard y el CLI.
- Tras cambiar `lib/hub.mjs` o `mcp-server.mjs` hay que reiniciar Claude Code (el MCP se carga al arrancar) y el dashboard.

## Comandos
```bash
npm install && npm run instalar   # en un equipo nuevo (o tras cambiar skills/)
npm run scan                      # regenerar registro
npm run dashboard                 # abrir el dashboard
```
