---
name: relevo
description: Deja anotado el trabajo a medias para seguirlo en otro chat o equipo. Úsala con "/relevo" o si dice "sigo en otro chat", "sigo en casa", "se acaba el contexto", "guarda por dónde vamos".
---

# /relevo

1. **`save_handoff`**, escrito para alguien que no ha visto esta conversación:
   - `haciendo`: qué y en qué punto exacto quedó.
   - `siguiente`: un solo paso inmediato y concreto (archivo, función o comando).
   - `hecho`: lo terminado, probado o descartado, con su porqué.
   - `notas`: lo que costó averiguar y no se ve en el código.
   Sin código ni salidas de comandos: di dónde están. La fecha, el equipo, la rama y los archivos sin commit los añade la herramienta.
2. **Cómo seguir**: en otro chat de este equipo basta «retomemos <proyecto>». Para otro equipo hay que subir el relevo y lo que esté sin commit: propón commit (en `wip/<tema>` si no es para la rama principal) y push, solo si lo confirma.

No sustituye a `/cerrar`, que anota lo terminado; al cerrar, el relevo se borra solo. Si el MCP no responde, escribe a mano `.projecthub/relevo.md` con esos apartados.
