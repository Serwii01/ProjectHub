---
name: relevo
description: Deja anotado el trabajo que está a medias para continuarlo en otro chat o en otro equipo sin perder nada. Úsala con "/relevo" o cuando el usuario diga "sigo en otro chat", "sigo en casa", "se acaba el contexto", "guarda por dónde vamos".
---

# /relevo — pasar el trabajo a medias a otro chat o equipo

El relevo no sustituye a `/cerrar`: `/cerrar` anota lo terminado; el relevo, el punto exacto en el que se queda algo sin terminar. El siguiente chat lo recibe al retomar el proyecto y se borra al cerrar la sesión.

## 1. Guardar con `save_handoff` (servidor MCP **project-hub**)

Escribe para alguien que no ha visto esta conversación y no puede preguntarte.

| Campo | Cómo rellenarlo |
|---|---|
| `haciendo` | Qué se estaba haciendo y en qué punto exacto quedó: «Migrando el login a sesiones; el servidor ya las crea, falta que el formulario mande la cookie». |
| `siguiente` | El paso inmediato, concreto: archivo, función o comando. Uno solo. |
| `hecho` | Lo terminado en este tramo, lo probado y lo descartado con su porqué, para que no se repita. |
| `notas` | Lo que costó averiguar y no se ve en el código: la causa de un fallo, una trampa, una decisión que el usuario aún no ha tomado. |

No copies código ni salidas de comandos: di dónde está. La herramienta añade sola la fecha, el equipo, la rama y la lista de archivos sin commit.

## 2. Decir cómo continuar

- **Otro chat en este equipo**: basta con «retomemos <proyecto>» en el chat nuevo.
- **Otro equipo**: el relevo y lo que esté sin commit tienen que subirse. Propón un commit de lo que está a medias (en una rama `wip/<tema>` si no está para la rama principal) y push. Hazlo solo si el usuario lo confirma; nunca force push.

Si el MCP no responde, escribe a mano `.projecthub/relevo.md` en la raíz del proyecto con esos mismos apartados.
