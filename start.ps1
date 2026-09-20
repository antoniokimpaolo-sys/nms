$ErrorActionPreference = "Stop"

docker compose up -d --build
Write-Host "Smart City NMS is starting at http://localhost:8080" -ForegroundColor Green
