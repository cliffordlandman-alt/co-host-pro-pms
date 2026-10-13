#!/usr/bin/env bash
# Nightly database backup on the server (keeps 14). Add to crontab:  15 3 * * * bash /home/ubuntu/launchriot/deploy/cloud/backup.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
D=$HOME/launchriot-backups; mkdir -p "$D"; chmod 700 "$D"
sudo docker compose -f deploy/cloud/docker-compose.yml --env-file deploy/cloud/.env exec -T db pg_dump -U launchriot -Fc launchriot > "$D/launchriot-$(date +%Y%m%d-%H%M).dump"
ls -1t "$D"/launchriot-*.dump | tail -n +15 | xargs -r rm -f
