---
name: cerrar
description: Guarda el progreso de la sesión en el STATUS.md del proyecto (qué se hizo, qué queda, decisiones). Úsala con "/cerrar" o si dice "lo dejamos aquí", "guarda el progreso", "cierra la sesión".
---

# /cerrar

Para cada proyecto tocado en la sesión (si no está claro cuáles, pregunta):

1. **Reúne lo hecho**: la conversación y los commits sin anotar que diga el estado del proyecto (también de sesiones que no se cerraron).
2. **`update_status`**. La ficha se relee en cada sesión: cada palabra de más se paga siempre.
   - `sesion`: 3–6 viñetas concretas de lo hecho, sin listas de archivos. Si hay commits de otros días, una llamada por día con su `fecha`.
   - `completados`: un fragmento distintivo de cada paso hecho. `nuevos_pasos`: lo que queda, cada uno hacible sin más contexto.
   - `estado` (2–4 líneas) si cambió; `decisiones` solo lo que importará en meses; `problemas` lo roto o sin verificar.
   - Si la respuesta trae pasos no encontrados o ambiguos, repite con un fragmento más concreto.
3. **Archivo de contexto** (CLAUDE.md o AGENTS.md): actualízalo solo si cambió la arquitectura, los comandos o las convenciones.
4. **Pregunta final**: di qué quedó anotado y qué falta por subir, y pregunta si hacer commit y push (sin push, el otro equipo no lo ve). Antes del push, `git fetch`; nunca force push.

Si queda trabajo a medias para otro chat o equipo, además `/relevo`. Si el MCP no responde, edita `STATUS.md` a mano con la misma estructura.
