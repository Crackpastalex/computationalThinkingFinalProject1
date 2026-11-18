import React, { useEffect, useRef } from "react";
import {
  MapContainer, TileLayer, Polyline, CircleMarker, Marker, Tooltip, ZoomControl, useMap, useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import { pointAt, headingAt, wrap } from "../geo.js";

const TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const PANEL_W = 392; // ancho del panel en escritorio (px)

const isMobile = () => window.innerWidth <= 760;

/** Encuadra todo al inicio y vuela a donde se le pida, dejando libre el panel. */
function Camera({ routes, fly, sheetPx }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current || !routes.length) return;
    fitted.current = true;
    const pts = routes.flatMap((r) => r.geometry);
    const mobile = isMobile();
    map.fitBounds(L.latLngBounds(pts), {
      paddingTopLeft: [mobile ? 20 : PANEL_W + 50, 40],
      paddingBottomRight: [20, mobile ? sheetPx + 20 : 40],
      animate: false,
    });
  }, [routes, map, sheetPx]);

  useEffect(() => {
    if (!fly) return;
    if (fly.bounds) {
      const mobile = isMobile();
      map.flyToBounds(L.latLngBounds(fly.bounds), {
        paddingTopLeft: [mobile ? 40 : PANEL_W + 50, 60],
        paddingBottomRight: [40, mobile ? sheetPx + 30 : 60],
        maxZoom: 16,
        duration: 0.7,
      });
      return;
    }
    const zoom = Math.max(map.getZoom(), fly.zoom ?? 16);
    const target = map.project([fly.lat, fly.lng], zoom);
    // corre el centro para que el punto quede en el medio del mapa VISIBLE
    const shift = isMobile() ? L.point(0, sheetPx / 2) : L.point(-(PANEL_W + 16) / 2, 0);
    map.flyTo(map.unproject(target.add(shift), zoom), zoom, { duration: 0.7 });
  }, [fly, map, sheetPx]);

  return null;
}

/** Zoom actual, para escalar las paradas. */
function useZoom() {
  const map = useMap();
  const [zoom, setZoom] = React.useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  return zoom;
}

/**
 * Camiones. Cada cuadro se calcula la posición como "metros recorridos sobre la
 * ruta" y se convierte a punto de la MISMA línea que se dibuja: nunca se salen.
 */
function BusLayer({ routes, busesRef, sNow, selectedBusId, nextBusId, onSelectBus }) {
  const map = useMap();
  const live = useRef(new Map()); // id -> { marker, ds, heading, el }
  const sel = useRef({ selectedBusId, nextBusId });
  sel.current = { selectedBusId, nextBusId };
  const onSelect = useRef(onSelectBus);
  onSelect.current = onSelectBus;

  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    const routeById = Object.fromEntries(routes.map((r) => [r.id, r]));
    let raf;

    const frame = () => {
      const seen = new Set();
      for (const b of busesRef.current) {
        const route = routeById[b.routeId];
        if (!route) continue;
        seen.add(b.id);
        const target = sNow(b, route);
        let e = live.current.get(b.id);
        if (!e) {
          const icon = L.divIcon({
            className: "bus",
            html: `<i class="bus-arrow"></i><b class="bus-badge" style="--c:${route.color}">${route.id}</b>`,
            iconSize: [34, 34],
            iconAnchor: [17, 17],
          });
          const marker = L.marker(pointAt(route, target), { icon, zIndexOffset: 1000, keyboard: false }).addTo(group);
          marker.on("click", () => onSelect.current(b.id));
          marker.bindTooltip(b.id, { direction: "top", offset: [0, -16] });
          e = { marker, ds: target, heading: -1, el: marker.getElement() };
          live.current.set(b.id, e);
        }
        // avanza por la ruta; si el servidor corrige, se acerca sin saltar
        const d = wrap(target - e.ds + route.L / 2, route.L) - route.L / 2;
        e.ds = Math.abs(d) > 60 ? target : e.ds + d * 0.12;
        e.marker.setLatLng(pointAt(route, e.ds));

        const el = (e.el ||= e.marker.getElement());
        if (el) {
          const h = Math.round(headingAt(route, e.ds));
          if (h !== e.heading) {
            e.heading = h;
            el.firstChild.style.transform = `rotate(${h}deg)`;
          }
          el.classList.toggle("is-selected", sel.current.selectedBusId === b.id);
          el.classList.toggle("is-next", sel.current.nextBusId === b.id);
        }
      }
      for (const [id, e] of live.current) {
        if (!seen.has(id)) {
          group.removeLayer(e.marker);
          live.current.delete(id);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      group.remove();
      live.current.clear();
    };
  }, [map, routes, busesRef, sNow]);

  return null;
}

