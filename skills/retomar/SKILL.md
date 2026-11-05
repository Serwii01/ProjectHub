---
name: retomar
description: Retoma el trabajo en uno de los proyectos del usuario recuperando dónde se quedó (STATUS.md, CLAUDE.md, git log, TODOs). Úsala con "/retomar <proyecto>" o cuando el usuario diga "sigamos con X", "retomemos X", "¿por dónde iba en X?".
---

# /retomar <proyecto> — volver a un proyecto donde se dejó

Argumento: nombre del proyecto; vale un prefijo o el nombre del repo. Si falta, llama a `list_projects` y pregunta cuál.

## 1. Cargar el contexto

Llama a `get_project_context` (servidor MCP **project-hub**). Hace `git fetch` y devuelve `siguienteAccion`, `avisos`, CLAUDE.md, STATUS.md, git y TODOs.

| Resultado | Qué hacer |
|---|---|
| Error «es ambiguo» | Enseña los candidatos y pregunta cuál. No elijas tú. |
| Error «no hay ningún proyecto» | Mira `noClonadosEnEsteEquipo` en `list_projects` (con `actualizar: false`). Si está, ofrece `clone_project`; si no, dilo y enseña nombres parecidos. |
| El MCP no responde | Lee `{{HUB}}/projects.json`, busca la ruta y lee a mano `CLAUDE.md`, `STATUS.md`, `git status` y `git log -10`. Avisa de ello. |

## 2. Atender los avisos

Sigue la `accion` de cada aviso, los de nivel `alto` primero. Los más importantes:

| Aviso | Qué hacer |
|---|---|
| `commits_por_bajar` | Propón `git pull` **antes** de nada y espera la respuesta: el STATUS.md bueno es el que llega con el pull. Después vuelve a llamar a `get_project_context`. |
| `ramas_divergidas` | Mira qué archivos tocan los dos lados y explícalo. Propón `git pull --no-rebase`. Nunca force push. |
| `ficha_desactualizada` | «Última sesión» no es lo último que se hizo. Resume `project.unloggedCommits` como lo más reciente, con su fecha, y ofrece anotarlos con `update_status` (una llamada por día, con `fecha`). |
| `sin_status`, `sin_claude_md` | Ofrece crearlos analizando el repo (README, dependencias, estructura, git log) con las plantillas de `{{HUB}}/templates/`. |
| `no_editar` | Tenlo presente toda la sesión: esas rutas no se editan a mano. |
| `fuente_de_otro`, `tiene_fuentes` | Di dónde se hace cada cambio. |

## 3. Situarse en el proyecto

Si la sesión no está en `project.path`, muévela allí con la herramienta de cambio de carpeta si existe, para que se cargue su CLAUDE.md. Si no se puede, trabaja con rutas absolutas y lee tú su CLAUDE.md.

## 4. Responder

En español, en este orden y sin relleno:

- **Qué es**: 1 línea.
- **Dónde lo dejaste**: lo más reciente con su fecha, sea la última sesión o los commits posteriores. Estado git solo si hay algo que decir.
- **A tener en cuenta**: solo los avisos que afecten al trabajo de hoy.
- **Siguiente paso**: el primero de «Siguientes pasos», o uno deducido si no hay. Pregunta si empezamos por ahí.

## Reglas

- No hagas pull, commit ni push sin confirmación.
- No empieces a trabajar hasta que el usuario responda.
- Para consultar otro proyecto, usa `search_projects` y `read_project_file`, no rutas a mano.
- Al terminar el trabajo, recuerda `/cerrar`.
