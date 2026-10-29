@AGENTS.md

# Ogilvy Social Care

Plataforma multicliente de Ogilvy Colombia que atiende comentarios y mensajes de Facebook e Instagram. La IA propone la respuesta con la matriz y las plantillas del cliente, aprende por etapas (prueba → asistido → automático por tipo) y escala lo demás a una bandeja humana. Primer cliente: **Droguerías Cafam** (PQR de dispensación de EPS Sanitas en Valle del Cauca y Meta).

- **Estado de la plataforma** (pantallas, decisiones, pruebas reales, pendientes): `ogilvy/tech-docs/ogilvy-social-care.md` en la bóveda de Obsidian de Imderf. Se actualiza cuando cambia algo visible o una decisión.
- **Plan técnico** (arquitectura, APIs, cronograma, backlog por sprint): `resources/ogilvy/automatizacion-pqr-redes-cafam/plan-automatizacion-pqr-cafam.md` en la misma bóveda.
- **Proyecto de Cafam** (diagnóstico, matriz v1, plantillas): `ogilvy/colombia/clientes/cafam/automatizacion-pqr-redes-cafam.md`.
- **Responsable:** Imderf Ríos (Digital Technology, Ogilvy Colombia). Es el dueño del producto.

## Stack

| Pieza | Qué es |
|---|---|
| Panel web y webhooks | Next.js 16 (App Router, Cache Components) + TypeScript + Tailwind 4, en `src/`. El panel está en `/panel`. Pantallas:
  - Ingresar (`/ingresar`): usuario y contraseña.
  - Resumen: lo que requiere atención, indicadores, lo que dice la gente y qué hace la IA.
  - Bandeja en dos paneles, con historial del usuario, atajos j/k y respuesta desde la plataforma.
  - Pruebas, para aceptar, corregir o descartar propuestas.
  - Interacciones: vista Mensajes y vista Personas, con ficha por persona (`/panel/interacciones/persona/[id]`).
  - Matriz (editor por pasos), plantillas con versiones, base de conocimiento, cuentas y clientes.
 Tiene estilo de dashboard SaaS: fondo neutro, tarjetas con borde fino sin sombra, esquinas de 12 px, íconos lucide, tipografía Ogilvy Sans y el rojo Ogilvy solo para acciones, lo activo y las alertas. Las gráficas son SVG propio, con la paleta categórica validada (azul, naranja, aqua, amarillo) en `globals.css`. Cada página lee la base dentro de `<Suspense>`. El cliente se elige con el selector (cookie `cliente`, `src/app/panel/current.ts`) |
| Worker | Proceso Node aparte en `worker/`. Corre `.ts` directo con la eliminación de tipos de Node 24, sin compilar |
| Base | MariaDB 11.4 en el servidor (`socialcare_db`, usuario `socialcare_user`, puerto 3306 cerrado a internet) y MySQL 8 en la Mac. Driver `mysql2`. Migraciones SQL en `db/migrations/` (`npm run db:migrate`). El SQL tiene que correr en los dos: nada de `INSERT … AS n` (usar `VALUES(col)`), ni `->`/`->>` (usar `JSON_EXTRACT`), ni `CAST(? AS JSON)` (usar `JSON_EXTRACT(?, '$')`). MariaDB entrega el JSON como texto; `jsonCast` de `src/lib/db.ts` lo convierte con la lista `JSON_COLUMNS`, que hay que ampliar al crear una columna JSON |
| Cola | Tabla `jobs` tomada con `FOR UPDATE SKIP LOCKED` en READ COMMITTED (`src/lib/queue.ts`) |
| Procesos | Servidor Ogilvy 2 de RunCloud (Ubuntu 24.04, 1 núcleo, 2 GB compartidos), Web App `socialcare` en `~/webapps/socialcare`, detrás de Cloudflare. Dos trabajos de Supervisor creados en RunCloud: `socialcare-panel` (`next start -H 127.0.0.1 -p 3100`) y `socialcare-worker` (uno solo). El Public Path de la Web App es `/web`, que solo tiene el `.htaccess` que manda todo a `127.0.0.1:3100` (con `DirectoryIndex disabled`: sin eso Apache pide `/index.php` en la raíz) |
| App de Meta | "Ogilvy Social Care", App ID `1664432482008237`, en el portafolio Ogilvy Colombia. Publicada (modo activo) desde el 2026-10-23 con acceso estándar: solo atiende cuentas cuyos administradores tienen rol en la app. Para clientes hace falta App Review |

