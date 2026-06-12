#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# Postgres backup loop. Runs inside the `backup` service container.
#
# Behaviour:
#   • pg_dump --format=custom (`.dump`) the database every
#     ${BACKUP_INTERVAL_SECONDS} seconds (default 21600 = 6h).
#   • Keep the last 14 days of files; prune anything older.
#   • Writes a sentinel file at /backups/.last_ok_at on every successful run
#     so the healthcheck can verify recency without parsing names.
#
# Env (read from compose):
#   PGHOST, PGUSER, PGPASSWORD, PGDATABASE — connection
#   BACKUP_INTERVAL_SECONDS                — loop interval (seconds)
#   BACKUP_RETENTION_DAYS                  — prune horizon (default 14)
#   BACKUP_DIR                             — output dir (default /backups)
# ─────────────────────────────────────────────────────────────────────────────
set -eu

: "${PGHOST:=postgres}"
: "${PGUSER:=freedink}"
: "${PGDATABASE:=freedink}"
: "${BACKUP_INTERVAL_SECONDS:=21600}"
: "${BACKUP_RETENTION_DAYS:=14}"
: "${BACKUP_DIR:=/backups}"

export PGHOST PGUSER PGDATABASE
# PGPASSWORD is consumed silently by libpq.
[ -n "${PGPASSWORD:-}" ] || echo "warn: PGPASSWORD not set; relying on .pgpass / trust auth" >&2

mkdir -p "$BACKUP_DIR"

run_once() {
	ts=$(date -u +%Y%m%dT%H%M%SZ)
	out="$BACKUP_DIR/freedink-${ts}.dump"
	tmp="${out}.partial"

	echo "[backup] starting dump → $out"
	if pg_dump --format=custom --no-owner --no-acl --file="$tmp" "$PGDATABASE"; then
		mv "$tmp" "$out"
		# Sentinel for healthcheck.
		date -u +%s > "$BACKUP_DIR/.last_ok_at"
		echo "[backup] ok: $(du -h "$out" | awk '{print $1}') $out"
	else
		rc=$?
		rm -f "$tmp"
		echo "[backup] FAILED (exit $rc)" >&2
		return "$rc"
	fi

	# Prune: anything older than BACKUP_RETENTION_DAYS days.
	# -mtime +N matches files modified more than N*24h ago.
	find "$BACKUP_DIR" -maxdepth 1 -type f -name 'freedink-*.dump' \
		-mtime "+${BACKUP_RETENTION_DAYS}" -print -delete 2>/dev/null || true
}

# If we're invoked with `--once`, run a single pass and exit (used by tests /
# manual runs). Default mode loops forever.
if [ "${1:-loop}" = "--once" ]; then
	run_once
	exit 0
fi

# Trap SIGTERM cleanly so the orchestrator can stop us between intervals.
stop=0
trap 'stop=1' TERM INT

while [ "$stop" -eq 0 ]; do
	if ! run_once; then
		# Don't tight-loop on persistent failure — sleep the configured interval
		# anyway so the supervisor sees the unhealthy state via the sentinel.
		:
	fi
	# Sleep in 5s slices so SIGTERM is reasonably responsive.
	slept=0
	while [ "$slept" -lt "$BACKUP_INTERVAL_SECONDS" ] && [ "$stop" -eq 0 ]; do
		sleep 5
		slept=$((slept + 5))
	done
done

echo "[backup] received shutdown signal, exiting"
