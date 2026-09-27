# Chronos-2 + TimesFM 3.0 · WebGPU POC

Prueba mínima para responder:

> ¿Chronos-2 y TimesFM 3.0 pueden cargar y ejecutar inferencia localmente en un navegador Chromium usando WebGPU?

No hay backend de inferencia. Los modelos se descargan al navegador y el cálculo ocurre localmente.

## Qué prueba

### A. Chronos-2
- Modelo: `kashif/chronos-2-onnx`
- Runtime: Transformers.js
- Backend: WebGPU o WASM
- Forecast POC: 16 pasos
- Cuantiles: 0.1 / 0.5 / 0.9
- La sesión se libera al terminar.

### B. TimesFM 3.0
- Modelo: `YangjieOu/timesfm-3.0-onnx`
- Runtime: ONNX Runtime Web
- Backend: WebGPU o WASM
- Input del export: `target float32[batch,variates,128]`
- Salida esperada: `forecast_quantiles[batch,variates,64,quantiles]`
- El FP32 usa un archivo externo de pesos de ~1.3 GB.
- La sesión se libera al terminar.

## Publicar en GitHub Pages

1. Crea un repositorio, por ejemplo `polymarket-webgpu-poc`.
2. Descomprime **el contenido** del ZIP en la raíz. Debe quedar:
   ```text
   index.html
   app.js
   styles.css
   data/
   README.md
   .nojekyll
   ```
3. Commit/push a `main`.
4. GitHub → **Settings → Pages**.
5. **Build and deployment**:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/ (root)`
6. Guarda y abre la URL que GitHub te entregue, idealmente en Chrome o Edge reciente.

**No subas los modelos ONNX gigantes al repo.** La página los obtiene desde Hugging Face.

## Orden de prueba recomendado

1. Verifica `WebGPU = DISPONIBLE`.
2. Backend `WebGPU`.
3. Repeticiones `1` para la primera corrida.
4. Chronos dtype `FP32`.
5. Ejecuta **Chronos-2**.
6. Si da PASS, repite con 3 corridas.
7. Recarga la página antes de probar TimesFM para liberar memoria.
8. Ejecuta **TimesFM 3.0** con 1 corrida.

TimesFM FP32 es grande; cierra pestañas pesadas.

## Probar sin GitHub Pages

No abras `index.html` con doble clic. En la carpeta usa:

```bash
python -m http.server 8000
```

y abre:

```text
http://localhost:8000
```

## Si falla

Copia el contenido completo del recuadro negro del modelo. El POC conserva backend, URLs, inputs/outputs si la sesión alcanzó a crearse, error y stack.

Eso permite distinguir entre:
- WebGPU,
- operador ONNX no soportado,
- memoria,
- external data,
- CORS/descarga,
- forma o tipo de tensor.

## Fuentes/modelos

- Chronos-2 ONNX: https://huggingface.co/kashif/chronos-2-onnx
- TimesFM 3.0 ONNX: https://huggingface.co/YangjieOu/timesfm-3.0-onnx
- ONNX Runtime Web WebGPU: https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html

## Nota de licencia

Chronos-2 se publica bajo Apache-2.0. TimesFM 3.0 usa una licencia propia no comercial para sus pesos originales; revisar antes de cualquier uso comercial o de producción.

## Todavía NO hace

- conexión Polymarket,
- cache IndexedDB,
- comparación contra referencia Python,
- ejecución simultánea de ambos modelos.

Si ambos tests pasan, el siguiente paso es conectar nuestra serie de Polymarket 6h y comparar WebGPU vs Python sobre exactamente la misma entrada.