## Comandos

Usa Node 24 (`/usr/local/bin/node` en la Mac de Imderf; el `node` del PATH es otro).

```bash
npm run dev -- -p 3030  # panel en :3030 (entrada "social-care" del launch.json del vault)
npm run worker      # worker (lee .env)
npm run db:migrate  # aplica db/migrations pendientes
npm run db:seed:cafam  # carga o actualiza la matriz v1, las plantillas P1–P9 y los enlaces de Cafam
npm run db:seed:demo   # recrea el cliente demo en modo prueba: ~900 interacciones de 30 días con propuestas, respuestas del equipo y verificaciones
npm test            # firma de Meta, eventos y cola; necesita el MySQL local
npm run typecheck
```

**MySQL local en la Mac:** usa el binario de MAMP con una carpeta de datos propia, `~/Downloads/Ogilvy/social-care-mysql`, en el puerto 3307 y con root sin clave. Solo escucha en local. Las pruebas recrean la base `social_care_test`.

```bash
M=/Applications/MAMP/Library/bin/mysql80; D=~/Downloads/Ogilvy/social-care-mysql
$M/bin/mysqld --no-defaults --basedir=$M --datadir=$D/data --port=3307 --bind-address=127.0.0.1 --socket=$D/mysql.sock --mysqlx=OFF --log-error=$D/error.log
```

Al importar entre archivos que usa el worker, pon la extensión `.ts`, porque Node no resuelve rutas sin ella.

## Reglas que no se rompen

