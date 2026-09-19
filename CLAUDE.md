# Personal Finance Backend

Backend de finanzas personales. Este repositorio es **solo el backend** (API); no contiene frontend.

## Tecnologías

- **Framework**: NestJS (Node.js + TypeScript)
- **Base de datos**: PostgreSQL
- **ORM**: TypeORM (`@nestjs/typeorm`)
- **API**: GraphQL con Apollo (`@nestjs/graphql`, *code-first*): el esquema se genera desde los decoradores en `src/schema.gql` (archivo generado, ignorado por git). Endpoint en `/graphql`, playground habilitado fuera de producción.
- **Autenticación**: JWT + OAuth con Google
- **Testing**: Jest (unitarios y e2e)
- **Gestor de paquetes**: npm

## Funcionalidades del proyecto

1. **Control de gastos**: gastos categorizados. Un gasto puede tener **varios ítems** (`expense_items`), cada uno un artículo con precio y cantidad; el importe = suma de los ítems (con un ítem la categoría se hereda del artículo). Sin ítems, se registra solo el importe. Cada gasto/ingreso sale de/entra a una **cuenta** (`accountId`). También hay **gastos recurrentes** (plantilla `RecurringExpense` + job diario `@nestjs/schedule` que materializa los vencidos).
2. **Inflación**: dos métricas distintas — `expenseInflation` (variación del gasto total, mensual/anual) e `articleInflation` (**inflación real**: índice de precios de Laspeyres sobre el precio unitario de los ítems de gasto, aislando el cambio de precio del de cantidad; con desglose por artículo y por categoría).
3. **Inventario de productos**: un "producto" es un **artículo `type = PRODUCT`** (no hay entidad `Product` separada; se fusionó en `Article`). Al registrar un gasto con un ítem tipo producto, entra al inventario: se registra la compra y se reabre el ciclo de consumo ("hay"). El query `products` devuelve los artículos tipo producto; la creación ocurre solo vía gasto.
7. **Cuentas**: efectivo, banco, tarjeta, etc. (`payment_methods`, expuesto en GraphQL como `Account` con CRUD). Cada cuenta lleva un **saldo** (`balance`) que se mantiene solo: los ingresos suman, los gastos restan y hay **transferencias** entre cuentas (`account_transfers`; transferir a una de crédito paga la tarjeta). En crédito, `balance` negativo = deuda y `availableCredit = creditLimit + balance`; no se permite un gasto que exceda el cupo.
4. **Análisis de facturas por imagen**: extraer los datos de una factura a partir de una imagen.
5. **Integración con correo electrónico**: conectar con el correo del usuario para analizar los correos y detectar automáticamente cuándo llega una factura.
6. **Registro de inversiones**: cartera multi-bróker. Un **libro de operaciones** (`investment_transactions`) con 13 tipos (BUY, SELL, DIVIDEND, INTEREST, DEPOSIT, WITHDRAWAL, FEE, TAX, SPLIT, TRANSFER_IN, TRANSFER_OUT, CURRENCY_EXCHANGE); todo lo demás (lotes, posiciones, efectivo, P&L) es **derivado** y se reconstruye desde ahí. La base de costo es **FIFO con lotes fiscales**, no configurable. Los instrumentos y sus precios viven en `src/market-data/` y son **globales** (sin `user_id`). El efecto de cada operación está implementado en un único sitio: `src/investments/analytics/portfolio-ledger.ts`, que es puro y está cubierto por tests. Precios y tasas de cambio se traen de **Twelve Data** con presupuesto duro (plan Basic: 8 créditos/min, 800/día); el limitador es híbrido (cadena de promesas en proceso + contador durable en `market_data_usage`). Una `time_series` cuesta 1 crédito y trae hasta 5000 barras, así que el histórico se pide por rangos anchos. La serie diaria vive en `portfolio_snapshots` y **persiste el factor TWR** porque encadenar no se puede rederivar desde el estado final. La importación de statements va por **REST con multer** (`/investments/import`), no por GraphQL, con flujo subir → revisar → confirmar igual que el análisis de facturas: analizar no persiste nada. La detección de columnas tiene tres capas (perfil por bróker → heurística → re-mapeo del usuario sobre el archivo archivado). Todo es idempotente gracias a `dedupe_hash` + índice único. El PDF entra por el mismo endpoint: se extrae la capa de texto y se manda a GPT-4o con structured outputs (patrón de `InvoicesService`); un PDF escaneado se rechaza en vez de intentar OCR. El `dedupe_hash` se calcula sobre la clave NATURAL y **no** incluye el id externo, para que la misma operación llegando por dos vías se detecte como duplicada. Fase actual: núcleo + precios + TWR/XIRR + benchmarks + importación CSV/XLSX/PDF; pendientes los conectores de bróker.

## Autenticación

- Login y registro mediante **JWT** y **OAuth con Google**.
- Se usa el esquema de **access token + refresh token**:
  - **Access token**: duración de **20 minutos**.
  - **Refresh token**: duración de **6 meses**.

## Convención de commits

- Los commits siguen la convención de *Conventional Commits*: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, etc.
- Los commits se hacen **a nombre del dueño del repositorio** (`LuiferEduardoo <luifer01ortegaperez@gmail.com>`), sin trailers de co-autoría.

## Comandos

- `npm run start:dev` — levantar el servidor en modo desarrollo (watch).
- `npm run build` — compilar el proyecto.
- `npm run test` — tests unitarios.
- `npm run test:e2e` — tests end-to-end.
- `npm run lint` — linter.
- `npm run migration:generate -- src/migrations/<Nombre>` — generar una migración comparando entidades vs. base de datos.
- `npm run migration:run` — aplicar migraciones pendientes.
- `npm run migration:revert` — revertir la última migración.

## Base de datos

- El esquema se maneja **solo con migraciones** (`synchronize` está desactivado). Tras cambiar una entidad, generar y correr la migración.
- Las migraciones viven en `src/migrations/` y el DataSource del CLI en `src/config/data-source.ts`.

## Notas

- Las variables sensibles (credenciales de PostgreSQL, secretos JWT, credenciales OAuth de Google, credenciales de correo) van en archivos `.env`, que están ignorados por git.
