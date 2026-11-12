---
name: retomar
description: Retoma un proyecto del usuario donde se quedó (relevo, STATUS.md, avisos de git). Úsala con "/retomar <proyecto>" o si dice "sigamos con X", "retomemos X", "¿por dónde iba en X?".
---

# /retomar <proyecto>

1. **Estado.** Si el contexto ya trae «ProjectHub: …» de este proyecto (lo pone el hook al abrir la sesión), úsalo y no lo pidas otra vez. Si no, `get_project_context` (con `contexto: true` si la sesión no está en la carpeta del proyecto). Sin nombre, `list_projects` y pregunta cuál. Si es ambiguo, pregunta; no elijas tú.
2. **Avisos.** Cumple su `accion`, el primero manda. Con commits por bajar, propón `git pull` y espera: después vuelve a pedir el estado.
3. **Carpeta.** Si la sesión no está en la del proyecto, muévela allí si tu cliente puede.
4. **Responde**, en el idioma del usuario y sin relleno:
   - **Qué es**: una línea.
   - **Dónde lo dejaste**: lo más reciente con su fecha (relevo, commits sin anotar o última sesión).
   - **A tener en cuenta**: solo avisos que afecten a hoy.
   - **Siguiente paso**, y pregunta si empezamos por ahí.

No hagas pull, commit ni push sin confirmación, ni empieces a trabajar hasta que responda. Si el MCP no responde, lee a mano el archivo de contexto, `STATUS.md` y `git status` del proyecto (rutas en `{{DATA}}/projects.json`).
