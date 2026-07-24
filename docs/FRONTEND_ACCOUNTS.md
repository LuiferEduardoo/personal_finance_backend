# Plan de Frontend — Cuentas, saldos, transferencias y cupo

Plan enfocado en el módulo de **cuentas** tras agregar saldo real, transferencias entre cuentas y control de cupo en tarjetas de crédito. Complementa el [FRONTEND_PLAN.md](FRONTEND_PLAN.md) general.

> Todos los endpoints de cuentas son 🔒 (requieren `Authorization: Bearer <token>`; usan el usuario del token, **no** reciben `userId`).

## 1. Modelo mental (para no equivocarse con el signo)

Cada cuenta tiene:
- `openingBalance`: saldo inicial (se fija al crear).
- **`balance`**: saldo actual, mantenido por el backend. Ingresos suben, gastos bajan, transferencias mueven.
- **`availableCredit`**: solo tarjetas de crédito; `= creditLimit + balance`.

Interpretación del `balance` según el tipo:
| Tipo de cuenta | `balance` positivo | `balance` negativo |
| --- | --- | --- |
| Efectivo / banco / débito / billetera | dinero disponible | sobregiro (no debería pasar; las transferencias validan fondos) |
| **Crédito** | saldo a favor | **deuda** (lo normal); cupo usado = `-balance` |

Reglas de negocio que la UI debe reflejar:
- **Cupo**: no se puede registrar un gasto en una tarjeta si `monto > availableCredit`. El backend lo rechaza (`BAD_REQUEST`); el cliente debe avisarlo antes.
- **Pago de tarjeta**: transferir de una cuenta de activo → tarjeta de crédito **reduce la deuda** (sube `balance` hacia 0, sube `availableCredit`).
- **Transferencia**: valida fondos en el origen (activo) o cupo (origen crédito).

## 2. Operaciones GraphQL (exactas)

### Fragmento reutilizable
```graphql
fragment AccountFields on Account {
  id name type currency
  openingBalance balance availableCredit
  creditLimit statementDay dueDay monthlyRate
  issuer lastFour isActive
}
```

### Queries
```graphql
query Accounts($includeInactive: Boolean) {
  accounts(includeInactive: $includeInactive) { ...AccountFields }
}
query Account($id: ID!) { account(id: $id) { ...AccountFields } }
query AccountTransfers($accountId: ID) {
  accountTransfers(accountId: $accountId) {
    id amount occurredOn note
    fromAccount { id name type }
    toAccount { id name type }
  }
}
```

### Mutations
```graphql
mutation CreateAccount($input: CreateAccountInput!) { createAccount(input: $input) { ...AccountFields } }
mutation UpdateAccount($input: UpdateAccountInput!) { updateAccount(input: $input) { ...AccountFields } }
mutation RemoveAccount($id: ID!) { removeAccount(id: $id) }
mutation Transfer($input: TransferInput!) {
  transferBetweenAccounts(input: $input) {
    id amount occurredOn note
    fromAccount { ...AccountFields }
    toAccount { ...AccountFields }
  }
}
mutation RecalculateAccountBalance($id: ID!) { recalculateAccountBalance(id: $id) { id balance } }
```

### Shapes de input (para los formularios)
- `CreateAccountInput`: `name!`, `type!` (`PaymentMethodType`), `issuer?`, `lastFour?`, `currency?`(def `"COP"`), `creditLimit?`, `statementDay?`, `dueDay?`, `monthlyRate?`, `openingBalance?`(def `0`).
- `UpdateAccountInput`: los mismos (opcionales) + `id!` + `isActive?`.
- `TransferInput`: `fromAccountId!`, `toAccountId!`, `amount!`, `occurredOn?`(YYYY-MM-DD, def hoy), `note?`.

`PaymentMethodType`: `CASH · DEBIT · CREDIT · BANK_TRANSFER · DIGITAL_WALLET · OTHER`.

## 3. Pantallas y componentes

### 3.1 Listado de cuentas (`/accounts`)
- Query `accounts`. Card por cuenta con: nombre, tipo (ícono), y el **saldo** grande.
  - Activo: `balance` formateado como dinero.
  - Crédito: mostrar **deuda** (`-balance` si negativo) + barra de cupo (`usado / creditLimit`) y `availableCredit` disponible.
- Toggle "mostrar inactivas" → `includeInactive: true`.
- Acciones por card: Editar, Transferir, Ver movimientos, (⋯) Recalcular saldo, Desactivar/Borrar.
- Total agregado arriba: suma de saldos de cuentas de activo (opcional; no sumar las de crédito con las de activo, o mostrarlas separadas: "Disponible" vs "Deudas").

### 3.2 Crear / editar cuenta (modal o `/accounts/new`)
- `<AccountForm>` con RHF + Zod. Campos base: `name`, `type`, `currency`, `openingBalance` (solo en crear; en editar, ojo: cambiar `openingBalance` ajusta el `balance` por el delta).
- **Campos condicionales**: si `type === CREDIT`, mostrar `creditLimit` (etiquetar "**Cupo**"), `statementDay`, `dueDay`, `monthlyRate`. Si no es crédito, ocultarlos y no enviarlos (el backend valida que solo crédito los tenga → si no, `BAD_REQUEST`).
- En editar, permitir `isActive`.
- Al guardar → invalidar `accounts`.

