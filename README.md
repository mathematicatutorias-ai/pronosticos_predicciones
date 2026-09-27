# Forecast Local · Polymarket v0.3

## Corrección crítica respecto a v0.3

La v0.3 **sí abría y cargaba el evento**, pero la portada seguía visible porque
las reglas CSS:

```css
.landing { display:flex }
.workspace { display:grid }
```

podían prevalecer visualmente sobre el estado `hidden` usado por JavaScript.

v0.3 añade:

```css
[hidden] { display:none !important; }
```

y además cambia de vista mediante funciones explícitas `showLanding()` /
`showWorkspace()`.

Por eso, cuando el log superior dice `Abriendo mercado…`, la portada desaparece
de inmediato y aparece el workspace con gráfico + panel lateral mientras se
descargan los históricos.

# Forecast Local · Polymarket v0.3

Corrección de navegación del MVP.

## Qué cambió respecto a v0.1

- Un resultado de búsqueda abre el workspace **inmediatamente** con la metadata ya recibida por `public-search`.
- Si esa respuesta ya incluye mercados + token IDs, no se hace una segunda consulta bloqueante a Gamma.
- Si falta metadata, se intenta `/events/{id}`, `/events?id=...` y `/events?slug=...` en segundo plano.
- El histórico del mercado seleccionado se descarga primero y el gráfico aparece tan pronto como está listo.
- Las siguientes 3 series se descargan en paralelo, sin bloquear la interfaz.
- Estados de carga/error visibles tanto globalmente como sobre el gráfico.
- Se eliminó la falsa barra de búsqueda central; existe un único buscador real, arriba.
- Resultados accesibles por clic, Enter o espacio.

## Arquitectura

GitHub Pages solo entrega código. El navegador usa Gamma/CLOB, IndexedDB y los runtimes ONNX locales.

Chronos-2: ORT WASM/CPU aislado.
TimesFM-3: ORT WebGPU aislado.

## Publicar

Descomprime el ZIP en la raíz del repo y reemplaza los archivos de v0.1. No requiere build. Haz Ctrl+F5 una vez desplegada.

## Prueba mínima

1. Escribe `elec`.
2. Haz clic en `Brazil Presidential Election`.
3. Debe abrirse inmediatamente la pantalla del evento, aun antes de terminar de bajar históricos.
4. Debes ver mensajes `Cargando histórico...` sobre el gráfico.
5. Luego deben aparecer progresivamente las líneas.
