# TrackSIM PRO

Sistema de telemetría y evaluación de conductores para simuladores Lander. Disponible como aplicación web y como aplicación de escritorio para Windows.

## Características

- Evaluación de conductores a partir de archivos CSV del simulador, con detección automática de fase según el catálogo de ejercicios.
- Panel de control con promedios, aptos / no aptos, faltas y faltas críticas.
- Gestión de grupos, ejercicios y catálogo.
- Sincronización con la base de datos Lander.
- Exportación de resúmenes ejecutivos (PDF) y expedientes (ZIP).
- Respaldo y restauración de datos.
- Autenticación con Firebase (Google).
- Actualizaciones automáticas en segundo plano desde GitHub Releases: la actualización se descarga y se instala al volver a abrir la app, o de inmediato si el usuario lo elige.
- Protocolo `tracksim://` para abrir la app de escritorio desde el navegador.

La referencia de velocidad y distancia para detectar conducción lenta se calcula por ejercicio y grupo. Las evaluaciones con una marca activa de exceso de velocidad se excluyen de ambos promedios; las marcas anuladas no provocan exclusión. Se requieren al menos dos evaluaciones válidas para crear la referencia. Las calificaciones de grupos ya cerrados permanecen congeladas.

## Stack

React 19, TypeScript, Vite, Tailwind CSS 4, React Router, Firebase, Electron y electron-builder.

## Requisitos

- Node.js 20 o superior
- npm

## Desarrollo

```bash
npm install
npm run dev            # versión web (Vite, puerto 5173)
npm run electron:dev   # aplicación de escritorio con recarga en vivo
```

## Calidad de código

```bash
npm run lint        # oxlint
npm test            # vitest (una sola ejecución)
npm run test:watch  # vitest en modo watch
```

Las pruebas viven junto al código como `src/**/*.test.ts` y cubren parseo y evaluación de CSV, configuración de ejercicios y catálogo, benchmarks y radar de telemetría, recomendaciones pedagógicas, persistencia de grupos y catálogo, respaldos, StreamDB y generación de PDF.

## Compilación

```bash
npm run build          # build web (tsc + vite)
npm run dist:dir       # empaqueta sin instalador (carpeta release/)
npm run dist           # genera el instalador NSIS en release/
```

El instalador se genera como `TrackSIM-PRO-Setup-<versión>.exe`.

## Publicar una versión

1. Actualiza `version` en `package.json`.
2. Crea y sube un tag, por ejemplo `v1.0.13`. El flujo de GitHub Actions (`.github/workflows/release.yml`) compila y publica el instalador en GitHub Releases.
3. También se puede publicar desde local con `npm run release` (requiere `GH_TOKEN`).

La app consulta los Releases del repositorio `jaet65/TrackSIM-ZERO` para detectar nuevas versiones.

## Estructura

```
electron/     Proceso principal y preload de Electron (ventana, actualizador)
src/
  components/ Componentes de interfaz (carga de CSV, modales, avisos de actualización)
  pages/      Vistas: Home, Groups, Exercises, Catalog, Driver
  lib/        Lógica: parseo de CSV, catálogo, PDF, respaldo, Firebase
public/       Recursos estáticos y service worker
```

## Notas

Por compatibilidad se conservan algunos identificadores con el nombre anterior (`ZERO`): el repositorio de GitHub, el proyecto Firebase `tracksim-zero` y el `appId`.
