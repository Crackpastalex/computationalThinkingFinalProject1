// RegioBus Cumbres — API inventada de camiones + servidor web
// Rutas: calles reales (OSRM) · paradas reales (OpenStreetMap / Overpass) · camiones simulados.

const express = require("express");
const compression = require("compression");
const path = require("path");
const geo = require("./lib/geo");

const app = express();
const PORT = process.env.PORT || 3000;

/* ------------------------------------------------------------------ */
/* Dominio Cumbres (García, N.L.). Se busca su ubicación real en       */
/* OpenStreetMap al arrancar. Si no aparece, usa este punto aproximado */
/* (centro de los códigos postales 66035/66036). Para fijarlo a mano:  */
/* variables de entorno DOMINIO_LAT y DOMINIO_LNG en Render.           */
/* ------------------------------------------------------------------ */
const DOMINIO_FALLBACK = [25.7961, -100.4045];
const DOM = "DOMINIO"; // marcador que se reemplaza por la ubicación resuelta

/* Los waypoints son aproximados; OSRM los "pega" a la calle más cercana. */
const ROUTES = [
  {
    id: "R1",
    name: "Cumbres – Paseo de los Leones",
    color: "#e63946",
    buses: 4,
    speedKmh: 24,
    waypoints: [
      [25.7405, -100.4095],
      [25.7335, -100.3965],
      [25.7265, -100.3835],
      [25.7215, -100.3715],
      [25.7165, -100.36],
    ],
  },
  {
    id: "R2",
    name: "Lincoln – Cumbres Elite",
    color: "#1d6fe0",
    buses: 3,
    speedKmh: 26,
    waypoints: [
      [25.7125, -100.386],
      [25.7185, -100.399],
      [25.727, -100.41],
      [25.734, -100.418],
    ],
  },
  {
    id: "R3",
    name: "Anillo Cumbres Norte",
    color: "#12a150",
    buses: 3,
    speedKmh: 22,
    waypoints: [
      [25.748, -100.39],
      [25.742, -100.379],
      [25.733, -100.373],
      [25.73, -100.386],
      [25.737, -100.398],
    ],
  },
  {
    id: "R4",
    name: "Dominio Cumbres – Plaza Cumbres",
    color: "#8a3ffc",
    buses: 5,
    speedKmh: 28,
    waypoints: [DOM, [25.7405, -100.4095], [25.727, -100.41], [25.7125, -100.386]],
  },
];

const SNAP_MAX_M = 140; // una parada debe estar a <140 m de la ruta
const MIN_GAP_M = 280; // separación mínima entre paradas de una misma ruta
const PAD = 0.012; // margen (grados) alrededor de las rutas para buscar paradas