### 3.3 Transferencia / pagar tarjeta (`<TransferModal>`)
- Selects `fromAccountId` y `toAccountId` (excluir la misma cuenta), `amount`, `occurredOn` (default hoy), `note`.
- **UX de pago de tarjeta**: si `toAccount.type === CREDIT`, cambiar el título a "Pagar tarjeta" y mostrar la deuda actual y cuánto quedará (`balance + amount`).
- **Validación cliente** (espejo del backend, para feedback inmediato):
  - `fromAccountId !== toAccountId`.
  - `amount > 0`.
  - Si `fromAccount.type !== CREDIT`: `amount <= fromAccount.balance` (si no, "fondos insuficientes").
  - Si `fromAccount.type === CREDIT`: `amount <= fromAccount.availableCredit`.
- Al confirmar → mutation `transferBetweenAccounts`; usa `fromAccount`/`toAccount` de la respuesta (ya traen el `balance` nuevo) para actualizar la caché; invalidar `accounts` y `accountTransfers`.

### 3.4 Movimientos de una cuenta (`/accounts/:id`)
- Detalle con `account(id)` + `accountTransfers(accountId)`. Listar transferencias (entrantes/salientes con signo según la cuenta). Botón "Recalcular saldo" (`recalculateAccountBalance`) para corrección manual.
- (Opcional) mezclar en un solo timeline los gastos/ingresos filtrados por `accountId` (`expenses(filter:{accountId})`, `incomes(filter:{accountId})`) para ver todo el movimiento de la cuenta.

## 4. Integración con el formulario de gasto (cupo)

En `<ExpenseForm>`, al elegir una cuenta de **crédito** en `accountId`:
- Mostrar el `availableCredit` de esa cuenta.
- Antes de enviar, si `amount > availableCredit` → bloquear con mensaje "Excede el cupo disponible (disponible: X)". Igual, el backend lo rechaza con `BAD_REQUEST` "El gasto excede el cupo disponible de la tarjeta" — capturar y mostrar.
- Recordar: en gastos multi-ítem, el `amount` es la **suma de los ítems**; validar contra el cupo con ese total.

## 5. Formato y helpers

- `<Money value={n} currency={acc.currency} />`: formatea; para crédito, mostrar deuda en rojo.
- Componente `<CreditGauge account={acc} />`: barra `usado / creditLimit` con `availableCredit`.
- `<AccountSelect>` (reutilizado en gasto/ingreso/recurrente/transferencia): muestra `name` + `balance` (y para crédito, `availableCredit`).

## 6. Caché e invalidación (Apollo)

El `balance` cambia en el backend con **cualquier** movimiento, así que:
- Tras `createExpense`/`updateExpense`/`removeExpense` con `accountId`: invalidar `accounts`, `account(id)` afectada.
- Tras `createIncome`/`updateIncome`/`removeIncome` con `accountId`: idem.
- Tras `transferBetweenAccounts`: la respuesta trae ambas cuentas actualizadas → escribirlas en caché; invalidar `accountTransfers`.
- Tras `runDueRecurringExpenses`: invalidar `accounts` (generó gastos que movieron saldos).
- Tras `recalculateAccountBalance`: actualizar esa cuenta con el `balance` devuelto.

## 7. Manejo de errores (por `extensions.code`)

| Situación | Código | Mensaje del backend |
| --- | --- | --- |
| Gasto que excede el cupo | `BAD_REQUEST` | "El gasto excede el cupo disponible de la tarjeta" |
| Transferencia sin fondos | `BAD_REQUEST` | "Fondos insuficientes en la cuenta origen" |
| Transferir a la misma cuenta | `BAD_REQUEST` | "Las cuentas origen y destino son la misma" |
| Borrar cuenta con cuotas/transferencias | `BAD_REQUEST` | "No se puede borrar la cuenta: tiene planes de cuotas o transferencias asociadas" |
| Campos de crédito en cuenta no-crédito | `BAD_REQUEST` (check DB) | validación del backend |

Mostrar el `message` directamente bajo el campo o en un toast.

## 8. Orden de implementación

1. Fragmento `AccountFields` + query `accounts` + listado con saldos.
2. `<AccountForm>` (crear/editar, campos condicionales de crédito).
3. `<AccountSelect>` con saldo (habilita gasto/ingreso/transferencia).
4. `<TransferModal>` (transferencia + pago de tarjeta) + `accountTransfers`.
5. Validación de cupo en `<ExpenseForm>`.
6. Detalle de cuenta con movimientos + recalcular.

## 9. Notas de contrato

- Montos en la moneda de la cuenta; el saldo **ignora `exchangeRate`** (asume misma moneda). Si manejas gastos en otra moneda contra una cuenta, el saldo puede quedar inconsistente — de momento usar la misma moneda por cuenta.
- `balance`/`availableCredit` son `Float`; `availableCredit` es `null` para cuentas que no son de crédito.
- El saldo es una columna mantenida por el backend; ante cualquier duda de descuadre existe `recalculateAccountBalance`.
