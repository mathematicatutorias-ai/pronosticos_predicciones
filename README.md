# Forecast Local · v0.6.1

## Cambio matemático principal

v0.6.1 elimina TRAIN/VALID del análisis local. Chronos-2 y TimesFM-3 son modelos preentrenados: la aplicación solo les entrega contexto histórico y obtiene un pronóstico.

Para que ambos modelos sean comparables, la aplicación usa la misma geometría experimental:

- Contexto: hasta **128 puntos**
- Salida: hasta **64 puntos**
- Chronos-2 se limita deliberadamente a los últimos 128 puntos útiles aunque su tensor ONNX admita una ventana mayor.
- TimesFM-3 ya usa 128 puntos.

## Resolución temporal adaptativa

La aplicación ya no está atada a 6 horas.

1. Mantiene y grafica todo el histórico disponible.
2. Escoge una resolución entre:
   - 10 min, 15 min, 30 min
   - 1 h, 2 h, 3 h, 4 h, 6 h, 8 h, 12 h
   - máximo 1 día
3. Escoge la resolución más gruesa que todavía permita, cuando sea posible, formar:
   - 128 puntos de contexto
   - 64 puntos de prueba
4. Dentro de cada ventana usa la **mediana**.
5. El último bloque usa el último precio observado para representar el estado actual.
6. Los huecos se completan por arrastre del último precio para mantener una serie regular.

Para mercados jóvenes (<14 días), la app intenta descargar historia con `fidelity=10` minutos para aprovechar la mayor densidad disponible.

## Dos instancias separadas

### 1. Prueba retrospectiva

```text
datos anteriores | CONTEXTO 128 | PRUEBA hasta 64
   blanco             azul             rojo
```

- Si existen 128 + 64 puntos: prueba completa.
- Si existen más de 128 pero menos de 192: prueba parcial.
- Si no existen suficientes puntos para una prueba retrospectiva, el forecast final puede seguir ejecutándose.

Métricas:
- MAE
- RMSE
- cobertura empírica de q10–q90
- amplitud media q10–q90

q10–q90 se describe como **intervalo predictivo nominal del 80%**, no como intervalo de confianza.

### 2. Pronóstico real

```text
datos anteriores | CONTEXTO final hasta 128 | PRONÓSTICO hasta 64
   blanco                  azul                    amarillo
```

El contexto final usa la información más reciente disponible. El tramo de prueba retrospectiva no se excluye del forecast real.

## Horizonte

La interfaz ofrece:
- **7 días** cuando la resolución permite alcanzarlos.
- **16 días** cuando la resolución permite alcanzarlos.
- Si ni siquiera 7 días caben dentro de los 64 pasos, se muestran los 64 pasos completos y la UI indica el horizonte máximo disponible.

## Gráfico

- Serie completa visible.
- Eje Y parte siempre en 0%.
- Límite superior dinámico.
- Etiquetas porcentuales en el eje Y izquierdo **y derecho**.
- Selector:
  - `Pronóstico`
  - `Prueba`
- Fondo:
  - blanco = datos no usados por esa corrida
  - azul = contexto
  - rojo = prueba
  - amarillo = pronóstico

## Portada

La portada ya no está dominada por una sola categoría de gran volumen.

En `Destacados` se muestra **un evento por categoría**:
- Política
- Deportes
- Cripto
- Finanzas
- Geopolítica
- Tecnología
- Cultura
- Clima

Cada tarjeta corresponde al evento activo de mayor volumen 24 h recuperado para esa categoría.

Al entrar en una categoría sí se muestran varios eventos de ese tema, ordenados por volumen 24 h.

## Publicación

Reemplaza el contenido de la versión anterior en GitHub Pages.

Después del deploy:
1. `Ctrl+F5`
2. confirma `Local v0.6.1.1`
3. abre un mercado largo y uno joven
4. prueba `Analizar`
5. alterna `Pronóstico / Prueba`
6. comprueba las etiquetas Y a ambos lados
7. analiza dos outcomes y confirma que ambos forecasts continúan visibles