const pulseIcon = (color) =>
  L.divIcon({
    className: "pin",
    html: `<span class="pin-ring" style="--c:${color}"></span><span class="pin-dot" style="--c:${color}"></span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

const meIcon = L.divIcon({
  className: "me",
  html: '<span class="me-ring"></span><span class="me-dot"></span>',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
});

function Stops({ stations, routeColor, selectedRoute, selectedId, onSelect }) {
  const zoom = useZoom();
  const r = zoom <= 13 ? 3.5 : zoom <= 15 ? 5 : 6.5;
  return stations.map((s) => {
    const dim = selectedRoute && s.routeId !== selectedRoute;
    return (
      <CircleMarker
        key={s.id}
        center={[s.lat, s.lng]}
        radius={r}
        pathOptions={{
          color: routeColor(s.routeId),
          weight: zoom <= 13 ? 2 : 3,
          fillColor: "#fff",
          fillOpacity: 1,
          opacity: dim ? 0.35 : 1,
        }}
        eventHandlers={{ click: () => onSelect(s.id) }}
      >
        <Tooltip direction="top" offset={[0, -6]}>{s.name}</Tooltip>
      </CircleMarker>
    );
  });
}

export default function MapView({
  routes, stations, busesRef, sNow, activeRoute, selection, selectedStation, trail, user, fly, sheetPx,
  nextBusId, onSelectStation, onSelectBus,
}) {
  const color = (id) => routes.find((r) => r.id === id)?.color ?? "#555";
  const visibleRoutes = routes.filter((r) => !activeRoute || r.id === activeRoute);
  const visibleStations = stations.filter((s) => !activeRoute || s.routeId === activeRoute);
  const focusRoute = selection?.routeId ?? null;

  return (
    <MapContainer center={[25.74, -100.4]} zoom={13} zoomControl={false} preferCanvas className="map">
      <TileLayer url={TILES} attribution={ATTR} maxZoom={19} />
      <ZoomControl position="bottomright" />
      <Camera routes={routes} fly={fly} sheetPx={sheetPx} />

      {visibleRoutes.map((r) => {
        const dim = focusRoute && focusRoute !== r.id;
        return (
          <React.Fragment key={r.id}>
            <Polyline positions={r.geometry} pathOptions={{ color: "#fff", weight: 10, opacity: dim ? 0.3 : 0.95, lineJoin: "round" }} interactive={false} />
            <Polyline positions={r.geometry} pathOptions={{ color: r.color, weight: 5, opacity: dim ? 0.25 : 1, lineJoin: "round", lineCap: "round" }} interactive={false} />
          </React.Fragment>
        );
      })}

      {trail && trail.length > 1 && (
        <>
          <Polyline positions={trail} pathOptions={{ color: "#0b0f17", weight: 11, opacity: 0.9, lineCap: "round", lineJoin: "round" }} interactive={false} />
          <Polyline positions={trail} pathOptions={{ color: "#ffb000", weight: 6, opacity: 1, lineCap: "round", lineJoin: "round" }} interactive={false} />
        </>
      )}

      <Stops
        stations={visibleStations}
        routeColor={color}
        selectedRoute={focusRoute}
        selectedId={selectedStation?.id}
        onSelect={onSelectStation}
      />

      {selectedStation && (
        <Marker position={[selectedStation.lat, selectedStation.lng]} icon={pulseIcon(color(selectedStation.routeId))} interactive={false} zIndexOffset={500} />
      )}

      <BusLayer
        routes={visibleRoutes}
        busesRef={busesRef}
        sNow={sNow}
        selectedBusId={selection?.kind === "bus" ? selection.id : null}
        nextBusId={nextBusId}
        onSelectBus={onSelectBus}
      />

      {user && <Marker position={[user.lat, user.lng]} icon={meIcon} interactive={false} />}
    </MapContainer>
  );
}
