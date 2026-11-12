#!/usr/bin/env bash
# Run on Linux with Docker Engine, Compose v2, Node.js 22+, tar and gzip.
set -Eeuo pipefail
cd "$(dirname "$0")/.."

version="${1:-sha-$(git rev-parse --short=12 HEAD)}"
if [[ ! "$version" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$ ]]; then
  echo 'Invalid release version' >&2
  exit 1
fi
image="convert:$version"
bundle="$PWD/release/convert-admin-$version"
if [[ -e "$bundle" || -e "$bundle.tar.gz" ]]; then
  echo 'This release already exists; choose a new version.' >&2
  exit 1
fi
docker info >/dev/null
docker compose version
node --version
docker build --platform linux/amd64 --pull -t "$image" .

test_dir="$(mktemp -d -t convert-smoke-XXXXXXXX)"
project="convert-smoke-$$"
cp deploy/docker-compose.yml "$test_dir/docker-compose.yml"
sed "s|^CONVERT_IMAGE=.*|CONVERT_IMAGE=$image|; s|^HTTP_PORT=.*|HTTP_PORT=0|" deploy/.env.example > "$test_dir/.env"
mkdir "$test_dir/data"
docker run --rm --user 0 --entrypoint chown -v "$test_dir/data:/data" "$image" 1000:1000 /data
compose=(docker compose --project-name "$project" --env-file "$test_dir/.env" -f "$test_dir/docker-compose.yml")
cleanup() {
  status=$?
  if [[ "$status" -ne 0 ]]; then "${compose[@]}" logs --no-color || true; fi
  "${compose[@]}" down --timeout 35 || true
  # Keep isolated test data in /tmp for diagnosis; never include it in the bundle.
  exit "$status"
}
trap cleanup EXIT
"${compose[@]}" config --quiet
"${compose[@]}" up -d --wait --wait-timeout 90
address="$("${compose[@]}" port convert 3000)"
SMOKE_RESULT_FILE="$test_dir/job-id" node scripts/smoke.mjs "http://$address"
"${compose[@]}" restart
"${compose[@]}" up -d --wait --wait-timeout 90
# Docker can allocate a different ephemeral host port after restarting.
address="$("${compose[@]}" port convert 3000)"
SMOKE_JOB_ID="$(cat "$test_dir/job-id")" node scripts/smoke.mjs "http://$address"

mkdir -p "$bundle"
cp deploy/docker-compose.yml "$bundle/docker-compose.yml"
sed "s|^CONVERT_IMAGE=.*|CONVERT_IMAGE=$image|" deploy/.env.example > "$bundle/.env.example"
cp DEPLOY.md "$bundle/DEPLOY.md"
docker image inspect --format '{{.Id}} {{.Os}}/{{.Architecture}}' "$image" > "$bundle/IMAGE.txt"
printf '%s\n' "$image" >> "$bundle/IMAGE.txt"
docker save "$image" | gzip > "$bundle/convert-image.tar.gz"
(
  cd "$bundle"
  sha256sum convert-image.tar.gz docker-compose.yml .env.example DEPLOY.md IMAGE.txt > SHA256SUMS
)
tar -czf "$bundle.tar.gz" -C "$bundle" .
printf '\nAdministrator bundle: %s.tar.gz\n' "$bundle"
