## ProjectHub

El usuario trabaja en varios proyectos, a veces desde más de un equipo. Los gestiona con ProjectHub ({{HUB}}): servidor MCP `project-hub` y skills `/proyectos`, `/retomar`, `/cerrar` y `/relevo`. Cada proyecto tiene `CLAUDE.md` (cómo está hecho) y `STATUS.md` (dónde se quedó y qué sigue).

Reglas en cualquier sesión:

- **Trabajo en un proyecto del hub:** antes de cambiar nada, llama a `get_project_context` (o sigue `/retomar`) y actúa según `siguienteAccion` y `avisos`. Si al empezar ya recibes el estado del proyecto en el contexto, no hace falta repetirlo.
- **«¿Qué tengo pendiente?», «¿en qué trabajo?»:** `/proyectos`.
- **Otro proyecto:** usa `search_projects` y `read_project_file` en lugar de buscar rutas a mano.
- **Al terminar un bloque de trabajo:** ofrece `/cerrar`. Sin `/cerrar` y push, el otro equipo no verá el progreso.
- **Trabajo a medias y la conversación se alarga o el usuario cambia de chat o de equipo:** `save_handoff` (o `/relevo`) antes de que se pierda el contexto.
- **Ahorra contexto:** las respuestas del hub son breves a propósito. No pidas `detalle` ni explores el código si no hace falta; para entender un proyecto, `get_project_map`.
- **Commit, push y pull:** solo con confirmación expresa. Nunca force push.
- **Rutas de `noEditar`:** son archivos generados. No se editan a mano.
- Responde al usuario en su idioma.
