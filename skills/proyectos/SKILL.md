---
name: proyectos
description: Lista todos los proyectos del usuario con su estado (último trabajo, cambios sin commit/push, siguiente paso). Úsala cuando el usuario pregunte por sus proyectos, qué tiene pendiente, en qué estaba trabajando o qué hacer hoy.
---

# /proyectos — panorama de todos los proyectos

## Pasos

1. Llama a `list_projects` (servidor MCP **project-hub**) sin más argumentos. Hace `git fetch`, así que «por bajar» es real, y ya devuelve el panorama resumido: no pidas `detalle`.
   Si el MCP no responde, ejecuta `node {{HUB}}/scan.mjs` y avisa de que el estado respecto al remoto puede estar desfasado.
2. Responde en el idioma del usuario con el formato de abajo. No inventes datos: todo sale de la respuesta de la herramienta.
3. No hagas nada más: esta skill solo informa. No hagas pull, commit ni cambios en ningún proyecto.

## Formato de la respuesta

- **Tabla** con las filas que da la herramienta, en su mismo orden: Proyecto, Prioridad, Último trabajo, Git, Siguiente paso.
- **Alertas**, solo si la herramienta trae «Avisos»: una línea por aviso, los de nivel `alto` primero.
- **Recomendación**, 1–2 líneas, a partir de «Recomendado», y el comando concreto: `/retomar <proyecto>`.
- **No clonados**, una línea, si los hay. Ofrece clonarlos con `clone_project`.
- Si la herramienta dice que no pudo consultar algún remoto, dilo.

## Si el usuario pide cambios

| Quiere | Haz |
|---|---|
| Cambiar prioridad o descripción | `set_project_info` |
| Más detalle de uno | `/retomar <proyecto>` |
| Clonar un repo | `clone_project` |
| Qué se hizo esta semana | `work_report` |
| Añadir carpetas a escanear | Editar `roots` en `{{DATA}}/local.json` |
| Ocultar repos o excluir carpetas | Editar `github.ignore` o `exclude` en `{{DATA}}/config.json` |
| Verlo en visual | `projecthub dashboard` (o `npm run dashboard` en `{{HUB}}`) |
