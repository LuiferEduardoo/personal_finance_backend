#!/bin/sh
set -e

echo "==> Aplicando migraciones pendientes..."
npm run migration:run

echo "==> Levantando la aplicación..."
exec node dist/main
