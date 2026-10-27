---
name: proyectos
description: Lista todos los proyectos del usuario con su estado (último commit, cambios sin commit/push, stack, siguiente paso). Úsala cuando el usuario pregunte por sus proyectos, qué tiene pendiente, en qué estaba trabajando o qué hacer hoy.
---

# /proyectos — panorama de todos los proyectos

1. Llama a la herramienta MCP `list_projects` del servidor **project-hub**.
   Si no está disponible, ejecuta `node {{HUB}}/scan.mjs --json`.
2. Presenta al usuario (en español):
   - Una tabla corta: proyecto, prioridad, último commit (hace cuánto), estado git, siguiente paso.
   - **Alertas** primero: cambios sin commit, commits sin push, ramas que no son la principal, proyectos sin `STATUS.md` o con más de 30 días sin tocar.
   - Una recomendación de 1–2 líneas sobre en qué trabajar (prioridad alta + siguiente paso claro > resto).
   - Si `noClonadosEnEsteEquipo` trae repos, menciónalos en una línea (primero los que tengan prioridad o push reciente) y ofrece clonarlos con `clone_project`.
3. Si el usuario pide más detalle de uno, sugiere `/retomar <proyecto>`. Recuérdale que tiene el panel visual con `Abrir dashboard.cmd` en `{{HUB}}`.

Para cambiar prioridad o descripción usa `set_project_info`. Las carpetas que se escanean en este equipo están en `roots` de `{{HUB}}/hub.local.json`; las exclusiones y los repos de GitHub ocultos, en `{{HUB}}/hub.config.json`.
