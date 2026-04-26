#!/bin/sh
set -e
UPLOAD_DIR="/app/public/uploads"
mkdir -p "$UPLOAD_DIR"
chown -R 1001:1001 "$UPLOAD_DIR"
exec su-exec 1001:1001 "$@"
