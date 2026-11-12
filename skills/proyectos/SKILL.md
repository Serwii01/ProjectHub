---
name: proyectos
description: Panorama de todos los proyectos del usuario (último trabajo, git, siguiente paso). Úsala cuando pregunte por sus proyectos, qué tiene pendiente, en qué estaba o qué hacer hoy.
---

# /proyectos

1. `list_projects` sin argumentos (ya hace `git fetch` y resume). Si el MCP no responde, ejecuta `node {{HUB}}/scan.mjs` y avisa de que el estado del remoto puede estar desfasado.
2. Responde en el idioma del usuario, solo con lo que devuelve:
   - **Tabla** con sus filas y en su orden.
   - **Alertas**, si trae avisos, los `alto` primero.
   - **Recomendación** en 1–2 líneas, con `/retomar <proyecto>`.
   - **No clonados**, en una línea, si los hay (se clonan con `clone_project`).
3. No cambies nada: solo informa.

Si después pide cambios: prioridad o descripción → `update_status` con `prioridad`/`descripcion`; qué hizo esta semana → `work_report`; carpetas, repos ocultos o exclusiones → `{{DATA}}/local.json` y `config.json`; verlo en visual → `projecthub dashboard`.
