# AccesoPro — Docker (compat). Preferí scripts\start-server.ps1
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$profile = if ($args.Count -gt 0) { $args[0] } else { "core" }
& "$Root\scripts\start-server.ps1" -Profile $profile
