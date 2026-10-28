---
name: retomar
description: Retoma el trabajo en uno de los proyectos del usuario recuperando dónde se quedó (STATUS.md, CLAUDE.md, git log, TODOs). Úsala con "/retomar <proyecto>" o cuando el usuario diga "sigamos con X", "retomemos X", "¿por dónde iba en X?".
---

# /retomar <proyecto> — volver a un proyecto donde se dejó

Argumento: nombre del proyecto (vale un prefijo). Si falta, usa `list_projects` y pregunta cuál.

1. Llama a `get_project_context` (servidor MCP **project-hub**). Hace `git fetch` y devuelve ruta, CLAUDE.md, STATUS.md, git y TODOs en una sola llamada.
   - Si el proyecto no está clonado en este equipo pero sí en GitHub (aparece en `noClonadosEnEsteEquipo` de `list_projects`), ofrece clonarlo con `clone_project` y continúa.
   - Si `behind > 0`, el usuario ha trabajado en él desde otro equipo: propón `git pull` **antes** de leer STATUS.md (el STATUS.md bueno es el que llega con el pull). Si además hay cambios locales sin commit, avisa y pregunta cómo seguir.
   - Si `project.statusStale` es true, **STATUS.md está desactualizado**: hay `unloggedCount` commits (`unloggedCommits`) hechos después de su última actualización, normalmente porque se trabajó sin `/cerrar`. No presentes su «Última sesión» como lo último que se hizo: resume esos commits como lo más reciente y ofrece ponerlo al día con `update_status` (sesión fechada con el día de esos commits, estado actual, pasos completados o nuevos) antes de seguir.
   Si el MCP no está disponible: localiza la ruta en `{{HUB}}/projects.json` y lee esos archivos y `git status` / `git log -10` a mano.
2. Si la sesión no está ya en la carpeta del proyecto, cámbiate a ella (herramienta de cambio de directorio si existe) para poder editar con normalidad. Si no se puede, trabaja con rutas absolutas.
3. Resume al usuario en pocas líneas:
   - **Qué es** el proyecto (1 línea).
   - **Dónde lo dejaste**: lo más reciente entre la última sesión de STATUS.md y los commits posteriores (`unloggedCommits`), con su fecha; y estado git (avisa de cambios sin commit o sin push).
   - **Siguiente paso propuesto** (el primero de "Siguientes pasos" o uno deducido). Pregunta si empezamos por ahí.
4. Si no existe `STATUS.md` o `CLAUDE.md`, ofrece crearlos analizando el repo (plantillas en `{{HUB}}/templates/`).

Para consultar cómo se hizo algo en **otro** proyecto, usa `search_projects` y `read_project_file` en lugar de buscar rutas a mano.

Al terminar la sesión de trabajo, recuerda al usuario `/cerrar` para guardar el progreso.
