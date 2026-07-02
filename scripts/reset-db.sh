#!/usr/bin/env bash
# Wipes the local H2 database so the app starts with a clean slate.
#
# Close the app first; a running backend locks the DB file. The schema and seed
# data (shifts, default config) are recreated automatically on the next launch.
# This does NOT touch the remote PostgreSQL where already submitted payroll lives.
#
# Usage:  ./scripts/reset-db.sh
set -euo pipefail

# A running backend keeps the DB file open, so deleting it while the backend
# lives is futile (it rewrites the file on exit). Stop it first.
pkill -f 'backend\.jar' 2>/dev/null || true
sleep 1

data_dir="$HOME/.planilla/data"

for f in planilla-log.mv.db planilla-log.trace.db; do
  path="$data_dir/$f"
  if [ -f "$path" ]; then
    rm -f "$path"
    echo "Deleted $path"
  else
    echo "Not found (skipped): $path"
  fi
done

echo "Done. The database will be recreated on the next app launch."