- **La base no guarda cédulas, fórmulas ni diagnósticos.** Los datos que se recolectan por DM se guardan cifrados solo hasta escribirlos en la Hoja del cliente y luego se borran. Las fotos van de Meta a Drive sin pasar por la IA ni quedar en disco.
- **A OpenAI solo llega texto enmascarado** (documentos, celulares, correos, direcciones), con `store: false`.
- **La IA no ejecuta acciones.** Solo devuelve JSON con el esquema del cliente, y el código decide y actúa. El contenido de comentarios y DM no es confiable.
- **Borrar comentarios es siempre una acción humana.** Lo automático solo puede ocultar, porque es reversible.
- **Solo se responde lo orgánico, por publicación** (`posts.origin`, `postOrigin` en `src/lib/meta.ts`, `originFor` en `src/lib/posts.ts`). El comentario en un anuncio que no salió en la página (o sobre el anuncio en Instagram) entra con `analysis_only`, y también el de una publicación orgánica mientras está pautada (decisión de Imderf, 2026-10-26). En Facebook, `promotion_status` explícito en el webhook la devuelve a orgánica; en Instagram no hay aviso del fin de la pauta. Cada uno de esos comentarios, si llega por webhook, crea un caso en la Bandeja como alerta, y `cannotSend` no deja responderlo desde la plataforma: se responde desde Meta.
- **Preguntas abiertas:** las plantillas tienen condición (`templates.when_to_use`), la base tiene datos por ciudad (temas `cobertura` y `dispensacion`, título = ciudad) y cada tipo de caso dice qué hacer si falta saber qué caso es (`flow.ambiguous`; por defecto cubrir en comentarios y preguntar por DM). Una respuesta con una variable sin llenar no cuenta como cubierta. Por DM la IA recibe `conversacion_previa` (24 h, sin el nombre).
- **Plantilla y base por canal** (`flow.public.base` / `flow.private.base`, `TOPICS` en `src/lib/flow.ts`): la respuesta sale de plantillas, de temas de la base o de ambos, y el texto de la acción los nombra («P1 / P10 pública + datos de la base (domicilios y cobertura)»). La IA solo usa esos temas (en una conversación por DM, los públicos y los del DM); `urlsOk` en `classify.ts` solo acepta enlaces de las plantillas y de esos temas (`allowedTopics`). `validateFlow` exige marcar la base si una plantilla tiene variables (`templateVars`). Los flujos guardados con el modo viejo «base» pasan a todos los temas (`withTopics`).
- **La IA solo publica lo que está en la plantilla o en la base** (`classify.ts`): todo enlace, dominio, correo, teléfono o @cuenta de la respuesta tiene que estar en las plantillas o en los temas de la base del tipo de caso (`DATA`, `dataOk`); máximo 1.000 caracteres (`MAX_REPLY`); «caso de fondo» solo con una plantilla y «corta» hasta 200 (`shapeOk`); «contención» es el texto fijo (`CONTENCION`); solo con base, la respuesta lleva un dato de la base (`hasDatum`); el nombre de la persona con enlace, teléfono o palabra prohibida no sale solo. Los ejemplos aprendidos van en el input (`examplesInput`), nunca en las instrucciones. Sin letras ni emojis → `ignorar`. El mismo comentario de la misma persona en la misma publicación en 24 h no se responde dos veces.
- **Ocultar no es atender** (`decide`): un comentario oculto que pregunta, reclama o deja sus datos crea caso en la Bandeja. Señal `accion_legal` (tutela, demanda, Supersalud) → alta. Crisis con insulto grave o amenaza → se oculta y escala como crítica.
- **Enmascarado** (`mask.ts`): no toca números con contexto (pedido, guía, radicado, factura, NIT) ni precios ni fechas; la línea fija queda `[teléfono]` y no hace ocultar.
- **Solo un worker.** Publicar marca la acción `enviando` antes de llamar a Meta y no se reintenta sola desde ahí (evita respuestas duplicadas); las llamadas a Meta cortan a los 20 s.
- **Hoja de casos** (`src/lib/cases.ts`, `src/lib/google.ts`, `/panel/hoja`, `/api/google/*`): login con Google por cliente (permiso `drive.file` + selector de Google; token de renovación cifrado en `google_connections`), lectura en los turnos del cliente (`clients.settings.cases.times`, 2 por defecto; el worker revisa cada minuto con `dueSyncs`), solo casos de quien escribió por los canales elegidos (`origin`: `dm` o `dm_comentario`). Lo que ya estaba la primera vez no se avisa. El estado se reconoce por el comienzo de la celda (`stateOf`; gana el más largo) y solo cuenta como cambio pasar a otro estado. El selector solo muestra Hojas de cálculo de Google (un `.xlsx` no se lee con la API). El aviso es texto fijo del estado (sin IA) y sale por su propio camino (`case_notices`, trabajo `notice_send`, no `actions`): menos de 24 h solo; de 24 h a 7 días desde la Bandeja con `HUMAN_AGENT`; después espera a que la persona escriba (`releaseWaitingNotices`). El eco del aviso no cuenta como respuesta del equipo.
- **Google Business Profile (reseñas de Google)** (`src/lib/gbp.ts`, `src/lib/reviews.ts`, `db/seed-resenas.ts`, `/api/gbp/*`, sección en `/panel/cuentas`): «Conectar con Google» (login con permiso `business.manage`, mismas `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` de la Hoja de casos; la URL de regreso es `PANEL_URL/api/gbp/callback` y hay que agregarla al cliente OAuth) detecta solo las cuentas y sedes de quien se conecta; el token de renovación va cifrado en `gbp_connections` (uno por cliente). Cada sede es una cuenta `platform = 'gbp'` (`meta_id` = `accounts/X/locations/Y`) **siempre en modo prueba**: `setAccountMode` no la pasa a asistido. El worker lee las reseñas cada 5 minutos (`gbp_sync`; la primera vez, 30 días) y cada una es una interacción `kind = 'resena'` con su `rating`. Se clasifican aparte (`classifyReview`) con su propia matriz: `case_types.applies_to` y `templates.applies_to` valen `redes` o `resenas` (`loadMatrix(db, clientId, scope)`; `createClient` los conserva al copiar). Reglas: 1 o 2 estrellas, señales de riesgo, tipos que no son automáticos, poca confianza o datos que no están en las plantillas van a una persona; una reseña solo con estrellas se agradece con una plantilla que rota (sin llamar a la IA) si trae 4 o 5; una reseña nunca se oculta. **Todavía no se responde en Google** (falta `PUT .../reply`, estados `PENDING` y `REJECTED`): la Bandeja dice que se responde desde Google Business Profile. Para que Google deje leer, el proyecto de Google Cloud necesita la aprobación de acceso a la API de Business Profile (cuota 0 hasta entonces: la pantalla lo explica con el error 403). `npm run db:seed:resenas -- <cliente>` carga la matriz y las plantillas v1 de reseñas (borrador por revisar con Cafam).
- **Perfil de quien escribe** (`src/lib/influence.ts`, `refreshProfile` en `meta-events.ts`, `PROFILES` en `meta.ts`): se lee a Meta la primera vez y cada 7 días (IG DM: User Profile; IG comentario: Business Discovery con el token de usuario de la conexión y `instagram_manage_insights`; FB comentario: si es página, sus seguidores). Persona importante (`lists.kind = 'vigilancia'`), influenciador desde el nivel del cliente (`clients.settings.influence`) o cuenta verificada: `decide` escala sin respuesta automática.
- **Ninguna respuesta lleva palabras prohibidas** (`lists.kind = 'prohibida'`, `src/lib/forbidden.ts`). La IA las recibe en sus instrucciones y tiene un segundo intento; si insiste, no sale sola. `reviewProposal` y `sendFromInbox` rechazan el texto que las tenga. Todo camino nuevo que publique texto pasa por `forbiddenError`.
- **Todas las tablas de negocio llevan `client_id`, y toda consulta a ellas filtra por `client_id` en el código.** MySQL no tiene RLS. Las funciones de acceso a datos reciben `clientId` como argumento obligatorio, y cada módulo nuevo trae una prueba que confirma que un cliente no ve datos de otro.
- **Las lecturas del panel están en `src/lib/data.ts`** y `tests/data.test.ts` prueba el aislamiento entre clientes de cada una. Una lectura nueva entra a esa prueba.
- **El panel solo escucha en 127.0.0.1** (`next dev -H 127.0.0.1`, `next start -H 127.0.0.1`). En el servidor (`PANEL_PUBLICO=1`) el panel se sirve en `https://socialcare.colombiaogilvy.com` detrás de su login. En la Mac, sin esa variable, `src/proxy.ts` responde 404 a todo lo que llegue por el dominio público (o con `cf-ray`) fuera de las páginas legales, el webhook y conectar/callback, y a cualquier `Next-Action` por ahí. En producción, `next build` + `next start`, nunca `next dev`.
- **Ingreso al panel con usuario y contraseña.** Los usuarios se crean o cambian de contraseña con `npm run usuario -- <usuario> [nombre]` (la contraseña se pide aparte, nunca va en el comando). El proxy (`src/proxy.ts`) protege `/panel` (solo la firma) y `currentUser()` → `sessionValid` revisa además la versión de sesión del usuario en cada página y acción (cambiar la contraseña sube `users.session_version` y cierra las sesiones). Las firmas usan `SESSION_SECRET`, aparte de `TOKEN_ENCRYPTION_KEY`. Bloqueo: 5 intentos por usuario, 20 por IP, sin alargarse mientras dura. Conectar con Meta exige el permiso firmado que pone el panel (corre en otro dominio). **Roles y administración de usuarios** (`src/lib/users.ts`, `src/lib/permissions.ts`, `/panel/usuarios`, `/panel/cuenta`): tres roles en `users.role`: `admin` (todo, incluidos Usuarios y Clientes), `operador` (Bandeja e Interacciones) y `verificador` (Pruebas); Resumen y Mi cuenta los ven todos. Los permisos son `bandeja`, `pruebas`, `config` y `usuarios` (`ALLOWED`) y cada página y acción los exige con `currentUser(permiso)` o `currentClient(permiso)` (`src/app/panel/current.ts`): **toda página o acción nueva del panel pide su permiso**. Los administradores ven todos los clientes; los demás, solo los de `client_members` (`listClientsOf`; `currentClient` y `selectClient` lo revisan en cada solicitud). La administración crea usuarios con un **enlace para crear la contraseña** (por defecto: `/crear-clave?t=…`, texto firmado con `SESSION_SECRET` que lleva el id y la `session_version`; sirve una vez, vence a los 7 días y uno nuevo anula el anterior; la cuenta nace con `password_hash` NULL y no puede ingresar hasta que la persona elige su contraseña) o con una contraseña temporal generada (se muestra una sola vez, no se guarda; `must_change_password` obliga a cambiarla en Mi cuenta), restablece, desactiva (la sesión muere al instante: `sessionValid` revisa `active`), quita el bloqueo por intentos y asigna clientes. Reglas: siempre queda un administrador activo y nadie se desactiva, se restablece ni se quita el rol a sí mismo. Todo queda en `user_events` (sin contraseñas). `npm run usuario` sigue sirviendo para crear o recuperar el primer administrador en el servidor.
- **Toda cuenta conectada arranca en modo prueba (`accounts.mode = 'prueba'`).** Recibe los comentarios y DM reales, los clasifica y guarda la respuesta que daría (`interactions.proposed_reply`), pero **no publica nada en Meta**. El equipo sigue respondiendo desde Meta Business Suite, y la respuesta del equipo llega por webhook a `human_reply`. El equipo verifica las propuestas en `/panel/pruebas` (tabla `verifications`).
  - **Etapas (decisión de Imderf, 2026-10-23):** prueba → asistido (`accounts.mode = 'en_vivo'`) → automático por tipo de caso.
    - En asistido, la IA propone y una persona acepta, corrige o descarta en `/panel/pruebas`. Aceptar publica en Meta con una fila de `actions` y el trabajo `publish` (`src/lib/publish.ts`). Pasar una cuenta de prueba a asistido es manual (Cuentas).
    - Un tipo responde solo (`case_types.live_enabled`, lo calcula `refreshGraduation` en `src/lib/learning.ts`) cuando la cuenta lleva los días de aprendizaje del cliente (`clients.settings.learning_days`, 7 por defecto) en asistido y el tipo tiene 90 % de correctas con al menos 20 revisiones (`ACCURACY_TARGET` y `MIN_VERIFIED`). Si el acierto baja, vuelve a pedir aprobación solo.
    - Las correcciones (`verifications.corrected_reply`) y las aceptadas son los ejemplos que la IA recibe de ese cliente (`learnedExamples`), sin el usuario.
    - En modo prueba nunca se publica: `enqueuePublish` no hace nada si la cuenta no está en asistido.
