# Chronos-2 + TimesFM 3.0 · WebGPU POC v3

Esta versión añade fallback automático para Chronos.

## TimesFM

No cambia la ruta que ya dio PASS:

```text
TimesFM 3.0 ONNX
→ ONNX Runtime Web
→ WebGPU
→ Intel Graphics
```

## Chronos

La estrategia ahora es:

```text
1. WebGPU
   ↓ si un nodo queda sin proveedor
2. WebGPU + forceCpuNodeNames
   ↓ reintenta agregando nodos identificados por ORT
3. WASM / CPU local
```

El primer nodo ya observado se fuerza desde el inicio:

```text
/model/Cast_3
```

Si ORT reporta otro nodo con el mismo patrón de error, la página intenta
extraer su nombre automáticamente y vuelve a crear la sesión.

Si la sesión WebGPU/híbrida no puede crearse después de los reintentos,
la página carga el mismo `model.onnx` con:

```js
executionProviders: ["wasm"]
```

Todo sigue ejecutándose localmente en el navegador.

## Interpretación del resultado

### PASS + `webgpu`

Todo Chronos corrió por WebGPU.

### PASS + `webgpu-híbrido`

La sesión usa WebGPU y los nodos indicados se derivan a CPU.

### PASS + `wasm / cpu`

Este export de Chronos no funcionó con WebGPU en este navegador,
pero sí funciona completamente en CPU local.

### FAIL

Falló también el fallback CPU; copia el log completo.

## GitHub Pages

Reemplaza el contenido de tu repositorio actual por el contenido del ZIP:

```text
index.html
app.js
styles.css
data/
.nojekyll
README.md
```

y deja GitHub Pages apuntando a:

```text
main / (root)
```

No necesitas cambiar ninguna configuración de Pages.

## Orden recomendado

1. Recarga la página.
2. Ejecuta Chronos con 1 repetición.
3. Mira `Backend final`.
4. Si PASS, prueba con 3 repeticiones.
5. TimesFM se puede volver a probar para confirmar que sigue igual.

## Nota

`forceCpuNodeNames` es una opción oficial de WebGPU EP de ONNX Runtime Web.
El fallback WASM también es un execution provider oficial de ONNX Runtime Web.
