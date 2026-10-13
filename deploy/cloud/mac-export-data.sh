#!/bin/zsh
# Run on the Mac. Makes ONE file with the live data to carry to the server yourself (nothing is uploaded).
# Stops LaunchRiot for about a minute so the copy is consistent, then starts it again.
set -e
APP=/Users/Clifford/YallaPMS-khaled
OUT=/Users/Clifford/YallaPMS-backups/launchriot-data-$(date +%Y%m%d-%H%M%S).tgz
cd "$APP"
./stop-khaled.sh || true
tar czf "$OUT" --exclude='session-secret' .local-data
./start-khaled.sh
chmod 600 "$OUT"
shasum -a 256 "$OUT" | tee "$OUT.sha256"
echo "Data file: $OUT  (contains guest and financial data: keep it private, delete copies once the server is checked)"
