# Plan de Frontend

Plan de implementación del frontend contra la API GraphQL actual. Cubre los cambios recientes (cuentas, gastos multi-artículo, gastos recurrentes) y los anteriores (auth, artículos, inflación real, inventario fusionado en `Article`).

> **Referencia de la API**: [docs/API.md](API.md). Endpoint único: `POST /graphql`. Playground en `http://localhost:3000/graphql` fuera de producción.

## 1. Stack sugerido

- **React + TypeScript + Vite** (el CORS del backend ya permite `http://localhost:5174` y `5173`).
- **Cliente GraphQL**: Apollo Client o urql. Recomendado Apollo por su caché normalizada (clave para refrescar `products`/`accounts` tras mutaciones).
- **GraphQL Code Generator** (`@graphql-codegen`) apuntando a `http://localhost:3000/graphql` para tipos y hooks tipados. Regenerar cuando cambie el backend.
- **Formularios**: React Hook Form + Zod (validaciones que espejan las del backend).
- **Estado de sesión**: tokens en memoria + refresh token en `localStorage` (o cookie httpOnly si más adelante se mueve al backend).

## 2. Autenticación (base de todo)

La API usa **access token (20 min) + refresh token (6 meses)**. El access token va en `Authorization: Bearer <token>`.

- **Mutations**: `register`, `login` → `{ accessToken, refreshToken, user }`; `refreshTokens(refreshToken)` (rota: el token viejo se invalida); `logout(refreshToken)`.
- **Query**: `me { id email firstName lastName avatar baseCurrency timezone authentication { provider emailVerified } }`.
- **Apollo link**: un `authLink` que inyecta el Bearer; un `errorLink` que, ante `UNAUTHENTICATED`, llama `refreshTokens` una vez y reintenta; si falla, redirige a login.
- **Guardas de ruta**: rutas privadas requieren sesión; `me` como verificación inicial.

> ⚠️ **Importante**: los endpoints de **gastos, ingresos y categorías todavía reciben `userId` como argumento** (no van por el token). El frontend debe pasar `me.id` como `userId` en `expenses`, `incomes`, `categories`, `createExpense`, `createIncome`, `createCategory`, etc. Los demás dominios (cuentas, artículos, productos, inflación de artículos, recurrentes) **sí** usan el token (no reciben `userId`). Esta asimetría es temporal; cuando el backend migre todo al guard, se quita el `userId`.

## 3. Módulos / pantallas

### 3.1 Cuentas + saldos (nuevo)
Entidad `Account` (banco, efectivo, tarjeta, billetera). CRUD guardado por token. **Cada cuenta lleva un `balance` que el backend mantiene solo** (ingresos suman, gastos restan, transferencias mueven).
- **Listado**: `accounts(includeInactive)` → tarjetas con `name`, `type`, `currency`, `openingBalance`, **`balance`**, **`availableCredit`**, `isActive`. Mostrar el saldo destacado; en crédito, mostrar deuda (`balance` negativo) y cupo disponible (`availableCredit`).
- **Crear/editar**: `createAccount`/`updateAccount`. Form con `type` (`PaymentMethodType`: CASH, DEBIT, CREDIT, BANK_TRANSFER, DIGITAL_WALLET, OTHER). Mostrar los campos de crédito (`creditLimit` = **cupo**, `statementDay`, `dueDay`, `monthlyRate`) **solo** cuando `type = CREDIT`. `balance` arranca en `openingBalance`.
- **Borrar**: `removeAccount`. Manejar el `BAD_REQUEST` (planes de cuotas o transferencias asociadas).
- **Transferencias** (`transferBetweenAccounts`): pantalla/modal "Transferir" con cuenta origen, destino, monto y nota. **Transferir a una tarjeta de crédito = pagar la tarjeta** (etiquetarlo así en la UI cuando el destino es `CREDIT`). Manejar `BAD_REQUEST` de fondos insuficientes. Listar con `accountTransfers(accountId?)`. Opcional: botón "Recalcular saldo" → `recalculateAccountBalance`.
- **Cupo en gastos**: al elegir una tarjeta de crédito en el formulario de gasto, mostrar el `availableCredit` y avisar/validar en cliente antes de enviar; el backend igual rechaza con `BAD_REQUEST` si el gasto excede el cupo.
- **Selector de cuenta reutilizable**: componente `<AccountSelect>` (muestra nombre + saldo) para usar en los formularios de gasto/ingreso/recurrente.

> **Invalidación**: como el `balance` se recalcula en el backend con cada gasto/ingreso/transferencia, invalidar `accounts`/`account` tras crear/editar/borrar cualquiera de esos movimientos.

