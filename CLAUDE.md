# ProjectHub

Intermediario entre Claude y todos los proyectos del usuario: un registro central, un servidor MCP y un dashboard web local.

## Archivos
- `hub.config.json` — carpetas a escanear (`roots`), exclusiones y datos manuales por proyecto (descripción, prioridad).
- `lib/hub.mjs` — núcleo compartido: escaneo de repos, acceso seguro a archivos (bloquea `.env`, claves, `node_modules`, rutas fuera del proyecto), búsqueda, git y lectura/escritura de `STATUS.md`.
- `scan.mjs` — CLI: genera `projects.json` y `PROJECTS.md`. `node scan.mjs --json` imprime el registro.
- `mcp-server.mjs` — servidor MCP `project-hub` (stdio), registrado a nivel de usuario en `~/.claude.json`. Herramientas: `list_projects`, `get_project_context`, `list_project_files`, `read_project_file`, `search_projects`, `git_summary`, `update_status`, `set_project_info`.
- `dashboard.mjs` + `public/index.html` — dashboard en http://localhost:4310 (solo localhost; las peticiones de escritura exigen la cabecera `X-Hub: 1`). `Abrir dashboard.cmd` lo arranca con doble clic.
- `templates/` — plantillas de `CLAUDE.md` y `STATUS.md` para cada proyecto.

## Cómo se trabaja
- Cada proyecto tiene en su raíz `CLAUDE.md` (cómo está hecho) y `STATUS.md` (dónde se quedó y qué sigue).
- Skills de usuario (`~/.claude/skills/`): `/proyectos`, `/retomar <proyecto>` y `/cerrar`, que usan el MCP por debajo.
- Cualquier lógica nueva va en `lib/hub.mjs` para que la compartan el MCP, el dashboard y el CLI.
- Tras cambiar `lib/hub.mjs` o `mcp-server.mjs` hay que reiniciar Claude Code (el MCP se carga al arrancar) y el dashboard.

## Comandos
```bash
npm run scan        # regenerar registro
npm run dashboard   # abrir el dashboard
```
