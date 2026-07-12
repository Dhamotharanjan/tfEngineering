Set-Location 'D:\TFEngineering\mvp_demo'

"=== docker compose ps ===" | Set-Content 'compose_ps.txt'
docker compose ps | Add-Content 'compose_ps.txt'

"=== docker compose logs ===" | Set-Content 'compose_logs.txt'
docker compose logs --tail=200 mvp_api | Add-Content 'compose_logs.txt'

"done" | Set-Content 'compose_probe.txt'