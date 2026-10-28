# ProjectHub

**Centro de control de todos mis proyectos, y el intermediario entre ellos y Claude Code.**

Cada proyecto sabe qué es y en qué punto se quedó, y Claude puede consultarlo al momento, desde cualquier carpeta y desde cualquiera de mis equipos, sin que tenga que volver a explicárselo.

---

## Índice

1. [El problema que resuelve](#el-problema-que-resuelve)
2. [Cómo funciona](#cómo-funciona)
3. [Instalación](#instalación)
4. [Uso diario](#uso-diario)
5. [El dashboard](#el-dashboard)
6. [Claude: skills y servidor MCP](#claude-skills-y-servidor-mcp)
7. [Trabajar en varios equipos](#trabajar-en-varios-equipos)
8. [Configuración](#configuración)
9. [Seguridad](#seguridad)
10. [En qué mejora la productividad](#en-qué-mejora-la-productividad)
11. [Buenas prácticas](#buenas-prácticas)
12. [Estructura del repositorio y desarrollo](#estructura-del-repositorio-y-desarrollo)
13. [Solución de problemas](#solución-de-problemas)
14. [Mejoras pendientes](#mejoras-pendientes)

---

## El problema que resuelve

Sin ProjectHub, cada sesión con Claude empieza de cero:

- Hay que volver a explicarle el proyecto: qué es, cómo está hecho y qué convenciones sigue.
- Hay que recordar uno mismo dónde se quedó, qué faltaba y qué se había decidido.
- Los proyectos están repartidos en varias carpetas y en dos equipos, y lo que se hace en uno no se ve en el otro.
- Lo que ya resolví en un proyecto (autenticación JWT, mapas, despliegues) no lo aprovecho en el siguiente.

ProjectHub soluciona esto con tres ideas:

1. **Una ficha por proyecto**, guardada dentro del propio repo, que dice cómo está hecho y dónde se quedó.
2. **Un intermediario (servidor MCP)** que deja a Claude ver, buscar y actualizar cualquier proyecto por su nombre.
3. **Un dashboard** para ver de un vistazo el estado de todo.

---

## Cómo funciona

```
              Yo                                   Claude Code
               │                                        │
     Dashboard (navegador)                    Skills + servidor MCP
     http://localhost:4310                    /proyectos /retomar /cerrar
               │                                        │
               └──────────────────┬─────────────────────┘
                                  │
                         lib/hub.mjs  (núcleo)
                                  │
      ┌───────────────────────────┼────────────────────────────┐
      │                           │                            │
 Repos locales              hub.config.json               GitHub (Serwii01)
 ├─ CLAUDE.md               prioridades, descripciones,   repos no clonados,
 └─ STATUS.md               repos ocultos                 sincronización (fetch)
```

### 1. Las fichas: `CLAUDE.md` y `STATUS.md` en cada repo

Son la parte más importante del sistema.

| Archivo | Responde a | Contenido |
|---|---|---|
| `CLAUDE.md` | **¿Cómo está hecho?** | Qué es, stack, estructura de carpetas, comandos, convenciones, despliegue. Claude Code lo lee solo al abrir esa carpeta. |
| `STATUS.md` | **¿Dónde lo dejé?** | Estado actual, siguientes pasos (casillas), últimas 5 sesiones, decisiones tomadas y problemas conocidos. |

Viven **dentro de cada repo**, así que viajan con él por GitHub: la ficha es la misma en todos los equipos.

Formato de `STATUS.md` (plantilla en `templates/STATUS.md`):

```markdown
## Estado actual
2–4 líneas: en qué fase está, qué funciona, qué no.

## Siguientes pasos
- [ ] Lo próximo, por orden de prioridad

## Última sesión
### 2026-10-27
- Lo que se hizo

## Decisiones
- Decisiones de diseño y su porqué

## Problemas conocidos
- Bugs, deuda técnica
```

### 2. El núcleo: `lib/hub.mjs`

Lo comparten el CLI, el servidor MCP y el dashboard, así que todos ven exactamente los mismos datos. Se encarga de:

- **Escanear** las carpetas configuradas y detectar los repos git.
- **Detectar el stack** a partir de `package.json`, `composer.json`, `pom.xml`, Docker, Vercel o Supabase, en la raíz y un nivel por debajo.
- **Calcular el estado git**: rama, cambios sin commit, commits sin subir y commits por bajar. Si una rama no tiene upstream configurado, compara con `origin/<rama>`.
- **Fechar el último trabajo real**, sin contar los commits que solo tocan `CLAUDE.md` o `STATUS.md`.
- **Detectar fichas desactualizadas**: commits con trabajo posteriores al último commit que tocó `STATUS.md`. Es decir, lo que se hizo sin `/cerrar`, por ejemplo en el otro equipo.
- **Leer y escribir `STATUS.md`** por secciones, sin romper el formato.
- **Consultar GitHub** para saber qué repos de la cuenta no están clonados en este equipo.
- **Proteger** el acceso: no lee `.env`, claves ni `node_modules`, y no sale de la carpeta del proyecto.

### 3. El intermediario: servidor MCP `project-hub`

Es un servidor [MCP](https://modelcontextprotocol.io) que se comunica por stdio y está registrado a nivel de usuario en Claude Code. Da a Claude herramientas para trabajar con los proyectos **por su nombre**, esté en la carpeta que esté. La lista completa está en [Claude: skills y servidor MCP](#claude-skills-y-servidor-mcp).

### 4. El dashboard

Es una página web local (`dashboard.mjs` + `public/index.html`) que lee los datos en vivo de los repos. Está detallada en [El dashboard](#el-dashboard).

---

## Instalación

Requisitos: **Git** y **Node.js 20+**.

### En un equipo nuevo

```bash
cd ~/Documents
git clone https://github.com/Serwii01/ProjectHub.git
cd ProjectHub
npm install
npm run instalar
```

El instalador hace cuatro cosas:

1. Crea `hub.local.json` con las carpetas de este equipo. Por defecto busca en `Documents` y `Documents/Proyectos`, y clona en `Documents/Proyectos`.
2. Copia las skills `/proyectos`, `/retomar` y `/cerrar` a `~/.claude/skills`, ajustando las rutas a este equipo.
3. Registra el servidor MCP `project-hub` en `~/.claude.json`, después de hacer una copia de seguridad en `~/.claude/backups/`.
4. Hace un primer escaneo y lista los proyectos que encuentra.

Después:

- **Reinicia Claude Code**, porque los servidores MCP solo se cargan al arrancar.
- Si tus proyectos están en otra carpeta, edita `roots` en `hub.local.json` y vuelve a ejecutar `npm run instalar`.
- Los proyectos que no tengan ficha aparecerán como "sin STATUS.md". Ejecuta `/retomar <proyecto>` y Claude se ofrecerá a crear su `CLAUDE.md` y su `STATUS.md` analizando el código.

`npm run instalar` se puede repetir sin problema. Hazlo cada vez que cambies algo en `skills/`.

---

## Uso diario

### Al empezar a trabajar

**Opción A, desde el dashboard.** Haz doble clic en `Abrir dashboard.cmd`. La tarjeta **"Para seguir ahora"** muestra el proyecto recomendado y su siguiente paso. Pulsa **Copiar /retomar** y pégalo en Claude Code.

**Opción B, directamente en Claude:**

| Escribe | Qué pasa |
|---|---|
| `/proyectos` | Panorama de todo: tabla de estado, alertas (sin subir, por bajar, inactivos, sin ficha) y una recomendación de en qué trabajar. |
| `/retomar PrestArte` | Claude hace `git fetch`, te avisa si hay trabajo de otro equipo (y propone `git pull`), lee `CLAUDE.md` y `STATUS.md`, y te resume qué es, dónde lo dejaste y cuál es el siguiente paso. |

Vale con un prefijo: `/retomar prest`. Si el proyecto solo existe en GitHub, Claude se ofrece a clonarlo.

### Mientras trabajas

Se trabaja con Claude como siempre. La diferencia es que ahora puede consultar **otros** proyectos:

- *"¿Cómo hice la descarga de archivos con permisos en PrestArte? Quiero algo parecido en ropa."*
- *"Busca en todos mis proyectos dónde uso Leaflet."*
- *"Copia la configuración de Vercel de GeoHub para rukujack."*
- *"¿Qué proyectos tienen cosas sin subir?"*

### Al terminar

Escribe **`/cerrar`**. Claude:

1. Repasa lo hecho en la conversación y en git.
2. Actualiza `STATUS.md`: añade la sesión de hoy, quita los pasos completados, añade los nuevos y anota decisiones y problemas.
3. Si cambió la arquitectura o los comandos, actualiza también `CLAUDE.md`.
4. Te pregunta si hacer **commit y push**. Di que sí al push: es lo que permite que el otro equipo vea el progreso.

---

## El dashboard

Se abre con doble clic en **`Abrir dashboard.cmd`** o con `npm run dashboard`. La dirección es **http://localhost:4310**.

| Zona | Para qué sirve |
|---|---|
| **Contadores** | Proyectos, con cambios sin subir, prioridad alta, sin tocar más de 30 días. Al pulsarlos se filtra la lista. |
| **Para seguir ahora** | El proyecto recomendado (prioridad más alta con un siguiente paso claro) y botones para empezar. |
| **Tarjetas** | Una por proyecto: descripción, prioridad, stack, actividad (punto verde si es de menos de 7 días, ámbar hasta 30, gris si es más antiguo), rama, estado git y siguiente paso. |
| **Acciones de tarjeta** | Copiar `/retomar`, abrir en VS Code, en el explorador, en la terminal (Windows Terminal) o en GitHub. |
| **Ficha desactualizada** | Si hay commits posteriores a la última vez que se guardó `STATUS.md` (se trabajó sin `/cerrar`), la tarjeta lo marca ("ficha sin N commits") y el detalle los lista, con un botón para pedirle a Claude que la ponga al día. |
| **Panel de detalle** | Se abre al pulsar una tarjeta. Pestañas: **Resumen** (estado, pasos con casillas, añadir pasos, cambiar prioridad o descripción), **Git** (cambios, últimos commits, ramas), **CLAUDE.md** y **TODOs** del código. |
| **En GitHub, no clonados aquí** | Repos de la cuenta que no están en este equipo, con los botones **Clonar aquí** y **Ocultar** (se ocultan en todos los equipos). |
| **Actualizar** | Hace `git fetch` de todos los repos, vuelve a escanear y vuelve a consultar GitHub. |

Atajos de teclado: `/` busca y `Esc` cierra el panel. La página se refresca sola al volver a la pestaña; por ejemplo, después de un `/cerrar`.

Los cambios que haces aquí (marcar pasos, añadir pasos, prioridades) se guardan en los mismos archivos que usa Claude. Las dos vías son intercambiables.

---

## Claude: skills y servidor MCP

### Skills

Están en `skills/`. El instalador las copia a `~/.claude/skills`.

| Skill | Cuándo | Qué hace |
|---|---|---|
| `/proyectos` | "¿Qué tengo pendiente?", "¿En qué trabajo hoy?" | Panorama, alertas y recomendación. También menciona los repos no clonados. |
| `/retomar <proyecto>` | "Sigamos con X", "¿Por dónde iba?" | Fetch, propuesta de pull si hace falta, lectura de las fichas y resumen con el siguiente paso. |
| `/cerrar` | "Lo dejamos aquí" | Guarda el progreso en `STATUS.md` y propone commit y push. |

Claude también las usa sin la barra, cuando lo que dices encaja con ellas.

### Herramientas del servidor MCP

| Herramienta | Descripción |
|---|---|
| `list_projects` | Proyectos clonados aquí (ruta, stack, prioridad, último commit, estado git, estado y siguientes pasos) y repos de GitHub no clonados. |
| `get_project_context` | Todo para retomar un proyecto en una sola llamada: `git fetch`, `CLAUDE.md`, `STATUS.md`, git y TODOs. |
| `list_project_files` | Archivos de un proyecto, respetando `.gitignore`. |
| `read_project_file` | Lee un archivo de cualquier proyecto por su ruta relativa. |
| `search_projects` | Busca texto o una regex en un proyecto o en todos a la vez. |
| `git_summary` | Rama, sin subir, por bajar, cambios, ramas, últimos commits y, opcionalmente, el diff. |
| `update_status` | Actualiza `STATUS.md`: sesión (con `fecha` opcional para anotar días anteriores), pasos completados y nuevos, estado, decisiones y problemas. **No hace commit.** |
| `set_project_info` | Cambia la descripción o la prioridad en `hub.config.json`. |
| `clone_project` | Clona en este equipo un repo de la cuenta de GitHub y lo añade al hub. |

El servidor nunca hace commit, push ni nada destructivo. Esas acciones las hace Claude con sus herramientas normales, y siempre preguntando.

---

## Trabajar en varios equipos

**Regla de oro: lo que no está en GitHub, el otro equipo no lo ve.**

| Qué | Dónde vive | Cómo se sincroniza |
|---|---|---|
| Código y fichas (`CLAUDE.md`, `STATUS.md`) de cada proyecto | En su repo | push al cerrar, pull al retomar |
| Prioridades, descripciones, repos ocultos | `hub.config.json` en este repo | commit y push de ProjectHub |
| Código del hub, skills, plantillas | Este repo | `git pull` y `npm run instalar` |
| Carpetas de este equipo, token | `hub.local.json` | No se sincroniza (es de cada equipo) |

El flujo en la práctica:

1. **Equipo A:** trabajas, haces `/cerrar` y aceptas el push.
2. **Equipo B:** haces `/retomar X`. Claude ve que hay commits por bajar y propone `git pull`. Después lee el `STATUS.md` que escribiste en A y continúa desde ahí.

Si un proyecto solo está en el otro equipo pero sí en GitHub, aparece en "no clonados" y se clona con un clic.

**Nombres de carpeta distintos:** el hub empareja cada carpeta con su ficha por el **nombre del repo en GitHub** (campo `repo` de `hub.config.json`). CreaFlow sigue siendo CreaFlow aunque en otro equipo la carpeta se llame `lamostudio`.

---

## Configuración

### `hub.config.json`: común, se sube a git

```json
{
  "github": {
    "user": "Serwii01",
    "hideForks": true,
    "ignore": ["Serwii01", "ProjectHub"]
  },
  "exclude": ["Obsidian Vault", "ProjectHub"],
  "projects": {
    "CreaFlow": {
      "repo": "lamostudio",
      "descripcion": "Lamo Studio: gestión de proyectos creativos",
      "prioridad": "media"
    }
  }
}
```

| Campo | Para qué |
|---|---|
| `github.user` | Cuenta de la que se listan los repos. |
| `github.hideForks` | Oculta los forks de la lista de no clonados. |
| `github.ignore` | Repos ocultos. Se añaden con el botón "Ocultar" del dashboard. |
| `exclude` | Carpetas que no se tratan como proyectos aunque sean repos git. |
| `projects.<nombre>.repo` | Nombre del repo en GitHub, para emparejarlo en cualquier equipo. |
| `projects.<nombre>.descripcion` / `prioridad` | Prioridad: `alta`, `media`, `baja` o `archivado`. Se pueden editar desde el dashboard o con Claude. |

### `hub.local.json`: de cada equipo, NO se sube

```json
{
  "roots": ["C:/Users/yo/Documents", "C:/Users/yo/Documents/Proyectos"],
  "cloneDir": "C:/Users/yo/Documents/Proyectos",
  "githubToken": ""
}
```

| Campo | Para qué |
|---|---|
| `roots` | Carpetas donde se buscan repos (solo el primer nivel de cada una). |
| `cloneDir` | Dónde se clonan los repos con "Clonar aquí" o `clone_project`. |
| `githubToken` | Opcional. Sin token solo se ven los repos públicos. Para ver también los privados, crea un *fine-grained token* en GitHub (Settings → Developer settings) con permiso de solo lectura sobre los repos y pégalo aquí. |

---

## Seguridad

- **Archivos bloqueados:** `.env` (salvo `.env.example`), `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `node_modules/`, `vendor/` y `.git/`.
- **Sin salir del proyecto:** no se pueden leer rutas fuera de la carpeta de cada proyecto (`../` está bloqueado).
- **Dashboard solo local:** escucha en `127.0.0.1` y rechaza peticiones con otro `Host`, para evitar ataques de *DNS rebinding*. Las acciones que cambian algo exigen la cabecera `X-Hub: 1`, así que otra web abierta en el navegador no puede lanzarlas.
- **Clonado restringido:** `clone_project` solo clona repos de la propia cuenta de GitHub, no URLs arbitrarias.
- **Nada destructivo:** ni el MCP ni el dashboard hacen commit, push, reset ni borrados.
- **El token** de GitHub vive solo en `hub.local.json`, que está en `.gitignore`.
- **Copia de seguridad:** el instalador copia `~/.claude.json` antes de modificarlo.

---

## En qué mejora la productividad

### 1. Se acabó el "¿por dónde iba?"

| Sin ProjectHub | Con ProjectHub |
|---|---|
| Explicar el proyecto a Claude en cada sesión | `/retomar X` y en segundos está en contexto |
| Claude explora archivos para entenderlo, lo que gasta tiempo y tokens | Lee `CLAUDE.md`: ya sabe stack, estructura y comandos |
| Recordar de memoria qué faltaba | `STATUS.md` dice exactamente el siguiente paso |
| Olvidar detalles críticos ("esta rama no compila") | Están en "Estado actual" y "Problemas conocidos" |

Fácilmente se ahorran 10 o 15 minutos por sesión, y el arranque es mejor.

### 2. Claude respeta las reglas de cada proyecto

Con `CLAUDE.md`, Claude sabe que PlanifyPlus usa neumorfismo y no lleva emojis, o que en PrestArte los archivos se sirven con control de permisos. Hay menos idas y vueltas del tipo "así no se hace aquí".

### 3. Reutilizar lo que ya está resuelto

Muchos proyectos comparten piezas: JWT, Leaflet, Vercel, Angular con signals, Supabase. Con `search_projects` y `read_project_file`, Claude encuentra cómo lo resolviste y lo adapta, en lugar de empezar de cero.

### 4. Dos equipos sin perder trabajo

El hub hace `git fetch`, avisa de lo que hay por bajar, propone pull al retomar y push al cerrar. El estado de cada proyecto está siempre en GitHub, no en la cabeza ni en un equipo concreto.

### 5. Saber en qué trabajar

Con muchos proyectos es fácil dispersarse u olvidar uno. El dashboard muestra prioridades, lo que lleva semanas parado y lo que está a medias, y recomienda por dónde seguir.

### 6. Las decisiones quedan escritas

"¿Por qué hice esto así?" La respuesta queda en "Decisiones" de `STATUS.md`, para mí y para Claude, aunque pasen meses.

### 7. Menos fricción para empezar

Desde una tarjeta del dashboard estás a un clic de VS Code, la terminal o GitHub, y a un pegado de Claude con el contexto cargado.

---

## Buenas prácticas

- **El hábito clave:** `/retomar` al empezar y `/cerrar` al acabar. Si se salta `/cerrar`, `STATUS.md` se queda viejo y el sistema pierde valor.
- **Acepta el push en `/cerrar`.** Sin push, el otro equipo trabaja con información vieja.
- **Siguientes pasos concretos y ordenados:** "Compilar el backend y recorrer un préstamo" sirve más que "Mejorar el backend".
- **Mantén las prioridades al día** y marca como `archivado` lo que no vas a tocar.
- **Oculta los repos de prácticas** en la lista de no clonados para reducir ruido.
- **Proyecto nuevo:** créalo en una de las carpetas de `roots` y haz `/retomar`. Claude creará sus fichas.
- **Después de cambiar prioridades** desde el dashboard, haz commit y push de ProjectHub para que lleguen al otro equipo.

---

## Estructura del repositorio y desarrollo

```
ProjectHub/
├── lib/hub.mjs           núcleo compartido (escaneo, git, STATUS.md, GitHub, seguridad)
├── mcp-server.mjs        servidor MCP project-hub (stdio)
├── dashboard.mjs         servidor web del dashboard (localhost:4310)
├── public/index.html     interfaz del dashboard (HTML + JS sin dependencias)
├── scan.mjs              CLI: genera projects.json y PROJECTS.md
├── instalar.mjs          instalador para cada equipo
├── skills/               fuente de /proyectos, /retomar, /cerrar ({{HUB}} = ruta del hub)
├── templates/            plantillas de CLAUDE.md y STATUS.md
├── hub.config.json       configuración común (se sube)
├── hub.local.json        configuración de este equipo (no se sube)
├── Abrir dashboard.cmd   lanzador con doble clic
└── CLAUDE.md             contexto para Claude al trabajar en el propio hub
```

Archivos generados (no se suben): `projects.json`, `PROJECTS.md` y `.cache/` (caché de GitHub, 15 minutos).

### Comandos

```bash
npm run instalar    # instalar o actualizar en este equipo
npm run dashboard   # abrir el dashboard
npm run scan        # regenerar projects.json y PROJECTS.md
```

### Al modificar el hub

- La lógica nueva va en `lib/hub.mjs`, para que la usen el MCP, el dashboard y el CLI.
- Si cambias `lib/hub.mjs` o `mcp-server.mjs`, **reinicia Claude Code**; si cambias `dashboard.mjs`, reinicia el dashboard. Los cambios en `public/index.html` solo necesitan recargar la página.
- Si cambias algo en `skills/`, ejecuta `npm run instalar`.

---

## Solución de problemas

| Problema | Solución |
|---|---|
| Claude no tiene las herramientas `project-hub` | Reinicia Claude Code. Comprueba que `~/.claude.json` tiene `mcpServers.project-hub` (si no, `npm run instalar`). |
| Un proyecto no aparece | ¿Está dentro de una carpeta de `roots` (`hub.local.json`) y en el primer nivel? ¿Es un repo git? ¿Está en `exclude`? |
| "No se pudo consultar GitHub" | Sin conexión o límite de la API (60 peticiones por hora sin token). Espera o añade `githubToken`. |
| No salen mis repos privados | Hace falta `githubToken` en `hub.local.json`. |
| "El dashboard ya está abierto" | Ya hay uno en marcha; se abre el navegador en http://localhost:4310. |
| "Por bajar" no se actualiza | Pulsa **Actualizar** en el dashboard (hace `git fetch`) o usa `/retomar`. |
| Push rechazado (*non-fast-forward*) | Hay trabajo de otro equipo: `git pull` primero y después push. |
| "Última sesión" no coincide con lo que hice | Se trabajó sin `/cerrar`: el proyecto saldrá como "ficha sin N commits". Pídele a Claude *"pon al día el STATUS.md de X con los commits que faltan"*. |
| Conflicto en `STATUS.md` al hacer pull | Pasa si se cerró sesión en los dos equipos sin sincronizar. Quédate con las dos entradas de "Última sesión" y une los pasos. |

---

## Mejoras pendientes

Ideas para próximas versiones, por orden de impacto aproximado.

### Alto impacto

- **Recordatorio automático de `/cerrar`**: un *hook* de Claude Code al terminar la sesión que avise si hubo cambios en un proyecto y `STATUS.md` no se actualizó. Es el punto débil del sistema, porque depende del hábito.
- **Botón "Sincronizar todo"** en el dashboard: pull de lo que esté por bajar y push de lo que esté sin subir (solo en avance rápido y con confirmación). Evita olvidar el push antes de cambiar de equipo.
- **Aviso al cambiar de equipo**: al abrir el dashboard, un banner del tipo "3 proyectos tienen trabajo del otro equipo sin bajar".
- **Informe semanal**: una herramienta `weekly_report` que junte las sesiones de todos los `STATUS.md` ("qué hice esta semana"). Útil para memorias, tutorías o portfolio.

### Medio impacto

- **Biblioteca de recetas**: un `recetas.md` (o una herramienta MCP) con soluciones reutilizables enlazadas a su proyecto de origen, como "JWT en Spring", "Leaflet en Angular" o "PWA con Vite". Más directo que buscar en el código.
- **Salud de los proyectos**: estado del último despliegue (Vercel), dependencias desactualizadas (`npm outdated`) y vulnerabilidades (`npm audit`) en la tarjeta.
- **Issues de GitHub** como pasos: importar las issues abiertas a "Siguientes pasos", o mostrarlas en el panel.
- **Crear proyecto nuevo** desde el hub: carpeta, `git init`, fichas desde las plantillas y repo en GitHub.
- **Registro de tiempo**: cuántas sesiones o días se dedican a cada proyecto, a partir de las entradas de `STATUS.md`.

### Calidad

- **Tests automáticos** del núcleo, sobre todo de la lectura y escritura de `STATUS.md` y de las reglas de seguridad.
- **Arranque automático del dashboard** al iniciar Windows, o un icono en la bandeja.
- **Comprobación de versión**: avisar en el dashboard si ProjectHub tiene commits nuevos en GitHub (`git pull` + `npm run instalar`).
