# 🚌 RegioBus Cumbres

Rastreador de camiones en Cumbres, Monterrey. Muestra los camiones moviéndose en el mapa y **cuánto falta para que lleguen a cada parada**.

- **API inventada** (`/api/v1/*`): camiones simulados que recorren rutas reales.
- **Mapa**: Leaflet + OpenStreetMap/CARTO (gratis, sin API key). No necesitas Mapbox.
- **Paradas reales**: se descargan de OpenStreetMap con la API Overpass (gratis, sin key).
- **Rutas sobre calles reales**: OSRM público (gratis, sin key). Si falla, usa líneas rectas.

## Stack

React 18 + Vite + react-leaflet (frontend) · Express (API + sirve el build de `dist/`).

## Correr local

```bash
npm install
npm run build && npm start     # todo junto en http://localhost:3000
```

Modo desarrollo (con recarga en caliente), en dos terminales:

```bash
npm run dev:server   # API en :3000
npm run dev          # Vite en http://localhost:5173 (proxy a /api)
```

## Desplegar en Render

1. Sube esta carpeta a un repo de GitHub.
2. En Render: **New → Blueprint** (detecta `render.yaml`) o **New → Web Service** con
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
3. Listo. En el plan gratis el servidor se duerme tras 15 min sin visitas y tarda ~30 s en despertar.

## Endpoints

| Método | Ruta | Qué devuelve |
|---|---|---|
| GET | `/api/v1/health` | Estado del servidor |
| GET | `/api/v1/meta` | Zona cubierta y de dónde salió la ubicación de Dominio Cumbres |
| GET | `/api/v1/routes` | Rutas con color y geometría completa |
| GET | `/api/v1/stations?routeId=R1` | Paradas (`s` = metros desde el inicio de la ruta) |
| GET | `/api/v1/buses?routeId=R1` | Posición, rumbo, velocidad, ocupación, `s` y `v` (m/s) |
| GET | `/api/v1/stations/:id/arrivals` | Camiones ordenados por tiempo de llegada (`etaSeconds`, `distanceM`) |

## Personalizar

- Rutas, colores, número de camiones y velocidad: arreglo `ROUTES` en `server.js`.
- Zona de paradas: `BBOX` en `server.js`.
- Los waypoints son aproximados; si un trayecto no va por donde quieres, mueve las coordenadas.

## Dominio Cumbres

La ruta **R4** va de Dominio Cumbres a Plaza Cumbres. Al arrancar, el servidor busca "Dominio Cumbres" en OpenStreetMap.
Abre `/api/v1/meta`: si `source` dice `openstreetmap` o `manual`, el punto es bueno; si dice `aproximada`, es un punto de respaldo.

Para fijarlo tú, en Render ve a **Environment** y agrega `DOMINIO_LAT` y `DOMINIO_LNG`
(en Google Maps, clic derecho sobre el lugar y copia las coordenadas).

## Por qué los camiones no se salen de la línea

El servidor manda a cada camión `s` (metros recorridos sobre la ruta) y `v` (m/s). El navegador calcula la posición
sobre la misma geometría que dibuja, cuadro por cuadro, en vez de mover el marcador en línea recta entre dos puntos.
Además, el servidor quita los "picos" que OSRM mete cuando una parada queda en una calle sin salida.

```bash
node test/geo.test.js   # prueba la geometría
```
