---
name: retomar
description: Retoma el trabajo en uno de los proyectos del usuario recuperando dónde se quedó (relevo, STATUS.md, avisos de git). Úsala con "/retomar <proyecto>" o cuando el usuario diga "sigamos con X", "retomemos X", "¿por dónde iba en X?".
---

# /retomar <proyecto> — volver a un proyecto donde se dejó

Argumento: nombre del proyecto; vale un prefijo o el nombre del repo. Si falta, llama a `list_projects` y pregunta cuál.

## 1. Cargar el contexto

Llama a `get_project_context` (servidor MCP **project-hub**). Hace `git fetch` y devuelve lo justo: `siguienteAccion`, `avisos`, `relevo`, estado, siguientes pasos, última sesión, `sinAnotar` y `porBajar`.

- Si la sesión **no** está abierta en la carpeta del proyecto, pasa `contexto: true` para recibir también su archivo de contexto (`contextMd`). Si está en ella, tu cliente ya lo ha cargado: no lo pidas.
- No pidas `detalle: "completo"` ni explores el código para situarte. Si luego hace falta entender la estructura, `get_project_map`.

| Resultado | Qué hacer |
|---|---|
| Error «es ambiguo» | Enseña los candidatos y pregunta cuál. No elijas tú. |
| Error «no hay ningún proyecto» | Mira si está en la lista de no clonados de `list_projects` (con `actualizar: false`). Si está, ofrece `clone_project`; si no, dilo y enseña nombres parecidos. |
| El MCP no responde | Lee `{{DATA}}/projects.json`, busca la ruta y lee a mano el archivo de contexto (`AGENTS.md` o `CLAUDE.md`), `STATUS.md`, `git status` y `git log -10`. Avisa de ello. |

## 2. Atender los avisos

Sigue la `accion` de cada aviso, los de nivel `alto` primero. Los más importantes:

| Aviso | Qué hacer |
|---|---|
| `commits_por_bajar` | Propón `git pull` **antes** de nada y espera la respuesta: el STATUS.md bueno es el que llega con el pull. `porBajar` dice qué commits son. Después vuelve a llamar a `get_project_context`. |
| `ramas_divergidas` | Mira qué archivos tocan los dos lados y explícalo. Propón `git pull --no-rebase`. Nunca force push. |
| `sin_subir_en_otro_equipo` | Dilo antes de nada: ese trabajo no está aquí. Lo mejor es subirlo desde aquel equipo; si el usuario sigue, que sea en otros archivos. |
| `relevo_pendiente` | El campo `relevo` es lo más reciente: un chat anterior dejó trabajo a medias. Continúa desde ahí. Si cita archivos sin commit que aquí no existen, se quedaron en el otro equipo: dilo. |
| `ficha_desactualizada` | «Última sesión» no es lo último que se hizo. Resume `sinAnotar` como lo más reciente, con su fecha, y ofrece anotarlo con `update_status` (una llamada por día, con `fecha`). |
| `sin_status`, `sin_contexto` | Ofrece crearlos analizando el repo (README, dependencias, estructura, git log) con las plantillas de `{{HUB}}/templates/`. El archivo de contexto se llama como lo lea la IA en uso: `CLAUDE.md` en Claude Code, `AGENTS.md` en las demás. |
| `no_editar` | Tenlo presente toda la sesión: esas rutas no se editan a mano. |
| `fuente_de_otro`, `tiene_fuentes` | Di dónde se hace cada cambio. |

## 3. Situarse en el proyecto

Si la sesión no está en la ruta del proyecto, muévela allí con la herramienta de cambio de carpeta si existe, para que se cargue su archivo de contexto. Si no se puede, trabaja con rutas absolutas.

## 4. Responder

En el idioma del usuario, en este orden y sin relleno:

- **Qué es**: 1 línea.
- **Dónde lo dejaste**: lo más reciente con su fecha: el relevo si lo hay, si no los commits sin anotar, si no la última sesión. Estado git solo si hay algo que decir.
- **A tener en cuenta**: solo los avisos que afecten al trabajo de hoy.
- **Siguiente paso**: el del relevo, o el primero de los siguientes pasos, o uno deducido si no hay. Pregunta si empezamos por ahí.

## Reglas

- No hagas pull, commit ni push sin confirmación.
- No empieces a trabajar hasta que el usuario responda.
- Para consultar otro proyecto, usa `search_projects` y `read_project_file` (con `desde` y `hasta` en archivos grandes), no rutas a mano.
- Si la conversación se alarga y queda trabajo a medias, `save_handoff` antes de que se acabe el contexto.
- Al terminar el trabajo, recuerda `/cerrar`.
