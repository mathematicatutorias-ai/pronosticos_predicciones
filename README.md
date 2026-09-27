# POC v4 — Chronos CPU + TimesFM WebGPU

Decisión de esta versión:

- Chronos-2 → WASM / CPU local
- TimesFM-3 → WebGPU / Intel Graphics

El export `TSFM-ai/chronos-2-onnx` documenta ejecución funcional en navegador con ONNX Runtime Web WASM. Por eso esta versión deja de forzar WebGPU para Chronos.

## Verificación de versión

La página debe mostrar:

BUILD v4.0.0

y el botón:

Ejecutar Chronos-2 en CPU

Además `index.html` carga `app.js?v=4.0.0` para romper caché.

## Probar

1. Sube el contenido del ZIP a la raíz del repo.
2. Espera a que termine GitHub Pages.
3. Abre la página y confirma v4.0.0.
4. Repeticiones = 1.
5. Ejecuta Chronos.
6. Si PASS CPU, prueba 3 repeticiones.
7. TimesFM queda igual que en el POC que ya dio PASS.
