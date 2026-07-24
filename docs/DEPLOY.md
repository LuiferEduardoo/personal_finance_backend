# Despliegue (CI/CD con GitHub Actions + Docker)

Flujo: al hacer push a `main`, GitHub Actions **construye la imagen Docker**, la **publica como package** en GitHub Container Registry (`ghcr.io`), luego entra al servidor **por SSH** y el servidor **descarga el package** (`docker pull`) y levanta el contenedor nuevo. Las migraciones se aplican solas al arrancar.

**En el servidor solo vive el archivo `.env`.** No hay compose ni código fuente: la app corre como un único contenedor con `docker run --env-file .env`. **La base de datos es externa** (gestionada / en otro host): se apunta con las variables `DB_*` del `.env`.

Archivos:
- [`Dockerfile`](../Dockerfile) — build multi-stage de la app.
- [`docker-entrypoint.sh`](../docker-entrypoint.sh) — corre `migration:run` y luego `node dist/main`.
- [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) — el workflow.

## Secrets de GitHub (repo → Settings → Secrets and variables → Actions)

| Secret | Para qué |
| --- | --- |
| `SSH_HOST` | IP o dominio del servidor |
| `SSH_USER` | usuario SSH (con acceso a Docker) |
| `SSH_KEY` | clave **privada** SSH (la `.pub` va en `~/.ssh/authorized_keys` del servidor) |
| `SSH_PORT` | puerto SSH (opcional, default 22) |
| `DEPLOY_PATH` | carpeta del servidor **que contiene únicamente el `.env`** (ej. `/opt/personal-finance`) |
| `GHCR_TOKEN` | PAT con scope `read:packages` para que el servidor descargue la imagen (no hace falta si el package se hace público) |
| `APP_PORT` | puerto del host donde exponer la app (opcional, default `3000`) |

> El push a ghcr en el workflow usa el `GITHUB_TOKEN` automático (con `packages: write`); no requiere secret. `GHCR_TOKEN` es solo para el **pull** desde el servidor.

### Acceso del servidor al package (importante)

Las imágenes de ghcr nacen **privadas**. El servidor necesita poder descargarlas, así que elige **una** de estas dos opciones:

- **Package privado (recomendado)**: crea un **PAT** (GitHub → Settings → Developer settings → Personal access tokens) con scope **`read:packages`** y guárdalo como el secret `GHCR_TOKEN`. El deploy hace `docker login` con él antes del `pull`.
- **Package público**: en GitHub → tu perfil → **Packages** → `personal_finance_backend` → **Package settings** → *Change visibility* → **Public**. Así **no** necesitas `GHCR_TOKEN` (déjalo sin definir; el deploy salta el login y hace el `pull` directo).

Si `GHCR_TOKEN` está vacío **y** el package es privado, el `pull` fallará con "denied" (por eso el error anterior de login: token vacío).

## Preparación del servidor (una sola vez)

1. Instalar **Docker**.
2. Autorizar la clave SSH del deploy (`SSH_KEY`) para `SSH_USER`, y que ese usuario pueda usar Docker (grupo `docker`).
3. Crear la carpeta `DEPLOY_PATH` y dejar dentro **solo el `.env`** de producción (basado en [`.env.example`](../.env.example)):

```env
NODE_ENV=production
# la app escucha 3000 dentro del contenedor; el puerto del host lo fija APP_PORT
PORT=3000

# --- base de datos EXTERNA ---
DB_HOST=tu-host-de-base-de-datos     # host de la BD gestionada, NO 'localhost'
DB_PORT=5432
DB_USERNAME=...
DB_PASSWORD=...
DB_NAME=personal_finance
DB_SCHEMA=public                      # esquema; cámbialo si tu proveedor usa otro

JWT_SECRET=<un secreto largo y aleatorio>
JWT_ACCESS_EXPIRATION=20m
REFRESH_TOKEN_TTL_DAYS=180

CORS_ORIGINS=https://tu-frontend.com
```

4. Asegurar que el servidor tenga **acceso de red a la base de datos** (firewall / lista blanca de IP en el proveedor).

> El contenedor usa la red por defecto de Docker (bridge con salida a internet), suficiente para llegar a una BD externa. No se necesita red de Docker propia.

> ⚠️ **Formato del `.env`**: el deploy usa `docker run --env-file`, que **no** parsea igual que dotenv. Escribe los valores **sin comillas** (`JWT_SECRET=abc123`, no `JWT_SECRET="abc123"` — las comillas quedarían dentro del valor), sin `export`, sin espacios alrededor del `=` y sin expansión de variables (`$OTRA` no se resuelve). Los comentarios con `#` sí se admiten.

## Cómo funciona el workflow

1. **build**: construye la imagen y la publica en `ghcr.io/luifereduardoo/personal_finance_backend` con tags `latest` y el `sha` del commit (con caché de Actions).
2. **deploy**: por SSH, dentro de `DEPLOY_PATH`:
   - `docker login ghcr.io` y `docker pull <imagen>:<sha>` — el servidor **descarga el package**.
   - Elimina el contenedor anterior y arranca el nuevo con `--env-file .env`, `-p ${APP_PORT}:3000` y `--restart unless-stopped`.
   - Espera y **verifica que el contenedor quedó corriendo**; si no, imprime los logs y falla el deploy.
   - Limpia imágenes viejas (`docker image prune -f`).

Al arrancar, el contenedor ejecuta `npm run migration:run` contra la BD externa y luego `node dist/main`.

## Disparar un deploy

- Automático: `git push` a `main`.
- Manual: pestaña **Actions → Build and deploy → Run workflow** (`workflow_dispatch`).

## Operación

```bash
# ver logs
docker logs -f personal_finance_app

# reiniciar
docker restart personal_finance_app

# rollback a un commit anterior
docker run -d --name personal_finance_app --restart unless-stopped \
  --env-file .env -e PORT=3000 -p 3000:3000 \
  ghcr.io/luifereduardoo/personal_finance_backend:<sha-anterior>
```

## Notas

- **Downtime**: el deploy elimina el contenedor y crea el nuevo, así que hay unos segundos de corte. Si necesitas cero downtime, habría que meter un reverse proxy (Traefik/Nginx) y hacer blue-green.
- **Migraciones**: se aplican al iniciar el contenedor. Con una sola instancia no hay carrera; si algún día corres varias réplicas, sacar las migraciones a un `docker run --rm <imagen> npm run migration:run` previo.
- **Puerto**: dentro del contenedor la app siempre escucha en 3000 (el deploy fuerza `-e PORT=3000`); el puerto del host se controla con el secret `APP_PORT`.
- **Imagen**: el runner conserva `node_modules` (incl. ts-node) y `src` para poder correr las migraciones con el tooling actual. Optimización futura: compilar las migraciones y un DataSource de producción para una imagen más liviana solo con deps de producción.
