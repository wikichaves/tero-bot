#!/usr/bin/env bash
set -euo pipefail
docker exec -i tero-agency-tests psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$(dirname "$0")/agency_isolation.sql"
set +e
docker exec -i tero-agency-tests psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$(dirname "$0")/concurrent-a.sql" >/tmp/tero-a.out 2>&1 &
a=$!
docker exec -i tero-agency-tests psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$(dirname "$0")/concurrent-b.sql" >/tmp/tero-b.out 2>&1
b=$?
wait "$a"; a=$?
set -e
test "$a" -eq 0
test "$b" -ne 0
grep -q "overlap" /tmp/tero-b.out
echo "concurrency: one committed, one failed with overlap (23P01)"
