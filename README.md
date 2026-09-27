# POC v5 — Chronos WASM aislado + TimesFM WebGPU aislado

Esta versión separa físicamente los runtimes:

- `chronos.html`: ONNX Runtime Web 1.30 estándar (`ort.min.js`) + WASM estándar.
- `chronos127.html`: misma prueba con ORT Web 1.27.
- `timesfm.html`: ORT Web 1.30 WebGPU (`ort.webgpu.min.js`).

Chronos fija explícitamente:
`ort-wasm-simd-threaded.mjs` y `ort-wasm-simd-threaded.wasm`.

No usa artefactos JSEP/WebGPU.

Orden:
1. `chronos.html`
2. si falla en Cast_3, `chronos127.html`
3. TimesFM solo para verificación.

La portada debe mostrar: `BUILD v5.0.0 · RUNTIMES AISLADOS`.
