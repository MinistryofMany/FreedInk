#!/usr/bin/env bash
# Stand up a local Signet (mTLS, dev certs) and run the Signet-mode VoteSigner
# integration suite against it. Proves the end-to-end vote path works through
# SignetVoteSigner: blind → Signet-sign → finalize → verify under the
# Signet-served public key, with the wire scheme unchanged.
#
# This is a DEV / proof harness, not part of the default test run. The default
# `npm test` leaves SIGNET_URL unset and exercises the local in-process signer;
# this script sets SIGNET_URL in the shell so the abstraction selects Signet AND
# the env-gated suite runs (it is describe.skip without SIGNET_URL).
#
# Requirements: the Signet repo checked out as a sibling, a Rust toolchain, and
# the FreedInk test DB reachable per .env.test (DATABASE_URL).
set -euo pipefail

FREEDINK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIGNET="${SIGNET_REPO:-$FREEDINK/../Signet}"
CERTS="$SIGNET/deploy/certs"
PORT="${SIGNET_TEST_PORT:-8443}"
DB="${SIGNET_TEST_DB:-/tmp/signet-freedink-test.db}"

if [ ! -d "$SIGNET" ]; then
	echo "Signet repo not found at $SIGNET (set SIGNET_REPO)" >&2
	exit 1
fi

echo "==> generating dev certs"
( cd "$SIGNET" && ./deploy/gen-dev-certs.sh >/dev/null )

echo "==> building Signet (release)"
( cd "$SIGNET" && cargo build --release --quiet )

echo "==> starting Signet on 127.0.0.1:$PORT"
rm -f "$DB"
SIGNET_KEK="$(head -c32 /dev/urandom | base64)" \
SIGNET_BIND="127.0.0.1:$PORT" \
SIGNET_DB="$DB" \
SIGNET_TLS_CERT="$CERTS/server.pem" \
SIGNET_TLS_KEY="$CERTS/server.key" \
SIGNET_CLIENT_CA="$CERTS/ca.pem" \
SIGNET_ALLOWED_CLIENT_IDS="freedink" \
SIGNET_KEY_BITS="2048" \
SIGNET_KEYGEN_MAX_CONCURRENT="4" \
SIGNET_RL_KEY_IDENTITY_MAX="200" \
SIGNET_RL_KEY_GLOBAL_MAX="500" \
SIGNET_RL_PARTICIPANT_MAX="50" \
RUST_LOG="info,signet=info" \
	"$SIGNET/target/release/signet" >/tmp/signet-freedink-test.log 2>&1 &
SIGNET_PID=$!
trap 'kill "$SIGNET_PID" 2>/dev/null || true' EXIT

echo "==> waiting for Signet /healthz"
for _ in $(seq 1 30); do
	if curl -fsS -o /dev/null \
		--cert "$CERTS/client.pem" --key "$CERTS/client.key" --cacert "$CERTS/ca.pem" \
		"https://127.0.0.1:$PORT/healthz" 2>/dev/null; then
		echo "    Signet is up"
		break
	fi
	sleep 1
done

echo "==> running the Signet-mode VoteSigner suite"
cd "$FREEDINK"
SIGNET_URL="https://127.0.0.1:$PORT" \
SIGNET_CLIENT_CERT="$CERTS/client.pem" \
SIGNET_CLIENT_KEY="$CERTS/client.key" \
SIGNET_CA_CERT="$CERTS/ca.pem" \
	npx vitest run --project integration tests/integration/signet-vote-signer.test.ts

echo "==> done"
