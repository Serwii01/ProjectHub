---
name: proyectos
description: Lista todos los proyectos del usuario con su estado (último commit, cambios sin commit/push, stack, siguiente paso). Úsala cuando el usuario pregunte por sus proyectos, qué tiene pendiente, en qué estaba trabajando o qué hacer hoy.
---

# /proyectos — panorama de todos los proyectos

## Pasos

1. Llama a `list_projects` (servidor MCP **project-hub**). Hace `git fetch`, así que «por bajar» es real.
   Si el MCP no responde, ejecuta `node {{HUB}}/scan.mjs --json` y avisa de que el estado de GitHub puede estar desfasado.
2. Responde en español con el formato de abajo. No inventes datos: todo sale de la respuesta de la herramienta.
3. No hagas nada más: esta skill solo informa. No hagas pull, commit ni cambios en ningún proyecto.

## Formato de la respuesta

**Tabla**, una fila por proyecto, ordenada por prioridad (alta, media, baja, sin prioridad) y después por actividad:

| Proyecto | Prioridad | Último trabajo | Git | Siguiente paso |

- *Último trabajo*: `lastCommit.daysAgo` en lenguaje natural («hace 3 días»). Es la actividad real, no la última sesión anotada.
- *Git*: `al día`, o lo que corresponda: `N por bajar`, `N sin subir`, `N sin commit`.
- *Siguiente paso*: el primero de `nextSteps`, resumido si es largo.
- Los proyectos con `prioridad: "archivado"` no van en la tabla: di cuántos hay en una línea.

**Alertas**, solo si existen. Primero los avisos de nivel `alto`, después `medio`; de los de nivel `info`, solo `inactivo` y `rama_con_otro_nombre`. Una línea por aviso con el proyecto y su `mensaje`.

**Recomendación**, 1–2 líneas. Orden de preferencia:
1. Un proyecto con commits por bajar o ramas divergidas: conviene resolverlo antes de trabajar.
2. Prioridad alta con siguiente paso claro.
3. El resto, por actividad reciente.

Termina con el comando concreto: `/retomar <proyecto>`.

**No clonados**, una línea: cuántos hay en `noClonadosEnEsteEquipo` y los 3 con push más reciente. Ofrece clonarlos con `clone_project`.

Si `fetchFallido` trae proyectos, dilo: su estado respecto a GitHub no se ha podido comprobar.

## Si el usuario pide cambios

| Quiere | Haz |
|---|---|
| Cambiar prioridad o descripción | `set_project_info` |
| Más detalle de uno | `/retomar <proyecto>` |
| Clonar un repo | `clone_project` |
| Añadir carpetas a escanear | Editar `roots` en `{{HUB}}/hub.local.json` |
| Ocultar repos o excluir carpetas | Editar `github.ignore` o `exclude` en `{{HUB}}/hub.config.json` |
| Verlo en visual | Doble clic en `Abrir dashboard.cmd` en `{{HUB}}` |
