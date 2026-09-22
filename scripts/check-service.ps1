$sh = New-Object -ComObject WScript.Shell
$target = $sh.CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Sonarr.lnk")
Write-Host "Target:           $($target.TargetPath)"
Write-Host "Arguments:        $($target.Arguments)"
Write-Host "WorkingDirectory: $($target.WorkingDirectory)"

Write-Host "--- Servicios ---"
Get-Service Radarr, Prowlarr -ErrorAction SilentlyContinue | Select-Object Name, Status
