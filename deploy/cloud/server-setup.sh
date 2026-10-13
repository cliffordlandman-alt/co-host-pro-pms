#!/usr/bin/env bash
# Run ONCE on a fresh Ubuntu 24.04 server (Oracle Always Free VM), as the default 'ubuntu' user, from the unpacked repo:
#   bash deploy/cloud/server-setup.sh
# Installs Docker, opens ports 80/443 in the VM firewall, writes deploy/cloud/.env (asks for the address),
# builds and starts Postgres + API + HTTPS. Outgoing guest/owner messages stay OFF.
set -euo pipefail
cd "$(dirname "$0")/../.."
if ! command -v docker >/dev/null; then curl -fsSL https://get.docker.com | sudo sh; sudo usermod -aG docker "$USER"; fi
# Oracle Ubuntu images ship iptables rules that block 80/443 even after the cloud firewall allows them.
sudo iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT
sudo iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT
sudo iptables -C INPUT -p udp --dport 443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -p udp --dport 443 -j ACCEPT
sudo apt-get install -y iptables-persistent >/dev/null 2>&1 || true; sudo netfilter-persistent save >/dev/null 2>&1 || true
ENV=deploy/cloud/.env
if [ ! -f "$ENV" ]; then
  IP=$(curl -fsS https://api.ipify.org || true)
  read -rp "Web address [${IP//./-}.sslip.io]: " DOM; DOM=${DOM:-${IP//./-}.sslip.io}
  umask 077; sed -e "s/^SITE_DOMAIN=.*/SITE_DOMAIN=$DOM/" -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 32)/" -e "s/^SESSION_SECRET=.*/SESSION_SECRET=$(openssl rand -hex 32)/" deploy/cloud/env.example > "$ENV"
fi
grep -q '^OUTBOUND_DELIVERY=off' "$ENV" || { echo "OUTBOUND_DELIVERY must be off in $ENV"; exit 1; }
sudo docker compose -f deploy/cloud/docker-compose.yml --env-file "$ENV" up -d --build
echo "Started. Next: restore the Mac data with  bash deploy/cloud/restore-mac-data.sh /path/to/launchriot-data-....tgz"
