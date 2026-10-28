---
name: cerrar
description: Cierra una sesión de trabajo en un proyecto guardando el progreso en su STATUS.md (qué se hizo, qué queda, decisiones). Úsala con "/cerrar" o cuando el usuario diga "lo dejamos aquí", "guarda el progreso", "cierra la sesión".
---

# /cerrar — guardar el progreso de la sesión

Se aplica al proyecto en el que se ha trabajado (si no está claro cuál, pregunta).

1. Repasa lo hecho en esta conversación y en git (`git_summary` con `diff: true`, o `git status` / `git log` / `git diff --stat`). Mira también `unloggedCommits` en `get_project_context`: son commits posteriores a la última actualización de STATUS.md, incluidos los de sesiones anteriores que nunca se cerraron; inclúyelos.
2. Llama a `update_status` (servidor MCP **project-hub**) con:
   - `sesion`: viñetas concretas de lo hecho hoy. Si hay commits de otros días sin anotar, haz una llamada aparte por cada día con `fecha` (AAAA-MM-DD), del más antiguo al más reciente.
   - `completados`: fragmentos del texto de los pasos de "Siguientes pasos" que ya están hechos.
   - `nuevos_pasos`: lo que queda o se ha descubierto, por orden de prioridad.
   - `estado`: el nuevo "Estado actual" (2–4 líneas) si ha cambiado.
   - `decisiones` / `problemas`: lo relevante que se haya decidido o descubierto.
   Si el MCP no está disponible, edita `STATUS.md` a mano con la misma estructura (conserva solo las 5 sesiones más recientes).
3. Si cambió algo de arquitectura, comandos o convenciones, actualiza también `CLAUDE.md`.
4. Avisa si quedan cambios sin commit o commits sin push, y pregunta si hacer commit (incluyendo STATUS.md) **y push**. El usuario trabaja en varios equipos: sin push, el otro equipo no verá ni el código ni el STATUS.md actualizado. No hagas commit ni push sin que el usuario lo confirme.
