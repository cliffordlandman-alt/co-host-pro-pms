#!/usr/bin/env bash
# Run on the server after server-setup.sh. Loads the Mac data file into the server's Postgres (fresh database only),
# then restarts the app. The Mac copy is untouched. Usage: bash deploy/cloud/restore-mac-data.sh launchriot-data-XXXX.tgz
set -euo pipefail
cd "$(dirname "$0")/../.."
F=$(readlink -f "$1"); [ -f "$F.sha256" ] && (cd "$(dirname "$F")" && sha256sum -c "$(basename "$F").sha256")
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
tar xzf "$F" -C "$T"
C="sudo docker compose -f deploy/cloud/docker-compose.yml --env-file deploy/cloud/.env"
$C stop app
ID=$($C ps -q db); NET=$(sudo docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}' "$ID")
PW=$(grep '^POSTGRES_PASSWORD=' deploy/cloud/.env | cut -d= -f2)
sudo docker run --rm --network "$NET" --user 0 -v "$T/.local-data:/data" -e SOURCE_DIR=/data -e DATABASE_URL="postgres://launchriot:$PW@db:5432/launchriot" -e MIGRATIONS_DIR=/app/drizzle \
  -w /app/lib/db --entrypoint node launchriot-app pglite-to-postgres.mjs
$C start app
echo "Done. Open https://$(grep '^SITE_DOMAIN=' deploy/cloud/.env | cut -d= -f2) and sign in with your usual login."
