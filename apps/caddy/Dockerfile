# Edge image for the SaaS stack. The Caddyfile is BAKED IN — never bind-mount
# repo files into this stack (a bind mount broke a Portainer git-stack deploy
# on 2026-11-03; see the media-static comment in docker-compose.yml).
# Single source of truth for the edge config is portainer/Caddyfile.
FROM caddy:2-alpine
COPY portainer/Caddyfile /etc/caddy/Caddyfile
EXPOSE 80 443
# The admin API (localhost:2019) is used by the compose healthcheck; it is
# NOT published — never expose it outside the container.
