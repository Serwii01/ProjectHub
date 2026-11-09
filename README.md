# ProjectHub

**Tus proyectos y dónde los dejaste, al alcance de cualquier IA.**

ProjectHub es un servidor [MCP](https://modelcontextprotocol.io), una CLI y un dashboard local. Con él, tu asistente de IA (Claude, Cursor, Copilot, Gemini, Codex…) conoce todos tus repos por su nombre, sabe en qué punto quedó cada uno y te avisa de lo que hay que hacer antes de tocar nada: bajar commits de otro equipo, anotar trabajo sin registrar, no editar archivos generados.

[![tests](https://github.com/Serwii01/ProjectHub/actions/workflows/test.yml/badge.svg)](https://github.com/Serwii01/ProjectHub/actions/workflows/test.yml)

```text
Tú:  retomemos PrestArte
IA:  PrestArte — préstamo de obras de arte entre coleccionistas y museos.
     Lo dejaste el 5 de noviembre: backend de préstamos terminado, falta la pantalla de devolución.
     Hay 2 commits por bajar de tu otro equipo. ¿Hago git pull antes de seguir?
```

## Qué problema resuelve

Cada sesión con una IA empieza de cero: hay que volver a explicar el proyecto, recordar qué faltaba y comprobar a mano si el otro ordenador tiene trabajo sin bajar. ProjectHub lo resuelve con tres piezas:

1. **Una ficha en cada repo.** `STATUS.md` dice dónde quedó el trabajo (estado, siguientes pasos, últimas sesiones, decisiones). El archivo de contexto (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`…) dice cómo está hecho. Viajan con git, así que son las mismas en todos tus equipos y para todas tus IAs.
2. **Un servidor MCP** que da a la IA acceso a cualquier proyecto por su nombre, desde cualquier carpeta, y le dice qué hacer en cada situación.
3. **Un dashboard local** para ver de un vistazo el estado de todo.

Todo se ejecuta en tu equipo. No hay cuenta, servidor ni telemetría.

## Pensado para gastar pocos tokens

Cada cosa que una herramienta devuelve ocupa contexto de la conversación, así que el hub responde con lo justo y da el detalle solo si la IA lo pide:

- **Contexto breve.** Retomar un proyecto devuelve la siguiente acción, los avisos, el estado, los pasos y la última sesión. El `STATUS.md` entero, el log de git o el archivo de contexto se piden aparte.
- **Panorama en una tabla.** Una línea por proyecto en vez de un objeto con veinte campos.
- **Mapa del proyecto.** `get_project_map` resume la estructura del repo para que la IA no lo explore a ciegas.
- **Lecturas acotadas.** Los archivos se leen por rangos de líneas y las búsquedas devuelven pocas coincidencias por proyecto.
- **Fichas con presupuesto.** El hub avisa cuando un `STATUS.md` pasa de unos 1.500 tokens y mueve las sesiones antiguas a `HISTORY.md`, que no se relee.
- **Medido.** `projecthub uso` muestra los tokens que ha devuelto cada herramienta, y los tests fijan un máximo.

En los 23 proyectos del autor, el panorama pasó de unos 13.500 tokens a 1.300, y retomar un proyecto, de 2.100 de media a 400.

## Instalación

Requisitos: **Git** y **Node.js 20 o superior**.

```bash
npm install -g github:Serwii01/ProjectHub
projecthub instalar
```

O desde el código, si quieres modificarlo:

```bash
git clone https://github.com/Serwii01/ProjectHub.git
cd ProjectHub
npm install
npm run instalar
```

El instalador:

1. Crea la carpeta de datos `~/.projecthub` con tu configuración.
2. Registra el servidor MCP en los clientes de IA que encuentra en el equipo.
3. Si tienes Claude Code, instala además sus extras: skills, reglas globales y hooks.
4. Busca tus repos y los lista.

Antes de tocar la configuración de otro programa guarda una copia en `~/.projecthub/backups`. Se puede repetir las veces que haga falta.

Después, **reinicia tu cliente de IA** y pregúntale «¿qué proyectos tengo?».

### Opciones del instalador

| Opción | Para qué |
|---|---|
| `--roots dir1,dir2` | Carpetas donde buscar proyectos. Se mira el primer nivel de cada una. |
| `--github usuario` | Cuenta de GitHub de la que listar los repos que no tienes clonados. Si no la das, se deduce de tus repos. |
| `--clientes a,b` | Registrar solo en esos clientes. `todos` registra aunque no se detecten; `ninguno` no registra en ninguno. |
| `--sin-extras` | No instalar skills, reglas globales ni hooks de Claude Code. |
| `--equipo nombre` | Cómo se llama este equipo en los avisos a tus otros equipos. Por defecto, el nombre del sistema. |

## Clientes compatibles

Funciona con cualquier cliente que hable MCP por stdio. El instalador configura estos solo:

| Cliente | id | Archivo que se modifica |
|---|---|---|
| Claude Code | `claude-code` | `~/.claude.json` |
| Claude Desktop | `claude-desktop` | `claude_desktop_config.json` |
| Cursor | `cursor` | `~/.cursor/mcp.json` |
| VS Code (Copilot) | `vscode` | `mcp.json` del usuario |
| Windsurf | `windsurf` | `~/.codeium/windsurf/mcp_config.json` |
| Gemini CLI | `gemini` | `~/.gemini/settings.json` |
| Antigravity | `antigravity` | `~/.gemini/antigravity/mcp_config.json` |
| Codex CLI | `codex` | `~/.codex/config.toml` |

`projecthub clientes` dice cuáles hay en tu equipo y si ya tienen el servidor.

Para cualquier otro cliente, añade esto a su configuración MCP:

```json
{
  "mcpServers": {
    "project-hub": { "command": "projecthub", "args": ["mcp"] }
  }
}
```

El servidor lleva dentro todo lo que la IA necesita saber: sus instrucciones, los avisos de cada proyecto y cuatro *prompts* (`proyectos`, `retomar`, `cerrar`, `relevo`) con el procedimiento completo. No depende de las reglas ni de las skills de ningún cliente.

## Uso diario

| Momento | Qué decir | Qué pasa |
|---|---|---|
| Empezar | «¿Qué tengo pendiente?» | Tabla de todos los proyectos, alertas y una recomendación de por dónde seguir. |
| Retomar | «Retomemos PrestArte» | `git fetch`, avisos (por ejemplo, commits por bajar), lectura de las fichas y resumen con el siguiente paso. Vale un prefijo: «prest». |
| Durante | «¿Cómo hice el login en PrestArte?» | La IA busca y lee en tus otros proyectos sin que le des rutas. |
| Terminar | «Cerramos la sesión» | Anota en `STATUS.md` lo hecho, quita los pasos completados, añade los nuevos y propone commit y push. |
| Cambiar de chat o de equipo a medias | «Sigo en otro chat» | Deja un relevo con el punto exacto en que queda el trabajo. El siguiente chat lo recibe al retomar. |
| Repasar | «¿Qué hice esta semana?» | Sesiones anotadas y commits sin anotar de todos los proyectos. |

En Claude Code existen además `/proyectos`, `/retomar <proyecto>`, `/cerrar` y `/relevo`.

Un proyecto sin ficha aparece como «sin STATUS.md». Al retomarlo, la IA se ofrece a crear sus fichas analizando el código.

## Herramientas del servidor MCP

| Herramienta | Qué hace |
|---|---|
| `list_projects` | Panorama en una tabla: estado git, siguiente paso, avisos que importan hoy, proyecto recomendado y repos de GitHub sin clonar. |
| `get_project_context` | Lo necesario para retomar un proyecto: `siguienteAccion`, `avisos`, relevo, estado, pasos, última sesión y commits sin anotar o por bajar. Con `contexto` añade el archivo de contexto; con `detalle: "completo"`, todo. |
| `update_status` | Guarda el progreso en `STATUS.md`: sesión, pasos completados y nuevos, estado, decisiones y problemas. |
| `save_handoff` | Deja un relevo con el trabajo a medias para otro chat u otro equipo. |
| `get_project_map` | Estructura del proyecto en pocas líneas. |
| `work_report` | Qué se ha hecho en los últimos días en todos los proyectos. |
| `search_projects` | Busca texto o una regex en un proyecto o en todos. |
| `read_project_file`, `list_project_files` | Lee (entero o por rango de líneas) y lista archivos de cualquier proyecto por su ruta relativa. |
| `git_summary` | Rama, commits sin subir o por bajar, cambios y últimos commits. |
| `set_project_info` | Cambia la descripción o la prioridad de un proyecto. |
| `clone_project` | Clona un repo de tu cuenta de GitHub y lo añade al hub. |
| `hub_health` | Comprueba la instalación. Cada problema trae su solución. |

El servidor **nunca hace commit, push, pull ni borra nada**. Esas acciones las hace la IA con sus propias herramientas y pidiéndote confirmación.

### Avisos

Cada proyecto llega con una lista de avisos, y cada aviso con la instrucción exacta para la IA. Los principales:

| Código | Cuándo |
|---|---|
| `commits_por_bajar`, `ramas_divergidas` | Hay trabajo en el remoto que no está aquí. |
| `sin_subir_en_otro_equipo` | En otro de tus equipos quedaron commits sin subir o cambios sin commit. |
| `relevo_pendiente` | Un chat anterior dejó trabajo a medias. |
| `ficha_desactualizada` | Hay commits posteriores a la última actualización de `STATUS.md`. |
| `sin_status`, `sin_contexto` | Falta una ficha. |
| `cambios_sin_commit`, `commits_sin_subir` | Hay trabajo que tu otro equipo no verá. |
| `rama_con_otro_nombre`, `rama_secundaria` | La rama local no es la habitual. |
| `no_editar`, `regla`, `fuente_de_otro`, `tiene_fuentes` | Rutas generadas, reglas propias y relaciones entre repos que tú declaras. |
| `sin_prioridad`, `inactivo`, `calidad_ficha` | Datos que faltan, más de 30 días sin tocar o ficha incompleta. |

## CLI

```text
projecthub instalar     Prepara este equipo (se puede repetir)
projecthub dashboard    Abre el dashboard en http://localhost:4310
projecthub proyectos    Tabla con el estado de todos los proyectos (--json)
projecthub informe      Qué se ha hecho en los últimos días (--dias N)
projecthub sync         Sincroniza la configuración entre tus equipos
projecthub uso          Tokens que ha devuelto cada herramienta a la IA
projecthub clientes     Clientes de IA de este equipo y si tienen el servidor
projecthub doctor       Comprueba la instalación
projecthub mcp          Arranca el servidor MCP (lo ejecutan los clientes)
```

## El dashboard

`projecthub dashboard` abre una página local con una tarjeta por proyecto: descripción, prioridad, stack, actividad, estado git y siguiente paso. Desde cada tarjeta se abre el proyecto en VS Code, la terminal, el explorador o GitHub, y se copia la petición para retomarlo con la IA. El panel de detalle permite marcar y añadir pasos y cambiar la prioridad. También lista los repos de GitHub sin clonar, con un botón para clonarlos.

Lo que cambias en el dashboard se guarda en los mismos archivos que usa la IA.

## Configuración

Todo está en `~/.projecthub`. Para usar otra carpeta, define la variable de entorno `PROJECTHUB_HOME`.

**`config.json`**, lo que es igual en todos tus equipos:

```json
{
  "github": { "user": "tu-usuario", "hideForks": true, "ignore": ["repo-que-no-quiero-ver"] },
  "exclude": ["carpeta-que-no-es-un-proyecto"],
  "projects": {
    "mi-web": {
      "repo": "mi-web",
      "descripcion": "La web de la tienda",
      "prioridad": "alta",
      "noEditar": ["src/generated/"],
      "reglas": ["Los textos legales no se cambian sin avisar."]
    },
    "mi-web-tema": { "repo": "mi-web-tema", "fuenteDe": "mi-web" }
  }
}
```

| Campo | Para qué |
|---|---|
| `github.user` | Cuenta de la que se listan los repos sin clonar. |
| `github.ignore`, `github.hideForks` | Repos que no quieres ver en esa lista. |
| `exclude` | Carpetas que no se tratan como proyectos aunque sean repos. |
| `projects.<nombre>.repo` | Nombre del repo en GitHub. Empareja la ficha con la carpeta aunque se llame distinto en cada equipo. |
| `descripcion`, `prioridad` | Prioridad: `alta`, `media`, `baja` o `archivado`. |
| `noEditar` | Rutas generadas. La IA recibe el aviso de no editarlas a mano. |
| `reglas` | Reglas del proyecto que la IA recibe siempre. |
| `fuenteDe` | Este repo alimenta a otro proyecto. La IA avisa de dónde se hace cada cambio. |

**`local.json`**, lo propio de cada equipo:

```json
{
  "roots": ["C:/Users/yo/Documents", "C:/Users/yo/Documents/Proyectos"],
  "cloneDir": "C:/Users/yo/Documents/Proyectos",
  "githubToken": ""
}
```

Sin `githubToken` solo se listan tus repos públicos, con el límite de 60 consultas por hora de GitHub. Para ver los privados, crea un *fine-grained token* de solo lectura y pégalo ahí.

## Varios equipos

Lo que no está en el remoto, el otro equipo no lo ve. El hub te avisa de ello en los dos sentidos.

| Qué | Dónde vive | Cómo se sincroniza |
|---|---|---|
| Código y fichas de cada proyecto | En su repo | Push al cerrar, pull al retomar. La IA lo propone. |
| Trabajo a medias | `.projecthub/relevo.md` en el repo | Viaja con un commit y push, que la IA propone al dejar el relevo. |
| Prioridades, descripciones, reglas | `~/.projecthub/config.json` | `projecthub sync` |
| Qué quedó sin subir en cada equipo | `~/.projecthub/equipos/` | `projecthub sync` |
| Carpetas y token | `~/.projecthub/local.json` | No se sincroniza. |

Para activar la sincronización, crea un repo privado vacío y ejecuta en cada equipo:

```bash
projecthub sync --remote <url del repo>
```

Desde entonces el hub baja la configuración al retomar y la sube al cerrar. Con ella, cada equipo anota qué proyectos tiene con commits sin subir o cambios sin commit, y al retomar uno en otro equipo la IA avisa: «en el equipo de clase quedaron 3 commits sin subir». Si el primer equipo ya los subió, el aviso desaparece solo.

Es la única carpeta en la que el hub hace commit y push por su cuenta: contiene su propia configuración, no tu código.

## Seguridad

- **Archivos bloqueados:** `.env` (salvo `.env.example`), claves (`*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`), `node_modules/`, `vendor/` y `.git/`.
- **Sin salir del proyecto:** no se leen rutas fuera de la carpeta de cada proyecto.
- **Dashboard solo local:** escucha en `127.0.0.1`, rechaza otros `Host` y exige una cabecera propia en las peticiones que cambian algo.
- **Clonado restringido:** `clone_project` solo clona repos de tu cuenta de GitHub.
- **Nada destructivo:** ni el servidor ni el dashboard hacen commit, push, reset ni borrados.
- **El token** de GitHub solo vive en `local.json`, en tu equipo.

## Actualizar desde la versión 1

En la versión 1 la configuración estaba dentro del repo (`hub.config.json` y `hub.local.json`). Al ejecutar `npm run instalar` con la versión 2 se copian a `~/.projecthub` y dejan de usarse. Hazlo en cada equipo **antes** de bajar un commit que los borre del repo.

## Desarrollo

```text
bin/projecthub.mjs    CLI
mcp-server.mjs        servidor MCP (stdio)
dashboard.mjs         servidor del dashboard
public/index.html     interfaz del dashboard, sin dependencias
instalar.mjs          instalador
lib/hub.mjs           núcleo: escaneo, avisos, git, STATUS.md, GitHub, seguridad, informe
lib/clientes.mjs      clientes de IA y registro del servidor en cada uno
lib/resumen.mjs       respuestas breves, mapa del proyecto, consumo y sincronización de la configuración
lib/instalacion.mjs   extras de Claude Code y comprobación de la instalación
hooks/                hooks SessionStart y Stop de Claude Code
skills/               procedimientos de proyectos, retomar, cerrar y relevo (skills y prompts MCP)
templates/            plantillas de las fichas
test/                 tests (npm test)
```

```bash
npm test          # 43 tests, sin tocar proyectos reales
npm run doctor    # estado de la instalación
```

- La lógica nueva va en `lib/hub.mjs`, con su test. Las funciones de avisos son puras.
- Una instrucción que dependa del estado del proyecto va en `computeAvisos`, no en las skills: así llega a todas las IAs y al dashboard.
- Para añadir un cliente, basta una línea en `clientes()` de `lib/clientes.mjs`.
- Toda respuesta nueva del servidor es breve por defecto y tiene un test con su máximo de tokens.

## Solución de problemas

| Problema | Solución |
|---|---|
| La IA no tiene las herramientas | Reinicia el cliente. `projecthub clientes` dice si el servidor está registrado; si no, `projecthub instalar`. |
| Un proyecto no aparece | Debe ser un repo git en el primer nivel de una carpeta de `roots` y no estar en `exclude`. |
| «No se pudo consultar GitHub» | Sin conexión o límite de la API. Espera o añade `githubToken`. |
| No salen los repos privados | Hace falta `githubToken` en `local.json`. |
| Algo parece viejo o roto | `projecthub doctor`, o pide a la IA que llame a `hub_health`. |
| Quitar los extras de Claude Code | Borra las entradas de `hooks` en `~/.claude/settings.json` y el bloque entre marcas de `~/.claude/CLAUDE.md`. |

## Licencia

[MIT](LICENSE)
