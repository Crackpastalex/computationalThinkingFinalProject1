import React, { useCallback, useMemo, useState } from "react";
import MapView from "./components/MapView.jsx";
import Sidebar from "./components/Sidebar.jsx";
import { useBuses, useCatalog, useNow } from "./hooks.js";
import { distAhead, haversine, pointAt, subPath } from "./geo.js";

const sheetHeights = () => ({ peek: 176, half: Math.round(window.innerHeight * 0.5), full: Math.round(window.innerHeight * 0.88) });

export default function App() {
  const catalog = useCatalog();
  const { list: buses, ok, listRef, sNow } = useBuses();
  const now = useNow(400);

  const [activeRoute, setActiveRoute] = useState(null);
  const [selection, setSelection] = useState(null); // { kind: "station" | "bus", id, routeId }
  const [query, setQuery] = useState("");
  const [user, setUser] = useState(null);
  const [fly, setFly] = useState(null);
  const [sheet, setSheet] = useState("half");

  const routes = catalog?.routes ?? [];
  const stations = catalog?.stations ?? [];
  const routeOf = useCallback((id) => routes.find((r) => r.id === id), [routes]);

  /* ------- selección ------- */
  const selectStation = useCallback(
    (id) => {
      const st = stations.find((s) => s.id === id);
      if (!st) return;
      setSelection({ kind: "station", id, routeId: st.routeId });
      setSheet((s) => (s === "peek" ? "half" : s));

      // encuadra la parada y el camión que viene hacia ella
      const r = routeOf(st.routeId);
      const next = listRef.current
        .filter((b) => b.routeId === st.routeId)
        .map((b) => ({ b, dist: distAhead(sNow(b, r), st.s, r.L) }))
        .sort((a, b) => a.dist - b.dist)[0];
      const pts = [[st.lat, st.lng]];
      if (next) pts.push(pointAt(r, sNow(next.b, r)));
      setFly({ lat: st.lat, lng: st.lng, zoom: 16, bounds: pts.length > 1 ? pts : null, n: Date.now() });
    },
    [stations, routeOf, listRef, sNow]
  );

  const selectBus = useCallback(
    (id) => {
      const b = listRef.current.find((x) => x.id === id);
      const r = b && routeOf(b.routeId);
      if (!b) return;
      setSelection({ kind: "bus", id, routeId: b.routeId });
      setSheet((s) => (s === "peek" ? "half" : s));
      if (r) {
        const [lat, lng] = pointAt(r, sNow(b, r)); // dónde está el camión ahora
        setFly({ lat, lng, zoom: 15, n: Date.now() });
      }
    },
    [listRef, routeOf, sNow]
  );

  const back = useCallback(() => setSelection(null), []);

  const locate = useCallback(() => {
    if (!navigator.geolocation) return alert("Tu navegador no permite usar la ubicación.");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setUser(me);
        const near = stations
          .filter((s) => !activeRoute || s.routeId === activeRoute)
          .sort((a, b) => haversine([me.lat, me.lng], [a.lat, a.lng]) - haversine([me.lat, me.lng], [b.lat, b.lng]))[0];
        if (near) selectStation(near.id);
      },
      () => alert("No pude obtener tu ubicación. Revisa el permiso del navegador."),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, [stations, activeRoute, selectStation]);

  /* ------- datos que cambian cada instante ------- */
  const derived = useMemo(() => {
    if (!routes.length) return {};
    const t = now;

    // llegadas a una parada = camiones de su ruta ordenados por tiempo
    const arrivals = (st) => {
      const r = routeOf(st.routeId);
      return buses
        .filter((b) => b.routeId === st.routeId)
        .map((b) => {
          const s = sNow(b, r, t);
          const dist = distAhead(s, st.s, r.L);
          return { bus: b, s, dist, eta: dist / b.v };
        })
        .sort((a, b) => a.eta - b.eta);
    };

    // lista de paradas con su próximo camión
    const q = query.trim().toLowerCase();
    const items = stations
      .filter((s) => (!activeRoute || s.routeId === activeRoute) && (!q || s.name.toLowerCase().includes(q)))
      .map((s) => ({
        ...s,
        d: user ? haversine([user.lat, user.lng], [s.lat, s.lng]) : null,
        eta: arrivals(s)[0]?.eta ?? null,
      }))
      .sort((a, b) => (user ? a.d - b.d : a.name.localeCompare(b.name, "es", { numeric: true })));

    let stationData = null;
    let busData = null;
    let trail = null;
    let nextBusId = null;
    let selectedStation = null;

    if (selection?.kind === "station") {
      const station = stations.find((s) => s.id === selection.id);
      if (station) {
        selectedStation = station;
        const rows = arrivals(station);
        stationData = { station, rows };
        if (rows[0]) {
          nextBusId = rows[0].bus.id;
          trail = subPath(routeOf(station.routeId), rows[0].s, station.s);
        }
      }
    }

    if (selection?.kind === "bus") {
      const bus = buses.find((b) => b.id === selection.id);
      if (bus) {
        const r = routeOf(bus.routeId);
        const s = sNow(bus, r, t);
        const stops = stations
          .filter((x) => x.routeId === bus.routeId)
          .map((x) => {
            const dist = distAhead(s, x.s, r.L);
            return { station: x, dist, eta: dist / bus.v };
          })
          .sort((a, b) => a.dist - b.dist)
          .slice(0, 6);
        busData = { bus, stops };
        if (stops[0]) trail = subPath(r, s, stops[0].station.s);
      }
    }

    return { items, stationData, busData, trail, nextBusId, selectedStation };
  }, [now, routes, stations, buses, selection, activeRoute, query, user, routeOf, sNow]);

  const counts = useMemo(() => {
    const c = {};
    for (const b of buses) c[b.routeId] = (c[b.routeId] || 0) + 1;
    return c;
  }, [buses]);

  if (!catalog) {
    return (
      <div className="boot" role="status">
        <span className="plate plate-lg" style={{ "--c": "#ffb000", color: "#111" }}>RB</span>
        <h1>RegioBus</h1>
        <p>Despertando el servidor. El plan gratis de Render tarda unos 30 segundos.</p>
      </div>
    );
  }

  const heights = sheetHeights();
  const mode = derived.stationData ? "station" : derived.busData ? "bus" : "list";

  return (
    <>
      <MapView
        routes={routes}
        stations={stations}
        busesRef={listRef}
        sNow={sNow}
        activeRoute={activeRoute}
        selection={selection}
        selectedStation={derived.selectedStation}
        trail={derived.trail}
        nextBusId={derived.nextBusId}
        user={user}
        fly={fly}
        sheetPx={heights[sheet]}
        onSelectStation={selectStation}
        onSelectBus={selectBus}
      />
      <Sidebar
        routes={routes}
        counts={counts}
        activeRoute={activeRoute}
        query={query}
        user={user}
        live={ok}
        sheet={sheet}
        sheetPx={heights[sheet]}
        mode={mode}
        items={derived.items ?? []}
        stationData={derived.stationData}
        busData={derived.busData}
        onRoute={(id) => {
          setActiveRoute(id);
          if (selection && id && selection.routeId !== id) setSelection(null);
        }}
        onQuery={setQuery}
        onSheet={setSheet}
        onBack={back}
        onStation={selectStation}
        onBus={selectBus}
        onLocate={locate}
      />
    </>
  );
}