### 3.2 Categorías
- `categories(userId, kind)` devuelve las del sistema (`userId: null`) + las del usuario. `kind` filtra `EXPENSE`/`INCOME`.
- Jerárquicas: `parentId` define subcategorías; construir árbol en el cliente.
- CRUD: `createCategory`/`updateCategory`/`removeCategory` (las del sistema no se pueden editar/borrar → `BAD_REQUEST`).
- **Selector jerárquico** reutilizable (categoría → subcategoría).

### 3.3 Artículos
Catálogo general (producto / servicio / otro). CRUD por token.
- `articles(search, type, includeInactive)`, `article(id)`.
- `createArticle`/`updateArticle`/`removeArticle`. Form: `name`, `type` (`ArticleType`: PRODUCT/SERVICE/OTHER), `unit` (`UnitOfMeasure`), `brand`, `categoryId`, y campos de inventario cuando es producto (`packageSize`, `barcode`, `isConsumable`).
- **Autocomplete `<ArticleSelect>`** (busca con `articles(search:)`, con opción "crear nuevo") — es el componente central del formulario de gasto.

### 3.4 Gastos (cambio grande: multi-artículo + cuenta)
El gasto pasó de "un artículo + cantidad" a **una lista de ítems**.

**Formulario de gasto** (`createExpense`):
- Campos de cabecera: `description`, `occurredOn` (fecha), `accountId` (`<AccountSelect>`), `recurrence` (etiqueta), `merchant`, `notes`, `currency`/`exchangeRate` (avanzado).
- **Sección de ítems** (opcional, repetible): cada fila = `<ArticleSelect>` (o `newArticle` inline con su `type`) + `unitPrice` + `quantity`. El subtotal por fila = `unitPrice * quantity`.
- **Importe (`amount`)**:
  - Sin ítems → input manual de `amount` (obligatorio).
  - Con ítems → `amount` se **calcula** como la suma de subtotales (mostrar como campo de solo lectura). No enviar `amount` cuando hay ítems.
- **Categoría**:
  - Con **un solo** ítem → si el usuario no elige categoría, se hereda del artículo (mostrarlo como "heredada de \<artículo\>").
  - Con **varios** ítems → mostrar el `<CategorySelect>` para elegirla explícitamente.
- Validación cliente: exigir `amount` **o** al menos un ítem; cada ítem exige artículo (`articleId` o `newArticle`) y `unitPrice`.
- **Efecto inventario**: si un ítem es artículo `type: PRODUCT`, tras guardar hay que **invalidar la caché** de `products`, `productStats`, `consumptionCycles` y la lista de compras (el backend abre/reabre ciclos automáticamente).

**Listado de gastos** (`expenses(userId, filter)`): filtros `from`/`to`, `categoryId`, `accountId`. Mostrar por gasto: `description`, `amount`, `occurredOn`, `account { name }`, `category { name }`, y expandible los `items { article { name } unitPrice quantity subtotal }`.

**Editar** (`updateExpense`): enviar `items` **reemplaza** todos los ítems y recalcula el importe. `removeExpense` para borrar.

**Migración de UI**: eliminar del formulario viejo los campos `articleId`/`quantity`/`unitPrice` a nivel de gasto y `paymentMethodId` → renombrar a `accountId`. El objeto `Expense` ya no expone `article`/`quantity`/`unitPrice` (ahora en `items[]`).

### 3.5 Ingresos
Igual que gastos pero **sin ítems**: `description`, `source`, `amount`, `occurredOn`, `categoryId`, `accountId` (cuenta **destino**), `recurrence`. CRUD `createIncome`/`updateIncome`/`removeIncome`, listado `incomes(userId, filter)`.

### 3.6 Gastos recurrentes (nuevo)
Plantillas que generan gastos automáticamente.
- **Listado**: `recurringExpenses(includeInactive)` → `description`, `recurrence`, `nextRunOn`, `endOn`, `isActive`, `account`, `items`.
- **Crear/editar**: `createRecurringExpense`/`updateRecurringExpense`. Reusa el mismo formulario de gasto (amount o items + accountId + categoryId) **más**: `recurrence` (obligatorio, **no** `ONCE`), `startOn`, `endOn` (opcional). `nextRunOn` lo maneja el backend.
- **Borrar / desactivar**: `removeRecurringExpense`, o `updateRecurringExpense(isActive: false)`.
- **Generación manual**: botón "Generar vencidos" → `runDueRecurringExpenses` (devuelve cuántos se crearon). Útil para forzar; normalmente lo hace un job diario del backend. Tras ejecutarlo, invalidar la caché de `expenses`.

