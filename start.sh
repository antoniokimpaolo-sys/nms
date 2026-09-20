#!/usr/bin/env bash
set -euo pipefail

docker compose up -d --build
echo "Smart City NMS is starting at http://localhost:8080"