- **El cliente demo es solo para desarrollo.** Tiene `settings.demo = true` y el panel muestra un aviso cuando está seleccionado. No se carga en producción.
- **Diseño:** antes de cambiar la interfaz, revisa el catálogo de errores de interfaces hechas con IA de Impeccable (impeccable.style/slop): nada de franjas de color a un lado de las tarjetas, etiquetas encima de los títulos, borde y sombra a la vez, tarjetas dentro de tarjetas, texto de menos de 12 px ni texto de cuerpo en mayúsculas.
- **La base solo se usa desde el servidor y el worker.** El puerto 3306 está cerrado a internet y la base no se expone al navegador. Faltan los respaldos diarios, cifrados y fuera del servidor.
- **Secretos solo en variables de entorno** (ver `.env.example`). Los tokens de Meta van cifrados en la base (AES-256-GCM con `TOKEN_ENCRYPTION_KEY`). Nada de secretos en el repo, en prompts ni en logs.
- **El receptor de webhooks valida la firma `X-Hub-Signature-256`, guarda el evento crudo, encola y responde 200.** No hace lógica pesada. El crudo se vacía al procesarlo (`payload = {}`) y se borra a los 7 días; el cuerpo se limita a 512 KB.
- **No se usa el perfil compartido de Facebook "David".** La app se administra desde cuentas personales.