### 3.7 Inventario / Productos
Un "producto" es un artículo `type: PRODUCT` (el tipo GraphQL devuelto es `Article`; **ya no existe `Product`**).
- **Listado**: `products(search, includeInactive)` → `name`, `inStock` (¿hay?), `isConsumable`, `barcode`, `packageSize`, `category`. Badge de stock según `inStock`.
- **Editar**: `updateProduct` (edita el artículo). **No hay `createProduct`** — los productos nacen al registrar un gasto con un ítem tipo producto.
- **Acciones**: `markProductDepleted(articleId)` ("se acabó" → entra a la lista de compras); `registerProductPurchase` (compra manual). Ambos usan `articleId`.
- **Historial/predicción**: `productPurchases(articleId)`, `consumptionCycles(articleId)`, `productStats { articleId name closedCycles avgDaysLasted estimatedDepletionDate ... }`. Panel de "cuándo se acaba" con `estimatedDepletionDate`.

### 3.8 Inflación (dos métricas, no confundir)
Pantalla de análisis con **dos pestañas claramente separadas**:
- **Inflación real** (`articleInflation`): índice de precios (Laspeyres). Mostrar el índice agregado (`points { period monthlyRate annualRate }`), y desgloses `articles` y `categories`. Filtros `from`/`to` (YYYY-MM), `categoryId`, `articleId`, `type`.
- **Variación de gasto** (`expenseInflation(userId, filter)`): cuánto cambió el gasto total. Etiquetarla explícitamente como distinta de la inflación real (con los mismos datos, esta da cientos de % donde la real da ~10%).

## 4. Componentes reutilizables

| Componente | Alimentado por | Usado en |
| --- | --- | --- |
| `<AccountSelect>` | `accounts` | Gasto, Ingreso, Recurrente |
| `<CategorySelect>` (jerárquico) | `categories(userId, kind)` | Gasto, Ingreso, Categorías, filtros |
| `<ArticleSelect>` (autocomplete + crear) | `articles(search)` | Ítems de gasto/recurrente |
| `<ExpenseItemsEditor>` | — (maneja el array de ítems, subtotales y total) | Gasto, Recurrente |
| `<MoneyInput>` / `<DateInput>` | — | Todos los formularios |

## 5. Caché e invalidación (Apollo)

- Tras `createExpense`/`updateExpense`/`removeExpense`: refetch/invalidar `expenses`, y `articleInflation`/`expenseInflation` si hay pantallas abiertas.
- Si el gasto tocó un artículo **producto**: invalidar `products`, `productStats`, `consumptionCycles`, `productPurchases` y la lista de compras (el inventario cambió sin pasar por sus mutaciones).
- Tras `createAccount`/`updateAccount`/`removeAccount`: invalidar `accounts` (y `me` si muestra saldos).
- Tras `runDueRecurringExpenses`: invalidar `expenses` y `recurringExpenses`.

## 6. Manejo de errores

Mapear `extensions.code` a UI (ver [docs/API.md](API.md#manejo-de-errores)):
- `UNAUTHENTICATED` → refresh/login.
- `BAD_REQUEST` → mostrar `message` bajo el campo (ej. "cuenta con planes de cuotas", "recurrence no puede ser ONCE", "gasto requiere amount o ítems", "articleId y newArticle a la vez").
- `NOT_FOUND` / `CONFLICT` (email duplicado en registro) → toast con el mensaje.

## 7. Orden de implementación sugerido

1. **Infra**: Vite + Apollo + codegen + auth (login/register/refresh/guardas). 
2. **Cuentas** y **Categorías** (CRUD simples, alimentan los selectores).
3. **Artículos** + `<ArticleSelect>`.
4. **Gastos** (el formulario multi-ítem es el más complejo) e **Ingresos**.
5. **Inventario/Productos** (listado, stock, "se acabó", stats).
6. **Gastos recurrentes**.
7. **Inflación** (dos pestañas) y dashboard.

## 8. Notas de contrato para tener presentes

- Fechas de movimientos: string `YYYY-MM-DD`. Periodos de inflación: `YYYY-MM`.
- Montos: `Float` en la moneda de `currency`; `exchangeRate` convierte a la moneda base del usuario.
- `paymentMethodId` viejo → ahora **`accountId`** en toda la API (gastos, ingresos, recurrentes, filtros) y `account { ... }` en las respuestas.
- El objeto `Expense` perdió `article`/`articleId`/`quantity`/`unitPrice`; esos datos viven en `items[]` (`unitPrice`, `quantity`, `subtotal`, `article`).
- `Product` como tipo GraphQL **no existe**; `products`/`product`/`updateProduct` devuelven `Article`; los args de inventario son `articleId` (no `productId`).
