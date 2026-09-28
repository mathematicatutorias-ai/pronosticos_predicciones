# Forecast Local · Polymarket v0.5

Aplicación estática para GitHub Pages. GitHub sirve únicamente HTML/CSS/JS; búsqueda, almacenamiento, traducción compatible e inferencia ocurren en el navegador.

## Novedades v0.5

### Portada útil
- Feed de eventos activos.
- “Más activos en 24 h” por defecto.
- Temas: Política, Deportes, Cripto, Finanzas, Geopolítica, Tecnología, Cultura y Clima.
- Tarjetas con imagen, volumen 24 h, fecha de cierre, número de mercados y outcomes principales.
- Guardados y recientes locales.

### Búsqueda
- Usa `public-search` de Gamma.
- Si Chrome ofrece Translator API, una consulta en español puede traducirse localmente al inglés y buscar ambas formas.
- Resultados deduplicados y ordenados por relevancia + volumen 24 h.
- Títulos se traducen localmente al español cuando la Translator API está disponible.

### Mercado
- Título e imagen enlazan al evento original en Polymarket.
- Panel de mercado con:
  - probabilidad,
  - cambio 24 h,
  - volumen 24 h,
  - volumen total,
  - liquidez,
  - bid/ask,
  - spread,
  - estado y fecha final.
- Reglas/resolución cuando Gamma las devuelve.

### Gráfico
- Y siempre parte en 0%.
- Techo dinámico según las series y bandas visibles, con límite máximo 100%.
- Eje X adaptable con año en salto de línea según escala.
- Zonas de ENTRENAMIENTO / VALIDACIÓN / PRUEBA / PRONÓSTICO.
- VALID 7 días + TEST 7 días para series suficientemente largas.
- Fallback 70/15/15 para series jóvenes.
- Forecast 3 / 7 / 14 días.
- Múltiples outcomes analizados pueden permanecer visibles simultáneamente.

### Persistencia local
IndexedDB v3:
- search
- events
- history
- analysis
- translations
- bookmarks
- recent
- tags

Modelos ONNX:
- Cache Storage `forecast-local-models-v1`

### Avisos
La interfaz incluye un footer y modal con:
- herramienta independiente;
- fuente de datos: APIs públicas de Polymarket;
- no afiliación;
- modelos experimentales;
- no asesoría financiera;
- privacidad y almacenamiento local.

## Arquitectura

```text
GitHub Pages
  └── navegador
       ├── Gamma API → búsqueda, eventos, tags, metadata
       ├── CLOB API  → históricos
       ├── IndexedDB → históricos, análisis, traducciones, guardados
       ├── Cache Storage → ONNX
       ├── Chrome Translator API → traducción local opcional
       ├── Chronos-2 → ORT WASM / CPU
       └── TimesFM-3 → ORT WebGPU / GPU
```

## Publicación

Descomprime el ZIP en la raíz del repositorio y reemplaza la versión anterior. No requiere build.

Después del deploy usa `Ctrl+F5` y confirma que arriba aparece `Local v0.5`.

## Pruebas recomendadas

1. Abrir portada y confirmar que aparecen eventos.
2. Pulsar Política/Cripto/Deportes.
3. Buscar `venezuela` y luego `elecciones`.
4. Abrir un evento.
5. Comprobar que título/imagen abren Polymarket en otra pestaña.
6. Verificar eje Y dinámico.
7. Analizar dos outcomes del mismo evento y confirmar que ambos pronósticos permanecen visibles.
8. Guardar un evento, volver a portada y comprobar `Guardados y recientes`.
9. Revisar pestaña Local y botones de borrado.

## Fuente y condiciones

Polymarket publica documentación para desarrolladores y describe sus datos de descubrimiento como públicos. Forecast Local no usa marca ni login de Polymarket y se identifica como herramienta independiente.

Los datos y reglas oficiales siguen perteneciendo a sus fuentes originales y se enlaza a Polymarket para verificación.
