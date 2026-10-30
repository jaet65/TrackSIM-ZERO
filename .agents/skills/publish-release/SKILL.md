---
name: publish-release
description: Crea y publica una nueva versión (Release) del ejecutable de TrackSIM ZERO en GitHub Releases, ya sea mediante Git Tags (GitHub Actions) o directamente desde la máquina local con electron-builder.
---

# Publicar Release de TrackSIM ZERO

Sigue estos pasos cuando el usuario pida publicar un nuevo Release en GitHub:

## Opción A: Publicación automática vía GitHub Actions (Recomendada, sin configurar tokens locales)
1. Verifica la versión actual en `package.json` (o actualízala con `npm version patch/minor/major --no-git-tag-version` si el usuario indicó una versión nueva).
2. Verifica que `.github/workflows/release.yml` y los cambios del proyecto estén confirmados en Git:
   ```powershell
   git add .
   git commit -m "chore: release vX.Y.Z"
   git push origin main
   ```
3. Crea y sube el tag de la versión (`vX.Y.Z` según `package.json`):
   ```powershell
   git tag v1.0.0
   git push origin v1.0.0
   ```
4. GitHub Actions compilará automáticamente el instalador en Windows (`TrackSIM ZERO Setup X.Y.Z.exe`) y lo publicará en `https://github.com/jaet65/TrackSIM-ZERO/releases`.

## Opción B: Publicación directa desde la PC local (Requiere `GH_TOKEN`)
Si el usuario desea subir el `.exe` compilado localmente desde su máquina sin pasar por GitHub Actions:
1. Verifica que exista la variable de entorno `$env:GH_TOKEN` (un Personal Access Token de GitHub con permisos `repo` / `contents:write`).
2. Ejecuta:
   ```powershell
   npm run release
   ```
   Esto ejecutará `electron-builder --publish always` y subirá `TrackSIM ZERO Setup X.Y.Z.exe`, `latest.yml` y el `.blockmap` directamente a GitHub Releases.

