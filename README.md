# Ogilvy Social Care

Plataforma multicliente de Ogilvy Colombia para atender los comentarios y mensajes directos (DM) que llegan a las páginas de Facebook y a las cuentas de Instagram de una marca. Una IA clasifica cada mensaje con la matriz de respuesta del cliente y propone la respuesta; el código decide si sale, si la revisa una persona o si pasa a una bandeja humana. La plataforma aprende por etapas, por tipo de caso.

## Qué hace

- **Recibe** en tiempo real los comentarios y DM de Facebook e Instagram (webhooks de Meta) y, al conectar una cuenta, puede traer los últimos 30 días.
- **Clasifica y propone** con la matriz del cliente: tipo de caso, confianza, sentimiento, plantilla pública y de DM, y señales de riesgo (salud crítica, insulto grave, datos expuestos, competencia, crisis y mención de medios o figuras públicas).
- **Actúa** según reglas fijas del código: responde en público, oculta, escribe por DM o escala. La IA nunca ejecuta acciones por su cuenta.
- **Aprende por etapas:** modo prueba (no publica nada) → asistido (una persona acepta, corrige o descarta) → automático por tipo de caso, cuando ese tipo llega a 90 % de acierto con al menos 20 revisiones.
- **Solo responde lo orgánico:** los comentarios en anuncios o en publicaciones pautadas quedan para análisis y llegan como alerta a la bandeja.
- **Hoja de casos:** se conecta con Google y lee la Hoja de cálculo donde el equipo registra los casos; cuando un caso cambia a un estado que avisa, le escribe a la persona por DM según la ventana de Meta.
- **Panel web** con resumen e indicadores, bandeja, pruebas, interacciones y ficha por persona, editor de la matriz, plantillas con versiones, base de conocimiento, palabras prohibidas, perfiles e influenciadores, cuentas conectadas y clientes.
- **Reseñas de Google:** un botón «Conectar con Google» detecta solas las fichas de la persona; la plataforma lee las reseñas de las sedes que se elijan, las clasifica con su propia matriz y propone la respuesta. Por ahora solo en modo prueba: no responde en Google.
- **Usuarios y roles:** la administración crea usuarios con contraseña temporal, restablece contraseñas, desactiva cuentas y asigna clientes. Tres roles: administrador, operador (Bandeja) y verificador (Pruebas).

## Cómo funciona

```mermaid
flowchart TD
  A["Comentario o DM en Facebook / Instagram"] --> B["Webhook de Meta: se valida la firma, se guarda y se encola"]
  B --> C["El worker crea la interacción: texto enmascarado, persona y publicación"]
  C --> D["La IA clasifica con la matriz del cliente y propone la respuesta"]
  D --> E{"Reglas del código: autonomía, umbral, respuesta cubierta y sin señales de riesgo"}
  E -->|"El tipo ya responde solo"| F["Publica: responde, oculta o escribe por DM"]
  E -->|"El tipo sigue aprendiendo"| P["Pruebas: una persona acepta, corrige o descarta"]
  P -->|"Aceptar"| F
  E -->|"No pasa"| H["Bandeja: una persona responde con el borrador de la IA"]
  F --> J["Resumen, interacciones y aprendizaje"]
  H --> J
```

## Stack

| Pieza | Tecnología |
|---|---|
| Panel y webhooks | Next.js 16 (App Router, Cache Components), React 19, TypeScript y Tailwind 4, en `src/` |
| Worker | Proceso Node 24 aparte, en `worker/`, que corre TypeScript directo (sin compilar) |
| Base de datos | MySQL 8 o MariaDB 11.4, con el driver `mysql2` y migraciones SQL en `db/migrations/` |
| Cola de trabajos | Tabla `jobs` tomada con `FOR UPDATE SKIP LOCKED` (`src/lib/queue.ts`) |
| IA | OpenAI Responses API con esquema JSON estricto y `store: false` |
| Integraciones | Meta Graph API (Facebook Login for Business, webhooks, Messenger e Instagram) y Google (OAuth, Picker y Sheets) |

## Requisitos

- Node.js 24 o superior.
- MySQL 8 o MariaDB 11.4.
- Una app de Meta con Facebook Login for Business y los permisos de páginas, Instagram y mensajería.
- Una llave de API de OpenAI.
- Para la Hoja de casos: un proyecto de Google Cloud con un cliente OAuth web, una clave de API para el selector y las APIs de Sheets, Drive y Picker activas.

## Puesta en marcha en local

```bash
npm ci
cp .env.example .env        # y llenar los valores
npm run db:migrate          # crea las tablas
npm run usuario -- admin "Administrador"   # crea un usuario del panel; la contraseña se pide aparte
npm run dev -- -H 127.0.0.1 -p 3030        # panel en http://localhost:3030
npm run worker              # en otra terminal: procesa eventos, clasificación y publicaciones
```

Para ver el panel con datos de ejemplo, `npm run db:seed:demo` crea un cliente demo en modo prueba con unas 900 interacciones de 30 días.

## Variables de entorno

