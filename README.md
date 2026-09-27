# Forecast Local · Polymarket v0.4

Aplicación estática para GitHub Pages. GitHub entrega únicamente HTML/CSS/JS; la consulta de Polymarket, IndexedDB, Cache Storage y la inferencia ONNX ocurren en el navegador del usuario.

## Cambios principales de v0.4

- **Análisis por outcome/token**: analizar Lula ya no elimina el pronóstico de Flávio, ni viceversa.
- El botón de cada fila tiene estados:
  - `Analizar`
  - `Analizando…`
  - `Ocultar`
  - `Mostrar`
  - `Actualizar` cuando existen datos posteriores al análisis guardado.
- Los análisis se guardan en **IndexedDB** y se recuperan al volver al evento.
- `selected` y `visible` son estados separados: seleccionar un outcome para inspeccionarlo no borra ni oculta los demás.
- **Horizonte seleccionable**: 3, 7 o 14 días; 7 días por defecto. Los modelos generan hasta 64 pasos y el selector solo muestra el tramo correspondiente.
- **Esquema temporal principal** para series con al menos 28 días (112 puntos de 6 h):
  - TRAIN: todo lo anterior
  - VALID: 7 días (28 pasos)
  - TEST: 7 días (28 pasos)
  - FORECAST: 3/7/14 días según selector
- **Fallback para series jóvenes**: 70% / 15% / 15%.
- Para cada outcome, cada modelo se carga **una sola vez** durante el análisis y ejecuta en la misma sesión los contextos VALID, TEST y FORECAST.
- Chronos-2 y TimesFM-3 siguen físicamente aislados en iframes/runtimes distintos.
- Eje Y en **porcentaje**, sin título.
- Eje X Plotly adaptable al nivel de zoom, con fecha y año en líneas separadas cuando corresponde.
- Zonas visuales pastel para ENTRENAMIENTO, VALIDACIÓN, PRUEBA y PRONÓSTICO.
- Los modelos se distinguen por **tipo de línea**, no por color:
  - observado: sólido
  - Chronos-2: guiones
  - TimesFM-3: puntos
- El **color identifica al outcome/mercado**, por lo que una misma serie conserva su color en observado y en ambos modelos.
- El panel derecho usa iconos monocromos y neutrales para los modelos, evitando asociar colores de candidato con modelos.
- `Comparar modelos` muestra MAE, RMSE y dirección sobre el tramo TEST.

## Almacenamiento

IndexedDB `forecast-local-polymarket`, versión 2:

- `search`
- `events`
- `history`
- `analysis`

Los históricos conservan TTL de 7 días. Los análisis son pequeños y permanecen hasta `Borrar datos y análisis` o `Borrar todo`.

Cache Storage:

- `forecast-local-models-v1`

Se usa para los ONNX cuando `Conservar modelos descargados` está activo.

## Publicación

Descomprime el ZIP en la raíz del repositorio de GitHub Pages y reemplaza la versión anterior. No requiere build.

Después del deploy verifica que arriba aparezca **Local v0.4** y haz `Ctrl+F5` una vez para evitar archivos antiguos del navegador.

## Flujo esperado

1. Buscar un evento.
2. Abrirlo.
3. Cargar históricos.
4. Pulsar `Analizar` en un outcome, por ejemplo Flávio.
5. Esperar Chronos y TimesFM.
6. Pulsar `Analizar` en otro outcome, por ejemplo Lula.
7. El gráfico conserva **ambos** pronósticos.
8. `Ocultar`/`Mostrar` cambia visibilidad sin volver a inferir.
9. Cambiar 3/7/14 días reutiliza el forecast ya calculado; no vuelve a cargar los modelos.

## Interpretación

Los modelos pronostican la trayectoria futura del precio/probabilidad implícita del mercado seleccionado. Las métricas comparan esa trayectoria con observaciones retenidas fuera del contexto del modelo; no son una evaluación de candidatos ni una predicción independiente de quién resolverá el evento.
