# Personal Finance Backend

API de finanzas personales construida con **NestJS**, **GraphQL (Apollo)**, **TypeORM** y **PostgreSQL**.
Este repositorio es solo el backend; no contiene frontend.

## Funcionalidades

| Estado | Funcionalidad |
| --- | --- |
| ✅ | Autenticación con JWT (access + refresh token) |
| ✅ | Control de gastos e ingresos categorizados |
| ✅ | Categorías jerárquicas (categoría → subcategoría) con catálogo del sistema |
| ✅ | Inflación personal mensual y anual sobre los gastos |
| ✅ | Inventario de productos: compras, ciclos de consumo y lista de compras automática |
| ⏳ | OAuth con Google |
| ⏳ | Análisis de facturas por imagen |
| ⏳ | Integración con correo electrónico para detectar facturas |
| ⏳ | Registro de inversiones |

La documentación completa de queries y mutations está en **[docs/API.md](docs/API.md)**.

## Requisitos

- **Node.js** 20 o superior (probado con 22.x)
- **npm** 10 o superior
- **Docker** y **Docker Compose** (para PostgreSQL y pgAdmin en desarrollo)

## Puesta en marcha

### 1. Clonar e instalar dependencias

```bash
git clone <url-del-repositorio>
cd personal_finance_backend
npm install
```

### 2. Configurar variables de entorno

```bash
cp .env.example .env
```

Edita el `.env` según tu entorno:

| Variable | Descripción | Valor por defecto |
| --- | --- | --- |
| `NODE_ENV` | Entorno de ejecución | `development` |
| `PORT` | Puerto del servidor HTTP | `3000` |
| `DB_HOST` | Host de PostgreSQL | `localhost` |
| `DB_PORT` | Puerto de PostgreSQL | `5432` |
| `DB_USERNAME` | Usuario de PostgreSQL | `postgres` |
| `DB_PASSWORD` | Contraseña de PostgreSQL | `postgres` |
| `DB_NAME` | Nombre de la base de datos | `personal_finance` |
| `JWT_SECRET` | Secreto para firmar los access tokens | — (**cámbialo**) |
| `JWT_ACCESS_EXPIRATION` | Duración del access token | `20m` |
| `REFRESH_TOKEN_TTL_DAYS` | Duración del refresh token en días | `180` (6 meses) |
| `PGADMIN_EMAIL` | Usuario de pgAdmin | `admin@admin.com` |
| `PGADMIN_PASSWORD` | Contraseña de pgAdmin | `admin` |
| `PGADMIN_PORT` | Puerto de pgAdmin | `5050` |

> Si ya tienes un PostgreSQL corriendo en el puerto 5432, cambia `DB_PORT` (por ejemplo a `5433`) para que el contenedor no choque con él.

### 3. Levantar la base de datos

```bash
docker compose -f docker-compose.dev.yml up -d
```

Esto levanta dos servicios:

- **PostgreSQL** en `localhost:${DB_PORT}`, con volumen persistente.
- **pgAdmin** en <http://localhost:5050>. Al registrar el servidor dentro de pgAdmin usa como host `postgres` (el nombre del servicio en la red de Docker), no `localhost`.

### 4. Aplicar las migraciones

```bash
npm run migration:run
```

Crea todas las tablas y carga las **categorías por defecto del sistema** (alimentación, transporte, vivienda, salario, etc.).

### 5. Arrancar el servidor

```bash
npm run start:dev
```

La API queda disponible en <http://localhost:3000/graphql>, con el playground de Apollo habilitado fuera de producción.

## Comandos

| Comando | Descripción |
| --- | --- |
| `npm run start:dev` | Servidor en modo desarrollo (watch) |
| `npm run start` | Servidor sin watch |
| `npm run start:prod` | Servidor desde el build compilado |
| `npm run build` | Compila el proyecto a `dist/` |
| `npm run lint` | Linter (ESLint) con autofix |
| `npm run format` | Formatea el código con Prettier |
| `npm run test` | Tests unitarios |
| `npm run test:e2e` | Tests end-to-end |
| `npm run test:cov` | Cobertura de tests |
| `npm run migration:generate -- src/migrations/<Nombre>` | Genera una migración comparando entidades vs. base de datos |
| `npm run migration:run` | Aplica las migraciones pendientes |
| `npm run migration:revert` | Revierte la última migración |
| `npm run migration:show` | Lista las migraciones y su estado |

## Base de datos

El esquema se maneja **únicamente con migraciones** (`synchronize` está desactivado). Tras modificar una entidad:

```bash
npm run migration:generate -- src/migrations/MiCambio
npm run migration:run
```

Las migraciones viven en `src/migrations/` y el DataSource del CLI en `src/config/data-source.ts`.

### Modelo de datos

- **users / authentications / refresh_tokens** — usuario, sus credenciales (local u OAuth) y sus sesiones activas.
- **categories** — jerárquicas; `user_id NULL` marca las categorías globales del sistema.
- **expenses / incomes** — movimientos, con moneda, tasa de cambio y recurrencia. La vista `transactions` los unifica para reportes.
- **payment_methods / installment_plans / installments** — medios de pago y compras a cuotas.
- **products / product_purchases / consumption_cycles** — catálogo de productos, compras y ciclos "lo empecé a usar → se acabó". La vista `product_stats` calcula duración promedio y fecha estimada de agotamiento.
- **shopping_lists / shopping_list_items** — lista de compras, con ítems que se agregan solos cuando un producto se agota.
- **tags / expense_tags / income_tags** — etiquetas libres sobre movimientos.

## Arquitectura

```
src/
├── auth/              # registro, login, refresh, logout, guard y decorator
├── users/             # entidad de usuario
├── categories/        # categorías y subcategorías
├── transactions/      # gastos, ingresos e inflación
├── products/          # catálogo, compras y ciclos de consumo
├── shopping-lists/    # listas de compras
├── payment-methods/   # medios de pago
├── installments/      # compras a cuotas
├── tags/              # etiquetas
├── common/            # enums y transformers compartidos
├── config/            # configuración de base de datos y DataSource del CLI
└── migrations/        # migraciones de TypeORM
```

El esquema GraphQL se genera con el enfoque *code-first*: se construye a partir de los decoradores y se escribe en `src/schema.gql` (archivo generado, ignorado por git).

## Autenticación

Se usa el esquema **access token + refresh token**:

- **Access token**: JWT firmado, válido **20 minutos**. Se envía en cada petición como `Authorization: Bearer <token>`.
- **Refresh token**: token opaco, válido **6 meses**. Se guarda hasheado (SHA-256) en la base de datos y **rota** en cada uso: al refrescar, el token anterior queda revocado.

Ver el flujo completo en [docs/API.md](docs/API.md#autenticación).

## Convención de commits

Se sigue *Conventional Commits*: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

```
feat(products): add product queries, mutations and stats
```