Están todas en `.env.example`. El `.env` nunca se sube al repositorio.

| Variable | Para qué |
|---|---|
| `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_GRAPH_VERSION`, `META_LOGIN_CONFIG_ID` | App de Meta, firma de los webhooks y configuración de inicio de sesión |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT` | Clasificación y propuesta de respuestas |
| `DATABASE_URL` | Conexión a la base (`mysql://usuario:clave@127.0.0.1:3306/base`; la clave va codificada si tiene símbolos) |
| `TEST_DATABASE_URL` | Base para las pruebas; su nombre tiene que terminar en `_test`, porque se borra en cada corrida |
| `TOKEN_ENCRYPTION_KEY` | Cifrado de los tokens de Meta y Google (32 bytes en base64) |
| `SESSION_SECRET` | Firma de las sesiones del panel |
| `APP_BASE_URL`, `PANEL_URL` | Dominio público y dirección del panel |
| `PANEL_PUBLICO` | `1` para servir el panel en el dominio público, detrás de su login. Sin ella, el dominio solo muestra las páginas legales, el webhook y la conexión con Meta |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_API_KEY`, `GOOGLE_PROJECT_NUMBER` | Hoja de casos: inicio de sesión con Google y selector de la Hoja |
| `GBP_CLIENT_ID`, `GBP_CLIENT_SECRET` | Google Business Profile (reseñas): cliente OAuth del proyecto de Google Cloud con acceso a la API; URL de regreso `PANEL_URL/api/gbp/callback` |

## Comandos

```bash
npm run dev            # panel en modo desarrollo
npm run build          # compilación de producción
npm run start          # panel compilado
npm run worker         # worker
npm run db:migrate     # aplica las migraciones pendientes
npm run db:seed:demo   # cliente demo con datos de ejemplo
npm run db:seed:cafam  # matriz, plantillas y enlaces del primer cliente
npm run db:seed:resenas -- <cliente>   # matriz y plantillas v1 de reseñas de Google
npm run usuario -- <usuario> [nombre]   # crea un administrador o cambia la contraseña de un usuario (el primero; los demás se crean en /panel/usuarios)
npm test               # pruebas (necesitan la base de TEST_DATABASE_URL)
npm run typecheck
```

## Pruebas

Son 104 pruebas con el ejecutor de Node (`node --test`), sin frameworks. Cubren la firma de Meta, eventos y cola, el motor de decisión, el enmascarado, la matriz y las plantillas, la bandeja, el aprendizaje, las palabras prohibidas, los perfiles, la Hoja de casos y el aislamiento entre clientes. Pasan en MySQL 8 y en MariaDB 11.4. Cada corrida borra y recrea la base de `TEST_DATABASE_URL`.

## Despliegue

En producción corre en un servidor Linux detrás de Cloudflare:

1. Compilar con `npm run build` (se puede compilar en otra máquina y copiar `.next/`).
2. Copiar el código sin `node_modules` ni `.env`, e instalar con `npm ci --omit=dev`.
3. Aplicar migraciones con `node --env-file=.env db/migrate.ts`.
4. Dejar dos procesos permanentes (por ejemplo con Supervisor): el panel con `next start -H 127.0.0.1 -p <puerto>` y **un solo** worker con `node --env-file=.env worker/index.ts`.
5. Poner un proxy inverso hacia el puerto del panel. Si es Apache con `.htaccess`, agregar `DirectoryIndex disabled` para que la raíz llegue a la app.

El panel escucha solo en `127.0.0.1`. Nunca se usa `next dev` en producción.

## Seguridad y privacidad

- A la IA solo llega texto enmascarado (documentos, celulares, correos y direcciones), con `store: false`. La base no guarda cédulas, fórmulas ni diagnósticos.
- La IA solo devuelve JSON con el esquema del cliente; el código decide y actúa. El contenido de los comentarios y DM se trata como no confiable.
- Borrar comentarios es siempre una acción humana; lo automático solo puede ocultar, porque es reversible.
- Toda tabla de negocio lleva `client_id` y toda consulta filtra por cliente.
- Los webhooks validan la firma `X-Hub-Signature-256`, limitan el cuerpo a 512 KB y vacían el evento crudo al procesarlo.
- Los tokens van cifrados con AES-256-GCM. El ingreso al panel tiene bloqueo por intentos y las sesiones se invalidan al cambiar la contraseña. Los roles limitan cada pantalla y acción, y cada persona ve solo sus clientes.

## Estructura

```
src/app/            panel (/panel), ingreso, páginas legales y rutas de API (webhook de Meta, conexión con Meta y Google)
src/lib/            lógica: clasificación, decisión, publicación, cola, Meta, Google, Hoja de casos, datos del panel
worker/             proceso que atiende la cola de trabajos
db/migrations/      migraciones SQL en orden
db/                 migrador y cargas de datos (demo y primer cliente)
scripts/            usuarios del panel y evaluación del clasificador
tests/              pruebas
```

## Responsable

Imderf Ríos, Digital Technology, Ogilvy Colombia.