/* ---------------------------- red ---------------------------------- */
async function fetchJson(url, opts = {}, ms = 15000) {
  const res = await fetch(url, {
    ...opts,
    headers: { "User-Agent": "regiobus-cumbres/2.0 (proyecto escolar)", ...(opts.headers || {}) },
    signal: AbortSignal.timeout(ms),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} -> ${res.status}`);
  return res.json();
}

const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
async function overpass(query, ms = 30000) {
  let last;
  for (const url of OVERPASS) {
    try {
      return await fetchJson(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "data=" + encodeURIComponent(query),
        },
        ms
      );
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

/* ------------------------ Dominio Cumbres -------------------------- */
let dominio = { point: DOMINIO_FALLBACK, source: "aproximada" };

async function resolveDominio() {
  if (process.env.DOMINIO_LAT && process.env.DOMINIO_LNG) {
    dominio = { point: [Number(process.env.DOMINIO_LAT), Number(process.env.DOMINIO_LNG)], source: "manual" };
    return;
  }
  try {
    const q = `[out:json][timeout:20];(nwr["name"~"Dominio Cumbres",i](25.65,-100.55,25.95,-100.25););out center 20;`;
    const data = await overpass(q, 25000);
    const pts = data.elements
      .map((e) => (e.lat != null ? [e.lat, e.lon] : e.center ? [e.center.lat, e.center.lon] : null))
      .filter(Boolean);
    if (pts.length) {
      // mediana: evita que un comercio lejano con el mismo nombre mueva el punto
      const lat = pts.map((p) => p[0]).sort((a, b) => a - b)[Math.floor(pts.length / 2)];
      const lng = pts.map((p) => p[1]).sort((a, b) => a - b)[Math.floor(pts.length / 2)];
      dominio = { point: [lat, lng], source: "openstreetmap" };
    }
  } catch (e) {
    console.warn(`⚠ No pude ubicar Dominio Cumbres en OSM (${e.message}); uso punto aproximado`);
  }
  console.log(`✔ Dominio Cumbres: ${dominio.point.join(", ")} (${dominio.source})`);
}

/* ---------------------- geometría de rutas -------------------------- */
async function osrmGeometry(waypoints) {
  const pts = [...waypoints, waypoints[0]]; // circuito cerrado
  const coords = pts.map((p) => `${p[1]},${p[0]}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&continue_straight=false`;
  const data = await fetchJson(url, {}, 20000);
  if (!data.routes || !data.routes[0]) throw new Error("OSRM sin ruta");
  return data.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
}

function buildRoute(cfg, rawGeometry, source) {
  const geometry = geo.removeSpurs(geo.dedupe(rawGeometry.map(geo.round6)));
  const cum = geo.buildCum(geometry);
  return {
    ...cfg,
    geometry,
    cum,
    length: cum[cum.length - 1],
    geometrySource: source,
    speed: (cfg.speedKmh * 1000) / 3600, // m/s
  };
}

/* ------------------------------ paradas ---------------------------- */
async function overpassStops(bbox) {
  const q = `[out:json][timeout:25];node["highway"="bus_stop"](${bbox.join(",")});out;`;
  const data = await overpass(q);
  return data.elements.map((e) => ({
    osmId: e.id,
    lat: e.lat,
    lng: e.lon,
    name: (e.tags && (e.tags.name || e.tags.ref)) || null,
  }));
}

function snapStopsToRoutes(rawStops, routes) {
  const out = [];
  for (const route of routes) {
    const cands = [];
    for (const st of rawStops) {
      let best = Infinity;
      let bestIdx = 0;
      for (let i = 0; i < route.geometry.length; i++) {
        const d = geo.haversine([st.lat, st.lng], route.geometry[i]);
        if (d < best) {
          best = d;
          bestIdx = i;
        }
      }
      if (best <= SNAP_MAX_M) cands.push({ ...st, s: route.cum[bestIdx] });
    }
    cands.sort((a, b) => a.s - b.s);
    let lastS = -Infinity;
    for (const c of cands) {
      if (c.s - lastS < MIN_GAP_M) continue;
      lastS = c.s;
      out.push({ ...c, routeId: route.id, source: "openstreetmap" });
    }
  }
  return out;
}

function fallbackStops(route) {
  const n = Math.max(6, Math.round(route.length / 900));
  const stops = [];
  for (let i = 0; i < n; i++) {
    const s = (route.length / n) * i;
    const p = geo.pointAt(route.geometry, route.cum, s);
    stops.push({ osmId: null, lat: p.lat, lng: p.lng, name: null, s, routeId: route.id, source: "simulada" });
  }
  return stops;
}

/* ------------------------------ estado ----------------------------- */
let routes = [];
let stations = [];
let buses = [];
let bbox = null;
let ready = false;
const startedAt = Date.now();

async function init() {
  await resolveDominio();
  const dom = dominio.point;

  // 1) geometría de rutas
  routes = [];
  for (const cfg of ROUTES) {
    const wps = cfg.waypoints.map((w) => (w === DOM ? dom : w));
    const c = { ...cfg, waypoints: wps };
    try {
      const g = await osrmGeometry(wps);
      routes.push(buildRoute(c, g, "osrm"));
      console.log(`✔ ${cfg.id}: ${routes[routes.length - 1].geometry.length} puntos (OSRM)`);
    } catch (e) {
      console.warn(`⚠ ${cfg.id}: OSRM falló (${e.message}); uso línea recta`);
      routes.push(buildRoute(c, [...wps, wps[0]], "lineas"));
    }
  }

  // 2) zona de búsqueda de paradas = caja que envuelve todas las rutas
  const all = routes.flatMap((r) => r.geometry);
  const lats = all.map((p) => p[0]);
  const lngs = all.map((p) => p[1]);
  bbox = [
    +(Math.min(...lats) - PAD).toFixed(4),
    +(Math.min(...lngs) - PAD).toFixed(4),
    +(Math.max(...lats) + PAD).toFixed(4),
    +(Math.max(...lngs) + PAD).toFixed(4),
  ];

  // 3) paradas reales de OpenStreetMap
  let snapped = [];
  try {
    const raw = await overpassStops(bbox);
    console.log(`✔ Overpass: ${raw.length} paradas en la zona`);
    snapped = snapStopsToRoutes(raw, routes);
  } catch (e) {
    console.warn(`⚠ Overpass falló (${e.message}); uso paradas simuladas`);
  }

  // rutas con pocas paradas reales se completan con simuladas
  const merged = [];
  for (const r of routes) {
    const mine = snapped.filter((s) => s.routeId === r.id);
    merged.push(...(mine.length >= 5 ? mine : fallbackStops(r)));
  }
  const counters = {};
  stations = merged.map((s, i) => {
    counters[s.routeId] = (counters[s.routeId] || 0) + 1;
    return {
      id: `S${String(i + 1).padStart(3, "0")}`,
      name: s.name || `Parada ${s.routeId}-${String(counters[s.routeId]).padStart(2, "0")}`,
      lat: s.lat,
      lng: s.lng,
      routeId: s.routeId,
      s: Math.round(s.s * 10) / 10,
      source: s.source,
    };
  });

  // 4) camiones repartidos parejo a lo largo de cada ruta
  buses = [];
  for (const r of routes) {
    for (let i = 0; i < r.buses; i++) {
      buses.push({
        id: `${r.id}-${String(i + 1).padStart(2, "0")}`,
        routeId: r.id,
        offset: (r.length / r.buses) * i,
        speedFactor: 0.94 + ((i * 37) % 13) / 100, // 0.94 – 1.06
        capacity: 60,
        seed: i * 13 + r.id.charCodeAt(1),
      });
    }
  }
  ready = true;
  console.log(`Listo: ${routes.length} rutas, ${stations.length} paradas, ${buses.length} camiones`);
}

/* ---------------------------- simulación --------------------------- */
const routeOf = (id) => routes.find((r) => r.id === id);

function busState(b, now = Date.now()) {
  const r = routeOf(b.routeId);
  const v = r.speed * b.speedFactor; // m/s, constante: el cliente puede extrapolar
  const t = (now - startedAt) / 1000;
  const s = (b.offset + v * t) % r.length;
  const p = geo.locate(r.geometry, r.cum, s);
  const load = 0.25 + 0.5 * (0.5 + 0.5 * Math.sin(t / 90 + b.seed));
  return {
    id: b.id,
    routeId: b.routeId,
    lat: p.lat,
    lng: p.lng,
    heading: p.heading,
    s: Math.round(s * 10) / 10,
    v: Math.round(v * 1000) / 1000,
    speedKmh: Math.round(v * 3.6),
    occupancy: Math.round(load * b.capacity),
    capacity: b.capacity,
    serverTime: now,
  };
}

function arrivalsFor(station, now = Date.now()) {
  const r = routeOf(station.routeId);
  return buses
    .filter((b) => b.routeId === station.routeId)
    .map((b) => {
      const st = busState(b, now);
      const dist = (station.s - st.s + r.length) % r.length;
      return {
        busId: b.id,
        routeId: r.id,
        routeName: r.name,
        color: r.color,
        distanceM: Math.round(dist),
        etaSeconds: Math.round(dist / st.v),
        occupancy: st.occupancy,
        capacity: st.capacity,
      };
    })
    .sort((a, b) => a.etaSeconds - b.etaSeconds);
}

/* ------------------------------- API ------------------------------- */
app.use(compression());
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*"); // la API inventada es pública
  next();
});

const api = express.Router();

api.get("/health", (req, res) =>
  res.json({ ok: true, ready, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) })
);

api.use((req, res, next) =>
  ready ? next() : res.status(503).json({ error: "Iniciando, intenta en unos segundos" })
);

api.get("/meta", (req, res) =>
  res.json({
    bbox,
    dominioCumbres: { lat: dominio.point[0], lng: dominio.point[1], source: dominio.source },
    routes: routes.length,
    stations: stations.length,
    buses: buses.length,
  })
);

// Geometría completa: el cliente calcula la posición de los camiones sobre
// ESTA misma línea, por eso no se recorta ni se simplifica.
api.get("/routes", (req, res) =>
  res.json(
    routes.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      lengthM: Math.round(r.length * 10) / 10,
      buses: r.buses,
      geometrySource: r.geometrySource,
      geometry: r.geometry,
    }))
  )
);

api.get("/stations", (req, res) => {
  const { routeId } = req.query;
  res.json(stations.filter((s) => !routeId || s.routeId === routeId));
});

api.get("/buses", (req, res) => {
  const { routeId } = req.query;
  const now = Date.now();
  res.json(buses.filter((b) => !routeId || b.routeId === routeId).map((b) => busState(b, now)));
});

api.get("/stations/:id/arrivals", (req, res) => {
  const st = stations.find((s) => s.id === req.params.id);
  if (!st) return res.status(404).json({ error: "Parada no encontrada" });
  res.json({ station: st, arrivals: arrivalsFor(st), generatedAt: new Date().toISOString() });
});

app.use("/api/v1", api);
app.use(express.static(path.join(__dirname, "dist")));

app.listen(PORT, () => console.log(`RegioBus escuchando en :${PORT}`));
init().catch((e) => console.error("Fallo al iniciar:", e));
