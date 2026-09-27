# Forecast Local · Polymarket v0.1

Aplicación estática para GitHub Pages. GitHub entrega únicamente HTML/CSS/JS; las consultas, el almacenamiento y la inferencia ocurren en el navegador del usuario.

## Arquitectura

```text
GitHub Pages
   │
   └── código estático
          │
          ├── Gamma API -> búsqueda / eventos / metadata
          ├── CLOB API  -> históricos de precios
          ├── IndexedDB -> históricos + metadata locales (TTL 7 días)
          ├── Chronos-2 -> iframe aislado -> ORT WASM / CPU
          └── TimesFM-3 -> iframe aislado -> ORT WebGPU / GPU
```

Los dos runtimes ONNX están físicamente separados porque esa fue la configuración probada:
- Chronos-2: `ort.min.js` + WASM estándar.
- TimesFM-3: `ort.webgpu.min.js` + WebGPU.

## Funciones del MVP

- Buscador global usando Gamma.
- Eventos y mercados.
- Fotos/iconos desde metadata Gamma cuando existan.
- Histórico CLOB.
- Regularización a 6 horas en navegador.
- IndexedDB con actualización incremental del histórico.
- TTL de 7 días para datos históricos.
- Plotly con múltiples outcomes/mercados.
- Selección de mercado.
- Forecast futuro 20% del histórico, máximo 64 pasos.
- Chronos-2 local.
- TimesFM-3 local.
- Comparación temporal 70/15/15 sobre TEST (MAE/RMSE).
- Cache Storage opcional para los archivos ONNX.
- Botones para borrar datos, modelos o todo.

## Publicar

Descomprime el ZIP en la raíz del repositorio y activa:

```text
Settings -> Pages -> Deploy from a branch -> main -> /(root)
```

No requiere build.

## Importante: primera prueba

Primero prueba:
1. búsqueda de un mercado;
2. abrir un evento;
3. verificar que aparece el histórico;
4. luego probar Chronos;
5. luego TimesFM.

La última compatibilidad que falta validar es CORS de Gamma/CLOB desde tu dominio de GitHub Pages. El código muestra el error directamente si algún endpoint lo bloquea.

## Almacenamiento

### Datos Polymarket
IndexedDB:
- search
- events
- history

El histórico se conserva 7 días y luego se purga si ya no se utiliza.

### Modelos
Cuando "Conservar modelos descargados" está activo, los workers intentan guardar:
- Chronos ONNX
- TimesFM ONNX + external data

en `Cache Storage` (`forecast-local-models-v1`).

Si el almacenamiento de un modelo grande falla por cuota, el runtime cae a la ruta URL normal y sigue intentando la inferencia.

## Nota metodológica

Los modelos pronostican la trayectoria del precio/probabilidad implícita del mercado. No son una predicción independiente de la resolución del evento.

La comparación de modelos usa error fuera de muestra del tramo TEST; no es una evaluación de candidatos u opciones políticas.
