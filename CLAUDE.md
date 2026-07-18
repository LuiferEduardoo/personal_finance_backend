# Personal Finance Backend

Backend de finanzas personales. Este repositorio es **solo el backend** (API); no contiene frontend.

## Tecnologías

- **Framework**: NestJS (Node.js + TypeScript)
- **Base de datos**: PostgreSQL
- **ORM**: TypeORM (`@nestjs/typeorm`)
- **Autenticación**: JWT + OAuth con Google
- **Testing**: Jest (unitarios y e2e)
- **Gestor de paquetes**: npm

## Funcionalidades del proyecto

1. **Control de gastos**: registro de gastos categorizados (categorías, subcategorías, etc.).
2. **Inflación**: cálculo de inflación mensual y anual sobre los gastos registrados.
3. **Inventario de productos**: listar cuándo un producto se acaba y agregarlo automáticamente al inventario cuando se compra de nuevo.
4. **Análisis de facturas por imagen**: extraer los datos de una factura a partir de una imagen.
5. **Integración con correo electrónico**: conectar con el correo del usuario para analizar los correos y detectar automáticamente cuándo llega una factura.
6. **Registro de inversiones**: registro y seguimiento de las inversiones del usuario.

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

## Notas

- Las variables sensibles (credenciales de PostgreSQL, secretos JWT, credenciales OAuth de Google, credenciales de correo) van en archivos `.env`, que están ignorados por git.
