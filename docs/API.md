# API — Personal Finance Backend

Toda la API se expone en un único endpoint GraphQL:

```
POST http://localhost:3000/graphql
```

En desarrollo está disponible el playground de Apollo abriendo esa misma URL en el navegador.

## Índice

- [Autenticación](#autenticación)
- [Perfil](#perfil)
- [Categorías](#categorías)
- [Gastos](#gastos)
- [Ingresos](#ingresos)
- [Artículos](#artículos)
- [Inflación](#inflación)
- [Productos](#productos)
- [Compras y ciclos de consumo](#compras-y-ciclos-de-consumo)
- [Utilidades](#utilidades)
- [Tipos y enums](#tipos-y-enums)
- [Manejo de errores](#manejo-de-errores)

## Convenciones

- Las fechas de movimientos (`occurredOn`, `purchasedOn`, `depletedOn`) son strings `YYYY-MM-DD`.
- Los periodos de inflación son strings `YYYY-MM`.
- Los campos `createdAt` / `updatedAt` son `DateTime` (ISO 8601).
- Los importes son `Float` en la moneda indicada en `currency`; `exchangeRate` los convierte a la moneda base del usuario.

### Autorización

Los endpoints marcados con 🔒 requieren el access token en la cabecera:

```
Authorization: Bearer <accessToken>
```

> **Nota sobre los endpoints sin 🔒**: categorías, gastos e ingresos aún reciben `userId` como argumento porque se implementaron antes que la autenticación. Están pendientes de migrar al token; hasta entonces no validan que el usuario del token coincida con el `userId` enviado.

---

## Autenticación

### `register` — crear cuenta

```graphql
mutation {
  register(input: {
    email: "luifer@example.com"
    password: "unaClaveSegura"
    firstName: "Luifer"
    lastName: "Ortega"
  }) {
    accessToken
    refreshToken
    user { id email firstName }
  }
}
```

Crea el usuario y sus credenciales locales (contraseña hasheada con bcrypt). Falla con `CONFLICT` si el email ya existe.

### `login` — iniciar sesión

```graphql
mutation {
  login(input: { email: "luifer@example.com", password: "unaClaveSegura" }) {
    accessToken
    refreshToken
    user { id email }
  }
}
```

Devuelve `UNAUTHORIZED` con el mensaje genérico *Credenciales inválidas* tanto si el email no existe como si la contraseña es incorrecta.

### `refreshTokens` — renovar el access token

```graphql
mutation {
  refreshTokens(refreshToken: "<refreshToken>") {
    accessToken
    refreshToken
  }
}
```

**El refresh token rota**: el token enviado queda revocado y se devuelve uno nuevo. Reutilizar el anterior falla con `UNAUTHORIZED`.

### `logout` — cerrar sesión

```graphql
mutation {
  logout(refreshToken: "<refreshToken>")
}
```

Revoca el refresh token. Devuelve `Boolean`.

---

## Perfil

### 🔒 `me` — usuario autenticado

```graphql
query {
  me {
    id
    email
    firstName
    lastName
    avatar
    baseCurrency
    timezone
    isActive
    authentication { provider emailVerified }
  }
}
```

La contraseña nunca se expone en el esquema.

---

## Categorías

Las categorías con `userId: null` son **del sistema**: vienen precargadas por migración, las ve cualquier usuario y no se pueden modificar ni eliminar. Cada usuario puede crear las suyas, incluso como subcategorías de las del sistema.

### `categories` — listar

```graphql
query {
  categories(userId: "<userId>", kind: EXPENSE) {
    id name icon color kind parentId userId isActive
  }
}
```

| Argumento | Tipo | Descripción |
| --- | --- | --- |
| `userId` | `ID!` | Usuario dueño de las categorías propias |
| `kind` | `TransactionKind` | Filtra por `EXPENSE` o `INCOME` (opcional) |

Devuelve las del sistema **más** las del usuario, ordenadas por nombre.

### `category` — obtener una

```graphql
query { category(id: "<id>") { id name kind } }
```

### `createCategory` — crear

```graphql
mutation {
  createCategory(input: {
    userId: "<userId>"
    name: "Videojuegos"
    kind: EXPENSE
    parentId: "<idCategoriaPadre>"
    icon: "🎮"
    color: "#7C3AED"
  }) { id name parentId }
}
```

Valida que la categoría padre exista, sea del sistema o del mismo usuario, y del mismo `kind`.

### `updateCategory` — modificar

```graphql
mutation {
  updateCategory(input: { id: "<id>", name: "Gaming", isActive: false }) {
    id name isActive
  }
}
```

### `removeCategory` — eliminar

```graphql
mutation { removeCategory(id: "<id>") }
```

`updateCategory` y `removeCategory` fallan con `BAD_REQUEST` sobre categorías del sistema.

---

## Gastos

### `expenses` — listar con filtros

```graphql
query {
  expenses(
    userId: "<userId>"
    filter: { from: "2026-07-01", to: "2026-07-31", categoryId: "<id>" }
  ) {
    id description amount currency occurredOn merchant recurrence
    category { name icon }
  }
}
```

Filtros disponibles (`TransactionsFilterInput`): `from`, `to`, `categoryId`, `paymentMethodId`. Resultado ordenado por fecha descendente.

### `expense` — obtener uno

```graphql
query { expense(id: "<id>") { id description amount category { name } } }
```

### `createExpense` — registrar gasto

```graphql
mutation {
  createExpense(input: {
    userId: "<userId>"
    description: "Mercado semana"
    amount: 185000
    occurredOn: "2026-07-15"
    categoryId: "<id>"
    paymentMethodId: "<id>"
    merchant: "Éxito"
    notes: "compra mensual"
    receiptUrl: "https://..."
    currency: "COP"
    exchangeRate: 1
    recurrence: ONCE
    quantity: 10
    newArticle: { name: "Pan", type: PRODUCT, categoryId: "<id>" }
  }) {
    id description amount unitPrice quantity category { name } article { id name type }
  }
}
```

Obligatorios: `userId`, `description`, `amount`, `occurredOn`. `amount` debe ser mayor que 0.

**Asociación con un artículo** (opcional): el gasto puede vincularse a un artículo con una `quantity`; de ahí sale el `unitPrice` (`amount / quantity`) que alimenta la inflación real (ver [Inflación](#inflación)). Se usa **uno** de:
- `articleId`: vincular un artículo ya existente del catálogo.
- `newArticle`: crear el artículo (con su `type`: `PRODUCT` / `SERVICE` / `OTHER`) en el mismo gasto.

Enviar ambos da `BAD_REQUEST`. Si el artículo es **tipo producto**, el gasto se integra con el inventario: crea/vincula el `product` (aparece en `products`), registra la compra y **reabre el ciclo de consumo** (`inStock: true`) si estaba agotado — ver [Compras y ciclos de consumo](#compras-y-ciclos-de-consumo).

### `updateExpense` / `removeExpense`

```graphql
mutation { updateExpense(input: { id: "<id>", amount: 192500, notes: "ajustado" }) { amount notes } }
mutation { removeExpense(id: "<id>") }
```

---

## Ingresos

Funcionan igual que los gastos, con el campo adicional `source` (de dónde viene el dinero) y `paymentMethodId` como cuenta destino.

```graphql
query {
  incomes(userId: "<userId>", filter: { from: "2026-01-01" }) {
    id description source amount occurredOn recurrence category { name }
  }
}

mutation {
  createIncome(input: {
    userId: "<userId>"
    description: "Pago nómina julio"
    source: "Empresa XYZ"
    amount: 4500000
    occurredOn: "2026-07-01"
    categoryId: "<id>"
    recurrence: MONTHLY
  }) { id amount source }
}
```

También existen `income(id)`, `updateIncome(input)` y `removeIncome(id)`.

---

## Artículos

Un **artículo** es algo que el usuario compra repetidamente: un producto, un servicio, etc. Es el concepto general del que un `product` (inventario) es la ficha física. Los gastos se asocian a artículos y de ahí se calcula la inflación real. Todos los endpoints son 🔒 y operan sobre los artículos del usuario del token.

### 🔒 `articles` — listar el catálogo

```graphql
query {
  articles(search: "pan", type: PRODUCT, includeInactive: false) {
    id name type unit brand isActive category { name }
  }
}
```

| Argumento | Tipo | Descripción |
| --- | --- | --- |
| `search` | `String` | Búsqueda parcial por nombre |
| `type` | `ArticleType` | `PRODUCT` / `SERVICE` / `OTHER` |
| `includeInactive` | `Boolean` | Incluir inactivos (default `false`) |

### 🔒 `article` — obtener uno

```graphql
query { article(id: "<id>") { id name type } }
```

### 🔒 `createArticle` / `updateArticle` / `removeArticle`

```graphql
mutation {
  createArticle(input: { name: "Netflix", type: SERVICE, notes: "plan familiar" }) {
    id name type
  }
}
mutation { updateArticle(input: { id: "<id>", brand: "Bimbo", isActive: false }) { id brand } }
mutation { removeArticle(id: "<id>") }
```

Los artículos también pueden crearse **desde un gasto** con `newArticle` en `createExpense`.

---

## Inflación

Hay **dos** métricas de inflación, y no deben confundirse:

- **`expenseInflation`** — variación del **gasto total** por mes. Si compro 10 panes un mes y 50 el siguiente, sube mucho aunque el precio no cambie.
- **`articleInflation`** — **inflación real**: índice de precios sobre el **precio unitario** de los artículos. Aísla el cambio de precio del de cantidad (el ejemplo del pan da 10%, no 450%).

### 🔒 `expenseInflation` — inflación personal

Calcula cuánto varía tu gasto mensual, agrupando los gastos por mes y convirtiéndolos a la moneda base (`amount * exchangeRate`).

```graphql
query {
  expenseInflation(filter: { from: "2026-01", to: "2026-07", categoryId: "<id>" }) {
    latestMonthlyRate
    latestAnnualRate
    averageMonthlyRate
    points { period total count monthlyRate annualRate }
  }
}
```

| Campo | Descripción |
| --- | --- |
| `points[].period` | Mes `YYYY-MM` |
| `points[].total` | Total gastado en el mes, en moneda base |
| `points[].count` | Cantidad de gastos del mes |
| `points[].monthlyRate` | Variación % contra el mes anterior |
| `points[].annualRate` | Variación % contra el mismo mes del año anterior |
| `latestMonthlyRate` | Variación mensual del último periodo |
| `latestAnnualRate` | Variación anual del último periodo |
| `averageMonthlyRate` | Promedio de las variaciones mensuales de la serie |

Filtros (`InflationFilterInput`): `from` y `to` en formato `YYYY-MM`, y `categoryId` (incluye sus subcategorías).

**Detalles del cálculo:**

- Los meses **sin gastos no aparecen** en la serie, y las variaciones que no tienen periodo de comparación devuelven `null` en lugar de un porcentaje inventado.
- Al usar `from`, el primer mes de la ventana **sí** calcula sus variaciones mirando meses anteriores al filtro.
- Mide la variación del **gasto total**, que se mueve tanto por precios como por cantidad consumida.

### 🔒 `articleInflation` — inflación real (índice de precios)

Índice de precios de **Laspeyres** sobre los artículos comprados (usa `unitPrice = amount / quantity` de cada gasto asociado a un artículo). Solo cuenta el cambio de precio: cada artículo pondera por su cantidad del periodo base, así que comprar más o menos unidades no altera el índice.

```graphql
query {
  articleInflation(filter: { from: "2026-01", to: "2026-07", categoryId: "<id>", type: PRODUCT }) {
    latestMonthlyRate
    latestAnnualRate
    averageMonthlyRate
    points { period monthlyRate annualRate basketSize }
    articles { articleId name latestMonthlyRate points { period avgUnitPrice quantity monthlyRate } }
    categories { categoryId categoryName latestMonthlyRate points { period monthlyRate } }
  }
}
```

| Campo | Descripción |
| --- | --- |
| `points` | Índice **agregado** sobre todos los artículos (mensual y anual por mes) |
| `points[].basketSize` | Nº de artículos comparables en el mes (canasta) |
| `articles` | Desglose por artículo: precio unitario promedio, cantidad y variación |
| `categories` | Desglose por categoría (índice de Laspeyres por categoría) |
| `latestMonthlyRate` / `latestAnnualRate` | Del último periodo del índice agregado |
| `averageMonthlyRate` | Promedio de las inflaciones mensuales del índice agregado |

Filtros (`ArticleInflationFilterInput`): `from`/`to` (`YYYY-MM`), `articleId` (un solo artículo), `categoryId` (incluye subcategorías) y `type`.

**Detalles del cálculo:**

- **Índice de Laspeyres**: para el mes t, `Σ(precio_t · cantidad_base) / Σ(precio_base · cantidad_base) - 1`, con las cantidades del periodo base (t-1 para mensual, t-12 para anual). Ej.: pan de $2000 a $2200 con cantidades 10→50 → **10%** (no 80% ni 450%).
- **Por categoría**: cada artículo aporta a su categoría y, con roll-up, a la categoría padre (la inflación de "Alimentación" incluye la de "Pan"). Los artículos sin categoría van a un bucket con `categoryId: null`.
- Un artículo solo entra en la comparación de un mes si tiene precio en el mes actual **y** en el periodo base.

---

## Productos

Catálogo de cosas que compras repetidamente. Todos los endpoints son 🔒 y operan sobre los productos del usuario del token.

### 🔒 `products` — listar catálogo

```graphql
query {
  products(search: "shampoo", includeInactive: false) {
    id name brand packageSize unit barcode isConsumable inStock
    category { name }
  }
}
```

| Argumento | Tipo | Descripción |
| --- | --- | --- |
| `search` | `String` | Búsqueda parcial por nombre (case-insensitive) |
| `includeInactive` | `Boolean` | Incluir productos desactivados (default `false`) |

El campo **`inStock`** indica si el producto tiene un ciclo de consumo abierto, es decir: *"hay shampoo"*.

### 🔒 `product` — obtener uno

```graphql
query { product(id: "<id>") { id name inStock } }
```

### 🔒 `createProduct` — agregar al catálogo

```graphql
mutation {
  createProduct(input: {
    name: "Shampoo Head & Shoulders"
    brand: "P&G"
    packageSize: 400
    unit: MILLILITER
    barcode: "7702006547891"
    categoryId: "<id>"
    isConsumable: true
    notes: "comprar en oferta"
  }) { id name unit }
}
```

`isConsumable: false` marca bienes durables, que no llevan ciclo de agotamiento.

### 🔒 `updateProduct` / `removeProduct`

```graphql
mutation { updateProduct(input: { id: "<id>", brand: "H&S", isActive: false }) { id brand } }
mutation { removeProduct(id: "<id>") }
```

### 🔒 `productStats` — estadísticas y predicción

```graphql
query {
  productStats {
    productId name
    closedCycles
    avgDaysLasted minDaysLasted maxDaysLasted
    avgUnitPrice lastPurchasedOn
    estimatedDepletionDate
  }
}
```

`estimatedDepletionDate` proyecta cuándo se acabará el producto del ciclo abierto, sumando la duración promedio a la fecha en que se empezó a usar.

---

## Compras y ciclos de consumo

El flujo que conecta productos con el inventario:

```
registerProductPurchase → abre ciclo de consumo → inStock: true
markProductDepleted     → cierra el ciclo + agrega a la lista de compras → inStock: false
registerProductPurchase → abre ciclo nuevo + marca el ítem como comprado → inStock: true
```

### 🔒 `registerProductPurchase` — registrar una compra

Con un producto **ya existente**:

```graphql
mutation {
  registerProductPurchase(input: {
    productId: "<id>"
    quantity: 1
    unitPrice: 26500
    store: "D1"
    purchasedOn: "2026-07-18"
    expenseId: "<idDelGastoDelMercado>"
  }) {
    id totalPrice product { name inStock }
  }
}
```

Creando el producto **en la misma compra** (cuando aún no está en el catálogo):

```graphql
mutation {
  registerProductPurchase(input: {
    newProduct: { name: "Shampoo", brand: "H&S", packageSize: 400, unit: MILLILITER }
    unitPrice: 25000
    store: "Éxito"
    purchasedOn: "2026-07-10"
  }) {
    id product { id name }
  }
}
```

Efectos automáticos al registrar la compra:

1. Si el producto es consumible y **no** tiene ciclo abierto, se abre uno → `inStock: true`.
2. Los ítems **pendientes** de la lista de compras para ese producto pasan a `purchased` y quedan vinculados a la compra.
3. `totalPrice` se calcula solo (`unitPrice * quantity`).

Debe enviarse `productId` **o** `newProduct`, nunca ambos ni ninguno (`BAD_REQUEST`).

### 🔒 `markProductDepleted` — "se acabó"

```graphql
mutation {
  markProductDepleted(productId: "<id>", depletedOn: "2026-07-17") {
    id name inStock
  }
}
```

Cierra el ciclo abierto (calculando `daysLasted`) y **agrega el producto a la lista de compras** marcado como `autoAdded`, sin duplicar si ya estaba pendiente; si el usuario no tiene lista activa, se crea una. `depletedOn` es opcional: por defecto usa la fecha de hoy. Falla con `BAD_REQUEST` si el producto no tiene un ciclo abierto.

### 🔒 `productPurchases` — historial de compras

```graphql
query {
  productPurchases(productId: "<id>") {
    id purchasedOn quantity unitPrice totalPrice store expenseId
    product { name }
  }
}
```

`productId` es opcional: sin él devuelve todas las compras del usuario, ordenadas por fecha descendente.

### 🔒 `consumptionCycles` — ciclos de un producto

```graphql
query {
  consumptionCycles(productId: "<id>") {
    id startedOn depletedOn daysLasted quantity purchaseId
  }
}
```

`depletedOn: null` indica el ciclo en curso. Solo puede haber **un ciclo abierto por producto** (garantizado con un índice único parcial en la base de datos).

---

## Utilidades

### `health` — healthcheck

```graphql
query { health }
```

---

## Tipos y enums

### `TransactionKind`

`EXPENSE` · `INCOME`

### `Recurrence`

`ONCE` · `DAILY` · `WEEKLY` · `BIWEEKLY` · `MONTHLY` · `BIMONTHLY` · `QUARTERLY` · `SEMIANNUAL` · `ANNUAL`

### `ArticleType`

`PRODUCT` · `SERVICE` · `OTHER`

### `UnitOfMeasure`

`UNIT` · `GRAM` · `KILOGRAM` · `MILLILITER` · `LITER` · `PACK` · `ROLL` · `PAIR` · `OTHER`

### `AuthProvider`

`LOCAL` · `GOOGLE`

---

## Manejo de errores

Los errores siguen el formato estándar de GraphQL, con el código en `extensions.code`:

```json
{
  "errors": [
    {
      "message": "Las categorías del sistema no se pueden eliminar",
      "path": ["removeCategory"],
      "extensions": { "code": "BAD_REQUEST" }
    }
  ],
  "data": null
}
```

| Código | Cuándo ocurre |
| --- | --- |
| `UNAUTHENTICATED` | Falta el token, está expirado o es inválido; credenciales incorrectas en `login` |
| `BAD_REQUEST` | Datos inválidos: formato de periodo incorrecto, modificar categorías del sistema, marcar como agotado un producto sin ciclo abierto, enviar `productId` y `newProduct` a la vez |
| `NOT_FOUND` | El recurso no existe o no pertenece al usuario |
| `CONFLICT` | El email ya está registrado |
| `GRAPHQL_VALIDATION_FAILED` | El query no cumple el esquema (campo inexistente, tipo incorrecto) |
| `INTERNAL_SERVER_ERROR` | Error no controlado del servidor |

En producción (`NODE_ENV=production`) las respuestas de error omiten el `stacktrace` y el `originalError`.
