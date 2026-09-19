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
- [Cuentas](#cuentas)
- [Gastos](#gastos)
- [Ingresos](#ingresos)
- [Gastos recurrentes](#gastos-recurrentes)
- [Artículos](#artículos)
- [Inflación](#inflación)
- [Productos](#productos)
- [Compras y ciclos de consumo](#compras-y-ciclos-de-consumo)
- [Inversiones](#inversiones)
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

## Cuentas

Una **cuenta** (`Account`) es de donde salen los gastos y a donde entran los ingresos: efectivo, cuenta bancaria, tarjeta, billetera, etc. Todos los endpoints son 🔒.

Cada cuenta tiene un **saldo** (`balance`) que se mantiene automáticamente: los ingresos lo suben, los gastos lo bajan y las transferencias lo mueven entre cuentas. En tarjetas de crédito el `balance` **negativo es la deuda** y `availableCredit = creditLimit + balance` es el cupo disponible.

### 🔒 `accounts` — listar

```graphql
query {
  accounts(includeInactive: false) {
    id name type currency openingBalance balance availableCredit isActive
  }
}
```

### 🔒 `createAccount` / `updateAccount` / `removeAccount`

```graphql
mutation {
  createAccount(input: {
    name: "Bancolombia", type: BANK_TRANSFER, currency: "COP", openingBalance: 500000
  }) { id name type openingBalance balance }
}
mutation { updateAccount(input: { id: "<id>", name: "Bancolombia Ahorros", isActive: false }) { id name } }
mutation { removeAccount(id: "<id>") }
```

Al crear una cuenta, `balance` arranca en `openingBalance`. Campos de tarjeta de crédito (solo cuando `type: CREDIT`): `creditLimit` (el **cupo**), `statementDay`, `dueDay`, `monthlyRate`. Al borrar una cuenta, los gastos/ingresos que la referencian quedan con cuenta nula; si tiene **planes de cuotas** o **transferencias**, el borrado falla con `BAD_REQUEST`. También existe `account(id)`.

### 🔒 Control de cupo (tarjetas de crédito)

Al registrar un gasto contra una cuenta `CREDIT`, el backend rechaza (`BAD_REQUEST`) si el gasto excede el cupo disponible, es decir si `monto > creditLimit + balance`. Un gasto que llega justo al tope (deja `availableCredit: 0`) sí se permite.

### 🔒 `transferBetweenAccounts` — transferir saldo / pagar tarjeta

```graphql
mutation {
  transferBetweenAccounts(input: {
    fromAccountId: "<idOrigen>", toAccountId: "<idDestino>", amount: 50000, note: "pago tarjeta"
  }) {
    amount occurredOn
    fromAccount { name balance }
    toAccount { name balance availableCredit }
  }
}
```

Baja el saldo de la cuenta origen y sube el de la destino, de forma atómica. **Transferir a una cuenta de crédito paga la tarjeta** (reduce la deuda → `balance` menos negativo, `availableCredit` sube). Valida que ambas cuentas sean del usuario, que sean distintas, `amount > 0` y **fondos suficientes en el origen** (para cuentas de activo; para origen crédito se valida el cupo). `occurredOn` es opcional (hoy por defecto).

### 🔒 `accountTransfers` / `recalculateAccountBalance`

```graphql
query { accountTransfers(accountId: "<id>") { amount occurredOn fromAccount { name } toAccount { name } } }
mutation { recalculateAccountBalance(id: "<id>") { name balance } }
```

`accountTransfers` lista las transferencias (opcional por cuenta). `recalculateAccountBalance` recomputa el `balance` desde los movimientos (`openingBalance` + ingresos − gastos + transferencias) — útil como corrección ante cualquier descuadre.

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

Un gasto puede tener **varios artículos** (`items`) o ninguno. El importe se calcula:
- **Sin ítems**: se envía `amount` (obligatorio).
- **Con ítems**: `amount` = suma de `unitPrice * quantity` de cada ítem (se ignora el `amount` que se envíe). Con **un solo ítem** la categoría se hereda del artículo si no se envía `categoryId`.

Cada ítem usa **uno** de `articleId` / `newArticle`. Si el artículo es **tipo producto**, entra al inventario (`products`, `inStock`, ciclo de consumo — ver [Compras y ciclos de consumo](#compras-y-ciclos-de-consumo)).

```graphql
mutation {
  createExpense(input: {
    userId: "<userId>"
    description: "Mercado semana"
    occurredOn: "2026-07-15"
    accountId: "<idCuenta>"
    categoryId: "<id>"
    items: [
      { newArticle: { name: "Pan", type: PRODUCT }, unitPrice: 2000, quantity: 10 },
      { articleId: "<idLeche>", unitPrice: 4500, quantity: 2 }
    ]
  }) {
    id description amount account { name }
    items { unitPrice quantity subtotal article { name } }
  }
}
```

Gasto simple sin artículos:

```graphql
mutation {
  createExpense(input: {
    userId: "<userId>", description: "Taxi", amount: 15000,
    occurredOn: "2026-07-15", accountId: "<idCuenta>"
  }) { id amount }
}
```

Obligatorios: `userId`, `description`, `occurredOn`, y `amount` **o** al menos un ítem (`BAD_REQUEST` si faltan ambos). El gasto sale de la cuenta indicada en `accountId` (ver [Cuentas](#cuentas)).

### `updateExpense` / `removeExpense`

```graphql
mutation { updateExpense(input: { id: "<id>", notes: "ajustado" }) { amount notes } }
mutation { removeExpense(id: "<id>") }
```

Enviar `items` en `updateExpense` **reemplaza** todos los ítems y recalcula el importe (no re-dispara el inventario).

---

## Ingresos

Funcionan igual que los gastos, con el campo adicional `source` (de dónde viene el dinero) y `accountId` como **cuenta destino** a la que entra el dinero.

```graphql
query {
  incomes(userId: "<userId>", filter: { from: "2026-01-01" }) {
    id description source amount occurredOn recurrence category { name } account { name }
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
    accountId: "<idCuenta>"
    recurrence: MONTHLY
  }) { id amount source account { name } }
}
```

También existen `income(id)`, `updateIncome(input)` y `removeIncome(id)`.

---

## Gastos recurrentes

Una **plantilla** que genera un gasto real cada cierto periodo (semanal, mensual, etc.). Un job diario materializa los que vencen; también se pueden generar a demanda. Todos los endpoints son 🔒.

### 🔒 `recurringExpenses` — listar plantillas

```graphql
query {
  recurringExpenses(includeInactive: false) {
    id description recurrence nextRunOn endOn isActive account { name }
    items { unitPrice quantity article { name } }
  }
}
```

### 🔒 `createRecurringExpense` — crear plantilla

```graphql
mutation {
  createRecurringExpense(input: {
    description: "Arriendo"
    amount: 1200000
    recurrence: MONTHLY
    startOn: "2026-08-01"
    accountId: "<idCuenta>"
    categoryId: "<id>"
  }) { id description recurrence nextRunOn }
}
```

Acepta lo mismo que un gasto: `amount` **o** `items` (artículos con precio/cantidad), `accountId`, `categoryId`, `merchant`, `notes`. `recurrence` no puede ser `ONCE` (`BAD_REQUEST`). `startOn` es la primera ocurrencia; `endOn` (opcional) desactiva la plantilla al superarse. `nextRunOn` arranca en `startOn`.

### 🔒 `updateRecurringExpense` / `removeRecurringExpense`

```graphql
mutation { updateRecurringExpense(input: { id: "<id>", amount: 1300000, isActive: false }) { id amount } }
mutation { removeRecurringExpense(id: "<id>") }
```

### 🔒 `runDueRecurringExpenses` — generar los vencidos

```graphql
mutation { runDueRecurringExpenses }
```

Materializa todos los gastos recurrentes con `nextRunOn <= hoy` (haciendo *catch-up* si hay varios periodos pendientes), avanza `nextRunOn` según la frecuencia y desactiva los que superan `endOn`. Devuelve cuántos gastos se crearon. Lo ejecuta también un **job diario** automáticamente (3am), así que llamarlo es opcional (útil para pruebas o forzar la generación).

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

Un **producto** es simplemente un **artículo `type: PRODUCT`** (con inventario). No hay entidad ni tipo GraphQL `Product`: estos endpoints devuelven `Article`. Todos son 🔒 y operan sobre los artículos del usuario del token. Los productos **no se crean aquí** — nacen al registrar un gasto con un artículo tipo producto (ver [Gastos](#gastos)).

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

Devuelve solo artículos `type = PRODUCT`. El campo **`inStock`** indica si el producto tiene un ciclo de consumo abierto, es decir: *"hay shampoo"*.

### 🔒 `product` — obtener uno

```graphql
query { product(id: "<id>") { id name inStock } }
```

### 🔒 `updateProduct` / `removeProduct`

Editan/eliminan el artículo subyacente y devuelven `Article`.

```graphql
mutation {
  updateProduct(input: {
    id: "<id>"
    barcode: "7702006547891"
    packageSize: 400
    unit: MILLILITER
    isConsumable: true
    isActive: false
  }) { id name barcode }
}
mutation { removeProduct(id: "<id>") }
```

`isConsumable: false` marca bienes durables, que no llevan ciclo de agotamiento.

### 🔒 `productStats` — estadísticas y predicción

```graphql
query {
  productStats {
    articleId name
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
gasto (artículo tipo producto) → abre ciclo de consumo → inStock: true
markProductDepleted            → cierra el ciclo + agrega a la lista de compras → inStock: false
gasto del mismo artículo       → abre ciclo nuevo + marca el ítem como comprado → inStock: true
```

> El artículo tipo producto normalmente entra al inventario al registrar un **gasto**; `registerProductPurchase` permite además registrar una compra manual.

### 🔒 `registerProductPurchase` — registrar una compra

Registra una compra manualmente (aparte del flujo de gastos), sobre un artículo. Con un artículo **ya existente**:

```graphql
mutation {
  registerProductPurchase(input: {
    articleId: "<id>"
    quantity: 1
    unitPrice: 26500
    store: "D1"
    purchasedOn: "2026-07-18"
    expenseId: "<idDelGastoDelMercado>"
  }) {
    id totalPrice article { name inStock }
  }
}
```

Creando el artículo **en la misma compra** (cuando aún no está en el catálogo):

```graphql
mutation {
  registerProductPurchase(input: {
    newArticle: { name: "Shampoo", type: PRODUCT, brand: "H&S", packageSize: 400, unit: MILLILITER }
    unitPrice: 25000
    store: "Éxito"
    purchasedOn: "2026-07-10"
  }) {
    id article { id name }
  }
}
```

Efectos automáticos al registrar la compra:

1. Si el artículo es consumible y **no** tiene ciclo abierto, se abre uno → `inStock: true`.
2. Los ítems **pendientes** de la lista de compras para ese artículo pasan a `purchased` y quedan vinculados a la compra.
3. `totalPrice` se calcula solo (`unitPrice * quantity`).

Debe enviarse `articleId` **o** `newArticle`, nunca ambos ni ninguno (`BAD_REQUEST`).

### 🔒 `markProductDepleted` — "se acabó"

```graphql
mutation {
  markProductDepleted(articleId: "<id>", depletedOn: "2026-07-17") {
    id name inStock
  }
}
```

Cierra el ciclo abierto (calculando `daysLasted`) y **agrega el artículo a la lista de compras** marcado como `autoAdded`, sin duplicar si ya estaba pendiente; si el usuario no tiene lista activa, se crea una. `depletedOn` es opcional: por defecto usa la fecha de hoy. Falla con `BAD_REQUEST` si el artículo no tiene un ciclo abierto.

### 🔒 `productPurchases` — historial de compras

```graphql
query {
  productPurchases(articleId: "<id>") {
    id purchasedOn quantity unitPrice totalPrice store expenseId
    article { name }
  }
}
```

`articleId` es opcional: sin él devuelve todas las compras del usuario, ordenadas por fecha descendente.

### 🔒 `consumptionCycles` — ciclos de un artículo

```graphql
query {
  consumptionCycles(articleId: "<id>") {
    id startedOn depletedOn daysLasted quantity purchaseId
  }
}
```

`depletedOn: null` indica el ciclo en curso. Solo puede haber **un ciclo abierto por artículo** (garantizado con un índice único parcial en la base de datos).

---

## Inversiones

Registro y seguimiento de la cartera. El backend responde cuánto tengo, cuánto aporté, cuánto gané y cómo se reparte.

### Cómo funciona

El sistema guarda **un libro de operaciones** (`investmentTransactions`) con 13 tipos de movimiento. Todo lo demás —lotes, posiciones, efectivo, P&L— es **derivado**: se reconstruye a partir de ese libro y nunca se edita por separado.

**La base de costo es FIFO**, con lotes fiscales persistidos. Es la única disponible y no es configurable: es lo que exige la DIAN y lo que reportan IBKR y eToro. En una venta se consumen los lotes más antiguos primero, y cada lote consumido deja un registro auditable.

> Ejemplo: compras 10 @ 150, luego 10 @ 170, y vendes 15 @ 200.
> FIFO da `10 × (200−150) + 5 × (200−170) = **650**`.
> El costo promedio ponderado habría dado 600. El número que verás es 650.

**El P&L realizado y el no realizado salen de la misma pasada de cálculo**, así que no pueden discrepar: lo no realizado se computa sobre exactamente los lotes que la venta dejó abiertos.

### Efecto de cada operación

| Tipo | Efectivo | Cantidad | Base de costo | P&L realizado |
| --- | --- | --- | --- | --- |
| `BUY` | −(importe+comisión+impuesto) | +cantidad | abre lote, **comisiones capitalizadas** | — |
| `SELL` | +(importe−comisión−impuesto) | −cantidad | consume lotes FIFO | sí, uno por lote |
| `DIVIDEND` | +(importe−impuesto−comisión) | — | intacta | no: es **ingreso** |
| `INTEREST` | +(importe−impuesto−comisión) | — | intacta | no: es ingreso |
| `DEPOSIT` | +importe | — | — | **flujo externo +** (capital aportado) |
| `WITHDRAWAL` | −importe | — | — | **flujo externo −** |
| `FEE` | −importe | — | **nunca la toca** | no |
| `TAX` | −importe | — | nunca la toca | no |
| `SPLIT` | sin efecto | ×(num/den) | costo unitario ÷(num/den); **base total invariante** | — |
| `TRANSFER_IN` | sin efecto | +cantidad | abre lote (ver escalera abajo) | — |
| `TRANSFER_OUT` | sin efecto | −cantidad | consume FIFO; con `counterpartyAccountId` reabre los lotes allí **conservando base y fecha** | **no**: una transferencia no es una enajenación |
| `CURRENCY_EXCHANGE` | −importe en `currency`, +`settlementAmount` en `settlementCurrency` | — | — | no |

**Convención de signo**: `quantity`, `amount`, `fee` y `tax` son siempre positivos. La dirección la marca el `type`. La base de datos lo verifica con `CHECK`.

**Comisiones e impuestos**: los que forman parte de la operación van en los campos `fee`/`tax` de esa fila y se capitalizan (compra) o se netean (venta). Los cargos sueltos se registran como filas `FEE`/`TAX` propias y **nunca tocan la base**, aunque lleven `instrumentId`. Eso es lo que mantiene honesto el retorno: se ven como caída de valor, no como flujo externo.

**Escalera de la base de costo en `TRANSFER_IN`** (los brókers no suelen darla):

1. El `price` de la fila, si se aportó → base exacta.
2. El cierre cacheado de esa fecha → base **estimada**.
3. Sin precio → lote con costo 0, **marcado**.

En los casos 2 y 3 el lote queda con `costBasisIsEstimated: true`, y se propaga a `PositionView.costBasisIsEstimated` y a `PortfolioSummary.estimatedBasisPositionsCount`. Un P&L calculado sobre una base estimada se **marca**, no se publica como si fuera exacto. Se corrige con `setLotCostBasis`.

### 🔒 `investmentAccounts` — cuentas de inversión

```graphql
query { investmentAccounts { id name broker currency isActive } }
```

Mutaciones: `createInvestmentAccount`, `updateInvestmentAccount`, `deleteInvestmentAccount`.
El `broker` puede ser `ETORO`, `INTERACTIVE_BROKERS`, `BINANCE`, `XTB` o `MANUAL`.

### 🔒 `investmentCashBalances` — efectivo por moneda

Una cuenta de bróker sostiene USD, EUR y USDT a la vez, así que el saldo es **uno por moneda**, no uno solo.

```graphql
query { investmentCashBalances(accountId: "...") { currency amount } }
```

### 🔒 `investmentTransactions` — el libro de operaciones

**Es el único endpoint paginado del backend.** Un histórico de 5 años de IBKR más Binance pasa fácil de 20 000 filas.

```graphql
query {
  investmentTransactions(filter: {
    from: "2026-01-01", to: "2026-12-31",
    accountId: "...", instrumentId: "...",
    types: [BUY, SELL],
    limit: 100, offset: 0
  }) { id type occurredOn quantity price amount fee tax currency
       instrument { symbol } account { name } }
  investmentTransactionsCount(filter: { types: [BUY, SELL] })
}
```

`limit` por defecto 100, máximo **500**; por encima devuelve `BAD_REQUEST`.

```graphql
mutation {
  createInvestmentTransaction(input: {
    accountId: "...", instrumentId: "...", type: BUY,
    occurredOn: "2026-01-02", quantity: 10, price: 150, currency: "USD"
  }) { id }
}
```

En `BUY` y `SELL`, si se omite `amount` se calcula como `quantity × price`.
`occurredAt` es opcional y solo sirve para desempatar el orden FIFO dentro del mismo día.

**Deduplicación**: cada operación lleva un `dedupeHash` con un índice único por usuario. Registrar dos veces lo mismo devuelve `CONFLICT`. Si de verdad hiciste dos operaciones idénticas el mismo día, usa `occurrenceIndex: 1` en la segunda.

Mutaciones: `updateInvestmentTransaction`, `deleteInvestmentTransaction`. Cualquier edición o borrado reconstruye lotes y posiciones **en la misma transacción de base de datos**, así que el libro y sus derivados no pueden quedar descuadrados.

### 🔒 `investmentPositions` — posiciones valoradas

```graphql
query {
  investmentPositions(filter: { asOf: "2026-09-19", includeClosed: false }) {
    quantity averageCost costBasis costBasisBase
    lastPrice lastPriceOn marketValueBase unrealizedPnlBase unrealizedReturn
    realizedPnlToDateBase costBasisIsEstimated priceMissing
    instrument { symbol name sector country } account { name broker }
  }
}
```

> `averageCost` es un **informe** de los lotes FIFO abiertos, no un segundo método de cálculo. No lo uses para computar P&L realizado.

**Sin precio no se valora en 0.** `marketValueBase` queda en `null`, `priceMissing` en `true`, y la posición se excluye del total y se cuenta en `missingPriceCount`. Un número ausente es honesto; un cero es una mentira.

### 🔒 `portfolioSummary` — resumen de la cartera

```graphql
query {
  portfolioSummary(asOf: "2026-09-19") {
    baseCurrency asOf
    investedCapital costBasis marketValue cash
    unrealizedPnl realizedPnl dividends interest fees taxes
    simpleReturn positionsCount
    missingPriceCount estimatedBasisPositionsCount pricesStale pricesAsOf
  }
}
```

| Campo | Qué es |
| --- | --- |
| `investedCapital` | Capital aportado: depósitos menos retiros |
| `costBasis` | Patrimonio invertido: base de costo de las posiciones abiertas |
| `marketValue` | Valor actual: posiciones a precio de mercado más efectivo |
| `unrealizedPnl` | Ganancia o pérdida **no** realizada |
| `realizedPnl` | Ganancia o pérdida realizada acumulada (FIFO) |
| `dividends` | Dividendos recibidos, netos de retención |
| `simpleReturn` | `(valor actual − capital aportado) / capital aportado`, en %. `null` sin capital aportado |

Los cuatro últimos campos son la **honestidad del dato**: cuántas posiciones no se pudieron valorar, cuántas tienen base estimada, y si algún precio usado es anterior a la fecha pedida.

### 🔒 `portfolioAllocation` — distribución

```graphql
query { portfolioAllocation(dimension: SECTOR, asOf: "2026-09-19") {
  total missingPriceCount
  slices { key label marketValue costBasis percentage positionsCount }
} }
```

`dimension` acepta `BROKER`, `INSTRUMENT`, `SECTOR`, `COUNTRY`, `CURRENCY` y `ASSET_CLASS`.
El `total` **excluye** las posiciones sin precio; las excluidas se cuentan en `missingPriceCount`.

### 🔒 Instrumentos

Los instrumentos son datos de referencia **globales**, sin dueño: el histórico de precios que descarga un usuario sirve para todos.

```graphql
query { instrumentSearch(query: "AAPL", limit: 25) { id symbol name currency sector country assetClass } }
mutation { createInstrument(input: {
  symbol: "AAPL", name: "Apple Inc.", currency: "USD",
  exchange: "NASDAQ", assetClass: EQUITY, sector: "Technology", country: "US"
}) { id } }
mutation { setInstrumentPrice(input: { instrumentId: "...", close: 220, priceOn: "2026-09-19" }) { lastPrice } }
```

`setInstrumentPrice` no pisa la valoración de hoy si cargas un cierre más antiguo.

### 🔒 `setLotCostBasis` — corregir una base estimada

```graphql
mutation { setLotCostBasis(input: { lotId: "...", costPerUnit: 120 }) { id costPerUnit costBasisIsEstimated } }
```

Corrige la operación de origen y reconstruye, porque el P&L realizado de cualquier venta posterior cambia.

### 🔒 `rebuildInvestmentPositions` — válvula manual

```graphql
mutation { rebuildInvestmentPositions(accountId: "...") }
```

Recalcula lotes, realizaciones, posiciones y efectivo desde el libro. Es el equivalente de `recalculateAccountBalance`. **El resultado debe coincidir exactamente con el del camino incremental**; si no coincide, hay un bug.

### 🔒 `portfolioEvolution` — evolución del patrimonio

Serie diaria construida desde el libro y guardada en `portfolio_snapshots`.

```graphql
query { portfolioEvolution(from: "2026-01-01", to: "2026-09-19") {
  baseCurrency estimatedDays
  points { date totalValue marketValue cash costBasis contributions netFlow
           unrealizedPnl realizedPnl dividends twrIndex isEstimated missingPriceCount }
} }
```

`twrIndex` es el índice encadenado con base 100 al inicio de la serie. Se **persiste** porque encadenar no se puede rederivar desde el estado final: con él, la rentabilidad entre dos fechas son dos lecturas y una división.

`isEstimated` marca los días cuya valoración usó un precio o una tasa arrastrados de un día anterior (fines de semana, festivos, huecos del proveedor).

> ⚠️ **`isStale`**: `portfolioSummary` lee posiciones y precios **en vivo**, mientras que `portfolioEvolution` y `portfolioReturns` leen los **snapshots persistidos**. Si escribes operaciones y no reconstruyes, los dos divergen: en pruebas la diferencia llegó a **20 puntos de TWR**. Cuando `isStale` es `true`, ejecuta `rebuildPortfolioSnapshots` (no gasta créditos) o espera al job de las 02:30.

### 🔒 `portfolioReturns` — las tres rentabilidades

```graphql
query { portfolioReturns(from: "2026-01-01", to: "2026-09-19") {
  baseCurrency from to
  simpleReturn
  twr twrAnnualized twrAnnualizedStatus
  xirr xirrStatus
  endingValue investedCapital realizedPnl unrealizedPnl dividends
} }
```

Los tres números **no coinciden, y es correcto que no coincidan**: responden preguntas distintas.

| Métrica | Qué responde |
| --- | --- |
| `simpleReturn` | ¿Cuánto ha crecido mi dinero en total? |
| `twr` | ¿Cómo lo hicieron mis inversiones, ignorando *cuándo* metí el dinero? Es lo comparable contra un índice. |
| `xirr` | ¿Cuánto gané yo de verdad, teniendo en cuenta cuándo metí cada peso? |

El TWR encadena factores diarios `r_d = V_d / (V_{d-1} + F_d)`, donde `F_d` es el flujo **externo** del día. Depósitos, retiros y transferencias de activos son externos; **dividendos, intereses, comisiones e impuestos NO lo son**: el TWR los ve como variación de valor, que es lo que mantiene honesto el número.

`twrAnnualized` viene **`null` por debajo de 365 días**, a propósito, con `twrAnnualizedStatus: PERIOD_TOO_SHORT`. Anualizar un retorno de dos meses es la forma más fácil de publicar un disparate.

`xirr` es `null` cuando no se puede calcular, nunca `NaN`. `xirrStatus` dice por qué: `NOT_ENOUGH_FLOWS`, `NO_SIGN_CHANGE` (solo has aportado y aún no hay valor) o `DID_NOT_CONVERGE`.

### 🔒 `benchmarkComparison` — contra S&P 500, Nasdaq-100 y MSCI World

```graphql
query { benchmarkComparison(benchmarks: [SP500, NASDAQ100, MSCI_WORLD],
                            from: "2026-01-01", inBaseCurrency: true) {
  baseCurrency from to inBaseCurrency warnings
  series { key label totalReturn annualized annualizedStatus excessReturn basis
           points { date index } }
} }
```

Todas las series se normalizan a **100 en la fecha inicial**. La primera serie es siempre la cartera (`key: "portfolio"`).

Los índices son **ETF como proxy** (`SPY`, `QQQ`, `URTH`), no los índices en crudo: los símbolos de índice no están en la mayoría de planes de Twelve Data, y el nivel del índice excluye dividendos mientras que tu TWR los incluye.

**`inBaseCurrency: true` (por defecto) convierte el índice a tu moneda base antes de normalizar.** No es cosmético: un inversor en COP que compara contra un S&P 500 sin convertir obtiene un número materialmente equivocado, porque el movimiento COP/USD es parte de su rentabilidad real.

> **`basis: PRICE_ONLY`**: el plan actual de Twelve Data **no entrega `adjusted_close`** (verificado contra la API, tampoco con `&adjust=all`), así que el índice se compara **solo por precio, sin dividendos**. La comparación le es por tanto desfavorable al índice. Cuando el dato esté disponible, `basis` pasa a `TOTAL_RETURN` sin cambiar nada más. Los avisos correspondientes llegan en `warnings`.

### 🔒 `refreshInvestmentPrices` — traer precios y tasas

```graphql
mutation { refreshInvestmentPrices }
```

Refresca los cierres de lo que tienes en cartera, las tasas de cambio que hagan falta y el histórico de los benchmarks; después reconstruye los snapshots. Devuelve un resumen legible con los créditos consumidos.

`rebuildPortfolioSnapshots` hace **solo** la reconstrucción, sin tocar la red ni gastar créditos.

### Presupuesto del proveedor de precios

El plan Basic de Twelve Data da **8 créditos por minuto y 800 por día**, y todo el diseño gira en torno a eso.

- Una `time_series` con `outputsize=5000` cuesta **1 crédito y trae hasta 5000 barras diarias**: el histórico de un año de un activo cabe en un crédito. Por eso se piden rangos anchos, nunca día a día.
- Agrupar símbolos separados por comas ahorra **viajes de red, no créditos**: se cobra uno por símbolo igualmente.
- Solo se refresca a diario lo que alguien tiene en cartera hoy más los benchmarks. Lo demás va bajo demanda.
- El limitador es **híbrido**: una cadena de promesas espacia las llamadas dentro del proceso, y un contador en la tabla `market_data_usage` sobrevive a reinicios y a una segunda instancia, de modo que ni un reinicio ni un job caído a medias pueden reventar la cuota.
- Al agotarse el presupuesto, **la lectura nunca falla**: se sirve el caché y el resumen lo declara con `pricesStale`, `missingPriceCount` y `pricesAsOf`. La escritura para y **retoma sola** al día siguiente, porque la lista de trabajo sale del estado (`needs_daily_price`, `backfill_requested_from`) y no de una cola que pueda perderse.

Los límites se leen de `TWELVEDATA_CREDITS_PER_MINUTE` y `TWELVEDATA_CREDITS_PER_DAY`: subir de plan es configuración, no código.

### Multidivisa

Cada operación guarda su `currency` y el `fxRate` a la moneda base **congelado en el momento de escribir**, para que un informe histórico no se mueva cuando el proveedor revise su serie. Si no envías `fxRate`, se resuelve contra el caché `fx_rates`; si lo envías, se respeta y queda marcado como `MANUAL`.

La valoración diaria usa la tasa **de cada fecha**, resolviendo por identidad → directo → inverso → puente por USD, y arrastrando la última conocida cuando falta (el día queda marcado como estimado).

> Si registraste operaciones **antes** de que existiera caché de tasas, quedaron con `fxRate: 1`. Eso deja el flujo externo sin convertir mientras la cartera sí se valora convertida, y dispara el TWR. `resolveInvestmentFxRates` las corrige de una vez: re-resuelve solo las marcadas como `ASSUMED_ONE` y respeta las que escribiste a mano.

### Jobs programados

| Hora | Job | Qué hace |
| --- | --- | --- |
| 01:30 | `InvestmentsSyncCron` | Sincroniza las conexiones con brókers marcadas con `autoSync` |
| 02:00 | `MarketDataCron` | Recalcula qué instrumentos necesitan precio diario, los refresca y drena los backfills pendientes |
| 02:30 | `SnapshotsCron` | Refresca tasas de cambio y reconstruye la serie diaria de cada usuario |
| día 1, 03:30 | `MarketDataCron` | Descarga dividendos y splits anunciados (mensual: 2 créditos por instrumento) |

Ambos llevan `try/catch` (un fallo del proveedor no puede tumbar el scheduler), bandera en proceso y **cerrojo consultivo de Postgres**, para que dos instancias del backend no se solapen.

### Importar un statement (CSV / XLSX)

Va por **REST con multer**, no por GraphQL, igual que el análisis de facturas. Todos los endpoints cuelgan de `/investments/import` y exigen el access token.

El flujo es **subir → revisar → confirmar**: analizar NO persiste ninguna operación.

#### 1. `POST /investments/import/analyze`

`multipart/form-data` con el campo `file`, y `?accountId=` opcional (hace falta para poder detectar duplicados). Máximo 10 MB.

Acepta CSV, TSV y XLSX. La validación mira el tipo MIME **y la extensión**, porque un CSV llega muy a menudo como `application/octet-stream`.

Devuelve el borrador:

```jsonc
{
  "batchId": "…",
  "detectedProfile": "ibkr-flex-csv",
  "detectedBroker": "interactive_brokers",
  "confidence": 1.0,
  "columnMapping": { "occurredOn": "TradeDate", "fee": "IBCommission", … },
  "headers": ["TradeDate", "Symbol", …],
  "sheetName": "Movimientos",          // solo XLSX
  "stats": { "totalRows": 7, "importable": 5, "duplicates": 0,
             "withErrors": 1, "needingInstrument": 1 },
  "rows": [ { "rowNumber": 1, "type": "buy", "occurredOn": "2025-09-15",
              "symbol": "AAPL", "instrumentId": "…", "needsInstrument": false,
              "quantity": 10, "price": 230.5, "amount": 2305, "fee": 1.25,
              "isDuplicate": false, "errors": [], "raw": { … } } ]
}
```

**Los duplicados se marcan aquí, antes de confirmar**, calculando el `dedupeHash` y consultando el índice único. Así ves qué se va a saltar en vez de descubrirlo después. También se marcan los duplicados *dentro del mismo archivo*: entra el primero y los demás quedan señalados.

El hash se calcula sobre la **clave natural** de la operación (usuario, cuenta, tipo, fecha, instrumento, cantidad, importe, moneda) y **no incluye la referencia del bróker**, a propósito: si la incluyera, la misma compra llegando por CSV (con referencia) y por PDF (sin ella) daría dos hashes distintos y se duplicaría, que es justo lo que el hash existe para evitar. El id externo conserva su propio índice único para las sincronizaciones.

Una fila con `needsInstrument: true` o con `errors` **no se importa**; el resto del archivo sí.

#### Detección de columnas

Tres capas, en este orden, porque ninguna basta sola:

1. **Perfil por bróker** — `etoro-statement`, `ibkr-flex-csv`, `binance-trade-history`, `xtb-statement`. Acierta el caso habitual exactamente.
2. **Heurística genérica** — nombres de columna comunes en inglés y español, comparados sin acentos ni mayúsculas. Evita que un bróker desconocido sea un callejón sin salida.
3. **Corrección del usuario** — `POST /investments/import/remap` con `{ batchId, columnMapping, profileId? }` **re-parsea el archivo archivado** con tu mapeo, sin volver a subirlo. Eso es lo que hace seguro que las dos capas anteriores adivinen.

Cada perfil declara además cómo escribe ese bróker las fechas y los decimales, que no es un detalle menor:

- `01/09/2026` es el **1 de septiembre** en un perfil `DMY` y el **9 de enero** en uno `MDY`.
- `1.234,56` y `1,234.56` son el mismo número: el separador decimal es el que aparece **más a la derecha**. Adivinarlo mal multiplica el importe por mil.
- Los negativos entre paréntesis (`(2,305.00)`) y los símbolos de moneda se normalizan.

En XLSX se elige la hoja con más filas (los statements suelen traer una portada) y se busca la cabecera real saltando las filas de título.

#### 2. `POST /investments/import/commit`

```jsonc
{ "batchId": "…", "accountId": "…", "rows": [ /* opcional: el borrador editado */ ] }
```

Persiste en una transacción, reconstruye posiciones y pide el histórico de precios de los instrumentos nuevos. Respuesta:

```jsonc
{ "batchId": "…", "inserted": 5, "skippedDuplicates": 0,
  "skippedErrors": 2, "alreadyCommitted": false }
```

**Es idempotente en los dos ejes**: confirmar el mismo lote otra vez devuelve `alreadyCommitted: true` sin insertar nada, y volver a subir el mismo archivo marca todas sus filas como duplicadas (`importable: 0`).

#### PDF

El mismo endpoint `analyze` acepta PDF. El camino es distinto pero **desemboca en el mismo borrador**, con las mismas validaciones, la misma resolución de instrumento y la misma detección de duplicados: no hay una vía paralela con reglas propias.

1. Se extrae la capa de texto del PDF.
2. Si el PDF **no tiene texto** (es un escaneo) se **rechaza** con un mensaje claro que te remite al CSV o XLSX. No se intenta OCR: adivinar cifras de un escaneo es peor que pedirte el archivo bueno.
3. El texto se trocea por líneas (sin partir ninguna) y se manda a GPT-4o con *structured outputs*, el mismo patrón del análisis de facturas.

La instrucción al modelo es extraer, nunca interpretar: se le prohíbe explícitamente inventar operaciones, convertir monedas o calcular totales, y se le exige devolver los importes **siempre positivos** porque la dirección la marca el tipo.

Un statement en PDF **no admite re-mapeo**: no hay columnas que remapear, así que el archivo no se archiva.

> El PDF es el formato menos fiable de los tres y consume tu cuota de OpenAI. Si tu bróker ofrece CSV o XLSX, úsalo.

#### Otros endpoints

| Endpoint | Qué hace |
| --- | --- |
| `POST /investments/import/discard` | Descarta un lote sin confirmar |
| `GET /investments/import/batches` | Historial de lotes (nunca devuelve el archivo binario) |
| `GET /investments/import/batches/:id` | El borrador completo de un lote |

El archivo original se archiva en `import_batches.file_data` para poder re-parsear con otro mapeo, y **se borra al confirmar o descartar**.

### Conexión automática con brókers

> ⚠️ **Todo lo relacionado con credenciales está cerrado a las API keys por partida doble**: el resolver usa `GqlUserOnlyGuard` (rechaza cualquier principal que no sea un usuario con JWT) **y** ninguna operación declara `@Scopes`, lo que ya cierra por defecto a las API keys. Verificado: una API key con scope `ALL` recibe `UNAUTHENTICATED` en todas ellas.

#### Brókers soportados y qué credenciales pide cada uno

| Bróker | Credenciales | Vía | Notas |
| --- | --- | --- | --- |
| Binance | `apiKey`, `apiSecret` | REST firmado con HMAC-SHA256 | Crea la key en modo **solo lectura** |
| eToro | `apiKey`, `userKey` | REST | Settings > Trading > API Key Management, permiso **Read**. **Solo 1 año de historial** |
| Interactive Brokers | `token`, `queryId` | Flex Web Service v3 | Crea una *Activity Flex Query* y un token en Account Management |
| XTB | `userId`, `password` | WebSocket xAPI (**no oficial**) | Ver el aviso de abajo |

Se usa el **Flex Web Service** de IBKR y no la Client Portal API porque esta última exige un gateway corriendo en local y un 2FA manual a diario, inviable para un backend desatendido.

> 🔴 **Aviso sobre XTB**: XTB no tiene API oficial. La vía no oficial se autentica con tu **usuario y contraseña REALES de trading**, no con una API key revocable de solo lectura. Las credenciales se cifran con AES-256-GCM, pero **un volcado de la base de datos más una fuga de `INVESTMENTS_ENCRYPTION_KEY` equivale a comprometer tu cuenta de trading entera**. Empieza con credenciales de **demo**. Además, XTB puede cambiar el protocolo sin aviso y sin soporte.

#### Cómo se guardan las credenciales

Entran por `createBrokerConnection` y **no vuelven a salir jamás**: el único campo que GraphQL expone sobre ellas es `hasCredentials: Boolean`. Las columnas cifradas no tienen `@Field`, así que ni siquiera se pueden pedir.

- **AES-256-GCM** con IV aleatorio de 12 bytes por cifrado y etiqueta de autenticación de 16 bytes.
- El **AAD lleva el id de la conexión**: un atacante con acceso de escritura a la base **no puede mover** un secreto de una fila a otra, porque el descifrado falla.
- La clave sale de `INVESTMENTS_ENCRYPTION_KEY`, que debe ser **exactamente 64 caracteres hexadecimales** (`openssl rand -hex 32`). No se deriva de una frase con PBKDF2: eso invitaría a poner una contraseña débil donde hace falta entropía de verdad.
- Se valida en el **primer uso**, no al arrancar: el backend levanta sin ella mientras no haya conexiones.

**Rotación sin cortar el servicio**: pon la clave vieja en `INVESTMENTS_ENCRYPTION_KEY_PREVIOUS`, la nueva en `INVESTMENTS_ENCRYPTION_KEY` y ejecuta `rotateBrokerCredentials`. El descifrado prueba primero con la actual y cae a la anterior, así que las filas sin migrar siguen funcionando mientras la mutación las vuelve a sellar.

#### Operaciones

```graphql
query { brokerConnections { id broker label status hasCredentials lastSyncedAt lastError } }

mutation { createBrokerConnection(input: {
  broker: BINANCE, label: "Binance principal",
  credentials: { apiKey: "…", apiSecret: "…" }
}) { id hasCredentials } }

mutation { verifyBrokerConnection(id: "…") { status lastError } }
mutation { syncBrokerConnection(id: "…") { fetched inserted duplicates partial errors warnings } }
mutation { syncAllBrokerConnections { connectionId inserted duplicates errors } }
mutation { rotateBrokerCredentials }
```

También: `updateBrokerConnection` (el `broker` **no** se puede cambiar: invalidaría credenciales y cursor) y `deleteBrokerConnection`.

#### Estados de una conexión

| Estado | Qué significa |
| --- | --- |
| `ACTIVE` | Última operación correcta |
| `NEEDS_REAUTH` | El bróker rechazó las credenciales: hay que regenerarlas |
| `ERROR` | Fallo puntual; el siguiente intento puede funcionar |
| `DISABLED` | No se sincroniza |

#### Sincronización

`syncBrokerConnection` **es idempotente**: cada sincronización re-consulta a propósito una semana por detrás del cursor, porque deduplicar es gratis y ese solape es justo lo que atrapa las operaciones que el bróker liquida tarde o corrige después. Resincronizar un periodo ya traído devuelve `inserted: 0` y las cuenta en `duplicates`.

Una conexión que falla **no aborta las demás**: cada una registra su propio error en `lastError` y el informe los devuelve por separado. Cada sincronización deja además un registro en el historial de lotes (`GET /investments/import/batches`, con `source: BROKER_SYNC`).

El job `InvestmentsSyncCron` corre a las **01:30**, antes del refresco de precios de las 02:00, para que las posiciones nuevas entren en el refresco de esa misma noche. Solo toca las conexiones marcadas con `autoSync`.

### Acciones corporativas (dividendos y splits)

> **Se SUGIEREN, nunca se registran solas.** Es la decisión de corrección más importante de esta parte: insertarlas automáticamente duplicaría todo lo que la sincronización con el bróker ya trae, porque el bróker **ya** reporta el dividendo que pagó y el split que aplicó. Lo que aporta el proveedor de datos es detectar lo que **falta**, no rellenarlo por su cuenta.

```graphql
query { pendingCorporateActions {
  id type symbol exDate
  amountPerShare quantityHeld estimatedAmount
  ratioNumerator ratioDenominator currency description accountIds
} }
```

Una acción aparece aquí solo si **las tres** cosas son ciertas:

1. Su fecha es **posterior** a tu primera compra de ese activo.
2. **Tenías títulos** ese día, según tu propio libro.
3. **No hay ya** una operación tuya que la cubra (±5 días, porque los brókers liquidan con desfase).

`quantityHeld` es lo que tenías en la fecha ex según tu libro, y `estimatedAmount` es `quantityHeld × amountPerShare`.

```graphql
mutation { applyCorporateAction(actionId: "…", accountId: "…") { id type occurredOn amount } }
```

Registra la operación solo cuando tú confirmas que falta. Una vez aplicada desaparece de `pendingCorporateActions`, y volver a aplicarla devuelve `CONFLICT` por el índice de deduplicación.

`refreshCorporateActions` descarga dividendos y splits de lo que tengas en cartera. Cuesta **2 créditos por instrumento**, así que el job automático corre **mensualmente** (día 1 a las 03:30): estos datos cambian poco y consultarlos a diario sería tirar presupuesto.

Un split `4:1` se guarda como `ratioNumerator: 4, ratioDenominator: 1`, es decir, la cantidad se multiplica por 4.

### Alcance actual

**La feature está completa**: libro de 13 operaciones con FIFO y lotes fiscales, posiciones, efectivo multimoneda, métricas y distribuciones, precios y tasas automáticos desde Twelve Data con presupuesto, evolución histórica del patrimonio, TWR, XIRR/MWR, comparación contra benchmarks, importación de CSV, XLSX y PDF, conexión automática con Binance, eToro, Interactive Brokers y XTB, y detección de dividendos y splits pendientes.

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

### `PaymentMethodType` (tipo de cuenta)

`CASH` · `DEBIT` · `CREDIT` · `BANK_TRANSFER` · `DIGITAL_WALLET` · `OTHER`

### `UnitOfMeasure`

`UNIT` · `GRAM` · `KILOGRAM` · `MILLILITER` · `LITER` · `PACK` · `ROLL` · `PAIR` · `OTHER`

### `AuthProvider`

`LOCAL` · `GOOGLE`

### `InvestmentTransactionType`

`BUY` · `SELL` · `DIVIDEND` · `INTEREST` · `DEPOSIT` · `WITHDRAWAL` · `FEE` · `TAX` · `SPLIT` · `TRANSFER_IN` · `TRANSFER_OUT` · `CURRENCY_EXCHANGE`

### `BrokerKind`

`ETORO` · `INTERACTIVE_BROKERS` · `BINANCE` · `XTB` · `MANUAL`

### `InstrumentAssetClass`

`EQUITY` · `ETF` · `FUND` · `BOND` · `CRYPTO` · `FOREX` · `COMMODITY` · `CFD` · `CASH` · `OTHER`

### `AllocationDimension`

`BROKER` · `INSTRUMENT` · `SECTOR` · `COUNTRY` · `CURRENCY` · `ASSET_CLASS`

### `RealizationDisposition`

`SALE` · `TRANSFER_OUT`

### `InstrumentPriceSource`

`TWELVE_DATA` · `MANUAL` · `BROKER` · `NONE`

### `BenchmarkKey`

`SP500` · `NASDAQ100` · `MSCI_WORLD`

### `BenchmarkBasis`

`TOTAL_RETURN` · `PRICE_ONLY`

### `AnnualizedStatus`

`OK` · `PERIOD_TOO_SHORT` · `NO_BASE`

### `XirrStatus`

`OK` · `NOT_ENOUGH_FLOWS` · `NO_SIGN_CHANGE` · `DID_NOT_CONVERGE`

### `FxRateSource`

`MANUAL` · `TWELVE_DATA` · `BROKER` · `ASSUMED_ONE`

### `ImportSource`

`CSV` · `XLSX` · `PDF` · `BROKER_SYNC`

### `ImportStatus`

`PARSED` · `COMMITTED` · `FAILED` · `DISCARDED`

### `BrokerConnectionStatus`

`ACTIVE` · `NEEDS_REAUTH` · `ERROR` · `DISABLED`

### `CorporateActionType`

`DIVIDEND` · `SPLIT`

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
| `BAD_REQUEST` | Datos inválidos: formato de periodo incorrecto, modificar categorías del sistema, marcar como agotado un artículo sin ciclo abierto, enviar `articleId` y `newArticle` a la vez, gasto que **excede el cupo** de la tarjeta, transferencia con **fondos insuficientes** o a la misma cuenta |
| `NOT_FOUND` | El recurso no existe o no pertenece al usuario |
| `CONFLICT` | El email ya está registrado; una operación de inversión duplicada (mismo `dedupeHash`) |
| `GRAPHQL_VALIDATION_FAILED` | El query no cumple el esquema (campo inexistente, tipo incorrecto) |
| `INTERNAL_SERVER_ERROR` | Error no controlado del servidor |

En producción (`NODE_ENV=production`) las respuestas de error omiten el `stacktrace` y el `originalError`.
