#!/bin/sh
set -e

echo "==> Verificando esquema (lo crea si no existe)..."
npm run schema:ensure

echo "==> Aplicando migraciones pendientes..."
npm run migration:run

echo "==> Levantando la aplicación..."
exec node dist/main
