#!/bin/bash
# EcoMate SaaS — manual compose-stack deploy helper.
#
# The PRIMARY deploy path is CI → GHCR → Portainer webhook (see
# docs/portainer-deployment.md): dispatch `ci.yml` to build images, then
# `deploy-saas.yml` to trigger the Portainer stack webhook. Use THIS script
# only for a manual/local compose stack (a host running the stack directly
# from this repo, e.g. a dev VPS or a validation run) — it pulls the
# published images and (re)creates the stack. It never builds images and
# never touches git: image builds belong to CI.
#
# Usage: bash scripts/deploy.sh
#   Requires: .env in the repo root (copy .env.example and fill it in),
#   Docker + Compose on PATH.
set -e

echo "=== EcoMate SaaS Deployment (manual compose stack) ==="

# Check if .env exists
if [ ! -f .env ]; then
  echo "ERROR: .env file not found! Copy .env.example to .env and fill in values."
  exit 1
fi

# Pull published images (CI builds them; this script never builds) and
# (re)create the stack. Migrations run automatically in the platform-api
# and backend startup scripts (platform first, then tenant).
echo "Pulling images and deploying with Docker Compose..."
docker compose pull
docker compose up -d

# Wait for health checks (backend boot takes minutes: migrations + Nest
# bootstrap; the other services gate on it via depends_on).
echo "Waiting for services to become healthy (up to 10 minutes)..."
for i in $(seq 1 60); do
  if docker compose ps --format json | grep -q '"Health":"unhealthy"'; then
    echo "A service reported unhealthy — see 'docker compose ps' / 'docker compose logs'."
    exit 1
  fi
  # All services with a healthcheck report healthy (or have none: redis
  # and postgres report healthy quickly; media-static has no healthcheck).
  if ! docker compose ps --format json | grep -q '"Health":"starting"'; then
    break
  fi
  sleep 10
done

# Check health
echo "Checking health..."
BACKEND_PORT="${BACKEND_PORT:-4000}"
STOREFRONT_PORT="${STOREFRONT_PORT:-3000}"
curl -fsS "http://localhost:${BACKEND_PORT}/api/health" >/dev/null && echo "Backend: OK" || echo "Warning: Backend health check failed"
curl -fsS "http://localhost:${STOREFRONT_PORT}/api/health" >/dev/null && echo "Storefront: OK" || echo "Warning: Storefront health check failed"
docker compose exec -T platform-api wget -q --spider http://127.0.0.1:4100/api/health && echo "Platform API: OK" || echo "Warning: Platform API health check failed"
docker compose exec -T landing wget -q --spider http://127.0.0.1:3002/api/health && echo "Landing: OK" || echo "Warning: Landing health check failed"
docker compose exec -T caddy wget -q --spider http://127.0.0.1:2019/ && echo "Caddy: OK" || echo "Warning: Caddy health check failed"

echo "=== Deployment complete! ==="
echo "Public edge: http://localhost (redirects to https) — tenant hosts and"
echo "platform hosts resolve via DNS in production; use curl --resolve for"
echo "local checks (see docs/portainer-deployment.md §7)."
