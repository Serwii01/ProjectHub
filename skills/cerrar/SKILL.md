---
name: cerrar
description: Cierra una sesión de trabajo en un proyecto guardando el progreso en su STATUS.md (qué se hizo, qué queda, decisiones). Úsala con "/cerrar" o cuando el usuario diga "lo dejamos aquí", "guarda el progreso", "cierra la sesión".
---

# /cerrar — guardar el progreso de la sesión

Se aplica a cada proyecto tocado en esta sesión. Si no está claro cuáles son, pregunta. Si son varios, repite los pasos 1–3 en cada uno y haz una sola pregunta final.

## 1. Reunir lo hecho

- Lo hablado y hecho en esta conversación.
- `get_project_context`: `project.unloggedCommits` son commits posteriores a la última actualización de STATUS.md, también de sesiones que nunca se cerraron. Inclúyelos.
- `git_summary` con `diff: true` si hay cambios sin commit.

## 2. Guardar con `update_status` (servidor MCP **project-hub**)

| Campo | Cómo rellenarlo |
|---|---|
| `sesion` | Viñetas concretas de lo hecho, no de la intención: «Añadido el filtro por país en /sustancias», no «Mejoras». Agrupa por tema si son muchas. |
| `fecha` | Solo si el trabajo no es de hoy. Si hay commits de varios días, una llamada por día, del más antiguo al más reciente, con la fecha de cada commit. |
| `completados` | Un fragmento distintivo de cada paso ya hecho. |
| `nuevos_pasos` | Lo que queda o ha aparecido. Cada paso debe poder hacerse sin más contexto: «Compilar el backend y recorrer un préstamo», no «Mejorar el backend». |
| `estado` | Reescribe «Estado actual» en 2–4 líneas si ha cambiado. |
| `decisiones` | Solo lo que alguien querrá saber dentro de meses: qué se decidió y por qué. |
| `problemas` | Lo que sigue roto o sin verificar. Di también lo que no se ha podido comprobar. |

Revisa `cambios` en la respuesta: lo que venga en `noEncontrados` o `ambiguos` no se ha quitado. Repite con un fragmento más concreto. Si `sesionesDescartadas` es mayor que 0, es normal: solo se guardan las 5 últimas.

Si el MCP no responde, edita `STATUS.md` a mano con la misma estructura y avisa. Si el proyecto no está en el hub, igual.

## 3. Actualizar CLAUDE.md si hace falta

Solo si cambió la arquitectura, los comandos, las dependencias o las convenciones.

## 4. Pregunta final

Dile al usuario qué ha quedado anotado y qué falta por subir (archivos sin commit, commits sin push). Pregunta si hacer **commit y push**: sin push, el otro equipo no verá ni el código ni la ficha.

- No hagas commit ni push sin confirmación.
- Antes de hacer push, `git fetch`. Si hay commits por bajar, enséñalos y pide confirmación antes de unirlos. Nunca force push.
- Si el aviso `rama_con_otro_nombre` está activo, usa el comando que indica.
- Si el proyecto es `fuente_de_otro`, recuerda reimportar en el proyecto de destino.
