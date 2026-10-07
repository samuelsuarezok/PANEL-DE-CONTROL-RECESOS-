@echo off
REM Build script para Windows - Receso
echo 🔨 Iniciando build de Receso (Windows)...

REM Verificar que bun esté disponible
where bun >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Bun no encontrado en PATH. Instala Bun: https://bun.sh
    exit /b 1
)

REM Ejecutar build.ts
bun run build.ts

if %errorlevel% neq 0 (
    echo ❌ Build falló
    exit /b 1
)

echo.
echo ✅ Build completado. Ejecutables en dist\
echo    Copia la carpeta 'dist' completa a un pendrive para uso portable.