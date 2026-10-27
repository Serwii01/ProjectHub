@echo off
rem Doble clic para abrir el dashboard de ProjectHub en el navegador.
cd /d "%~dp0"
title ProjectHub
node dashboard.mjs --open