## Sprints

| Sprint | Fechas | Estado |
|---|---|---|
| 0 · Base | 19–23 oct | Hecho. En producción desde el 2026-10-28 en el servidor Ogilvy 2, con `socialcare.colombiaogilvy.com` y la llave de OpenAI |
| 1 · Conexión con Meta | 26–30 oct | Hecho antes de tiempo: Login for Business con tokens cifrados, `meta_event`, leer, responder, ocultar, DM e historial de 30 días. Faltan me gusta (FB), respuesta privada a un comentario y reintentos con espera |
| 2 · Cerebro | 3–6 nov | Hecho antes de tiempo: editor de matriz por selecciones, plantillas con versiones, base de conocimiento, reglas fijas, enmascarado, clasificación con OpenAI, motor de decisión y etapas de aprendizaje. Faltan listas, simulador y la evaluación con los 77 mensajes reales |
| 3 · Operación | 9–13 nov | Hechos: bandeja con respuesta, verificación en Pruebas, dashboard, historial por persona, ingreso con usuario y contraseña, clientes. Faltan flujo de DM, Sheets y Drive, invitaciones y roles, y video para App Review |
| 4 · Endurecer | 17–20 nov | Hecho el freno automático por tipo. Faltan revisión de seguridad, reconciliación, alertas, freno de emergencia, purga y eliminación de datos |

