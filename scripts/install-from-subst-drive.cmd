@echo off
REM Prefer install-from-subst-drive.ps1 — this .cmd may break if its own path contains &.
REM Delegate to PowerShell so paths with R&D are handled correctly.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-from-subst-drive.ps1" %*
