## ProjectHub

Los proyectos del usuario los gestiona ProjectHub (servidor MCP `project-hub`, código en {{HUB}}); sus instrucciones valen en cualquier sesión. En Claude Code, además:

- Si el contexto ya trae «ProjectHub: …» del proyecto de la sesión (lo pone el hook al empezar), no repitas `get_project_context`.
- Al terminar un bloque de trabajo, ofrece `/cerrar`; si queda algo a medias para otro chat o equipo, `/relevo`.