- **Pruebas en modo desarrollo:** no se crean página ni Instagram de prueba. Se conecta una de las páginas que Imderf ya tiene en sus portafolios personales.
- **Servidor:** `ssh socialcare` (llave `~/.ssh/socialcare-deploy`, usuario `socialcare@23.239.19.19`). En Cloudflare, `socialcare.colombiaogilvy.com` es un registro A con proxy hacia el servidor, con SSL de Let's Encrypt en RunCloud.
  - **Desplegar:** compilar en la Mac (`npx next build`; el servidor tiene 1 núcleo), `rsync` del código sin `node_modules` ni `.env`, `rsync --delete` de `.next/` sin `cache` ni `dev`, `npm ci --omit=dev` si cambian las dependencias y `node --env-file=.env db/migrate.ts` si hay migraciones. Para reiniciar se mata el proceso (`next-server` y `worker/index.ts`) y Supervisor lo levanta.
  - **Pruebas sobre MariaDB:** en el servidor, con la base `socialcare_db_test`. Nunca se carga el `.env` completo: `DATABASE_URL` y `TEST_DATABASE_URL` apuntan las dos a la de prueba.
  - El `.env` del servidor tiene su propio `SESSION_SECRET` y la misma `TOKEN_ENCRYPTION_KEY` de la Mac, porque los datos se pasaron de una base a la otra.
  - **No correr el worker de la Mac contra Meta** mientras el del servidor esté activo. El túnel `social-care` de la Mac ya no recibe tráfico.
- **Pendiente de Meta:** la verificación del negocio Ogilvy Colombia está en revisión desde el 2026-10-21. Cuando se apruebe, se pide la verificación como Tech Provider desde el panel de la app.
- **Textos legales** (`/privacidad`, `/terminos`, `/eliminacion-de-datos`): son un borrador y falta que los revise legal de Ogilvy antes de App Review.

## Metodología de 11 pasos

Este proyecto sigue la secuencia obligatoria de Imderf. La tabla con el estado de cada paso está en el plan, en la sección "Metodología de 11 pasos". Lo que toca al repo:

- **Paso 2 · Gestión de contexto:** este archivo.
- **Paso 7 · Revisión final:** los criterios están en "Pruebas y salida en vivo" del plan.
- **Paso 10 · Seguridad:** revisión antes de conectar la cuenta real de Cafam.
