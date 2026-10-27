# Sets the platform admin password in the running Docker backend.
# Run from PowerShell:  powershell -ExecutionPolicy Bypass -File E:\HiringAi\fix-admin-password.ps1
$container = "hiringai_backend_prod"

docker cp "$PSScriptRoot\backend\scripts\set_admin_password.py" "${container}:/app/scripts/set_admin_password.py"
if ($LASTEXITCODE -ne 0) { Write-Host "Copy failed. Is the container running?"; exit 1 }

docker exec -it $container python scripts/set_admin_password.py
