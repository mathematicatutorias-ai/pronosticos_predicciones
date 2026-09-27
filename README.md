# Chronos-2 + TimesFM 3.0 · WebGPU POC v2

Esta versión corrige específicamente el fallo:

```text
Unsupported pipeline: time-series-forecasting
```

Ese error pertenecía a Transformers.js, no a Chronos ni a WebGPU.

## Cambio principal

**Transformers.js fue eliminado de Chronos.**

Ahora ambos modelos siguen la misma arquitectura:

```text
ONNX
  ↓
ONNX Runtime Web
  ↓
WebGPU
  ↓
GPU local
```

## Chronos-2

Se usa:

```text
TSFM-ai/chronos-2-onnx
model.onnx
FP32
~456 MB
```

Interfaz:

```text
context             float32[1,512]
group_ids           int64[1]
attention_mask      float32[1,512]
future_covariates   float32[1,64]
num_output_patches  int64 scalar

→ quantile_preds    float32[1,21,64]
```

Para una serie de 128 puntos:

- se coloca al final del contexto de 512;
- la izquierda queda como `NaN`;
- `attention_mask=0` en padding y `1` en datos reales;
- no usamos covariables: `future_covariates` se marca como faltante (`NaN`);
- `num_output_patches=4`, es decir 64 pasos.

Cuantiles mostrados:

- q10 = índice 2
- q50 = índice 10
- q90 = índice 18

## TimesFM 3.0

Se conserva exactamente la ruta que ya pasó en WebGPU:

```text
YangjieOu/timesfm-3.0-onnx
timesfm3-fp32-c128-h64.onnx
+ external .onnx.data
```

Entrada:

```text
float32[1,1,128]
```

Salida:

```text
float32[1,1,64,9]
```

## Publicar en GitHub Pages

Descomprime **el contenido** del ZIP en la raíz del repo:

```text
index.html
app.js
styles.css
data/
.nojekyll
README.md
```

Luego:

```text
GitHub
→ Settings
→ Pages
→ Deploy from a branch
→ main
→ /(root)
```

Abre la página con Chrome o Edge.

## Orden de prueba recomendado

Como TimesFM ya pasó, ahora interesa Chronos:

1. Backend: `WebGPU`.
2. Repeticiones: `1`.
3. Pulsa **Ejecutar Chronos-2**.
4. Si PASS, prueba con 3 repeticiones.
5. Después confirma que TimesFM sigue dando PASS.

## Si Chronos falla

Copia completo el recuadro negro.

En v2 el fallo ya no puede ser:

```text
Unsupported pipeline: time-series-forecasting
```

porque esa capa fue eliminada.

Un fallo nuevo ya nos dirá algo útil sobre:

- compatibilidad del grafo con WebGPU;
- soporte de `int64`;
- operadores ONNX;
- memoria;
- descarga/CORS;
- forma de tensores.

## Modelos

Chronos-2 tensor ONNX:

https://huggingface.co/TSFM-ai/chronos-2-onnx

TimesFM 3.0 ONNX:

https://huggingface.co/YangjieOu/timesfm-3.0-onnx

## Importante

Este es todavía un POC de compatibilidad/runtime.

No pretende todavía reproducir toda la capa de preprocesamiento de
`Chronos2Pipeline.predict`. Si el grafo corre en WebGPU, el siguiente paso es
hacer una prueba de paridad contra Python usando exactamente la misma serie.
