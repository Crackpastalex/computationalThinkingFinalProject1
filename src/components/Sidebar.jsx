import React, { useRef } from "react";
import { fmtDist, fmtEta, clockAt } from "../utils.js";

/** Placa de ruta, como en los letreros de parada. */
export function Plate({ route, size = "md" }) {
  return (
    <span className={`plate plate-${size}`} style={{ "--c": route.color }}>
      {route.id}
    </span>
  );
}

function Occupancy({ n, cap }) {
  const on = Math.round((n / cap) * 10);
  return (
    <span className="occ" title={`${n} de ${cap} pasajeros`}>
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={i < on ? "on" : ""} />
      ))}
    </span>
  );
}

function Eta({ sec, big }) {
  const f = fmtEta(sec);
  return (
    <span className={`eta ${big ? "eta-big" : ""} ${sec <= 20 ? "now" : ""}`}>
      <strong>{f.big}</strong>
      {f.unit && <small>{f.unit}</small>}
    </span>
  );
}

function Chips({ routes, counts, activeRoute, onChange }) {
  return (
    <div className="chips" role="group" aria-label="Filtrar por ruta">
      <button className={`chip ${!activeRoute ? "on" : ""}`} onClick={() => onChange(null)}>
        Todas
      </button>
      {routes.map((r) => (
        <button
          key={r.id}
          className={`chip ${activeRoute === r.id ? "on" : ""}`}
          style={{ "--c": r.color }}
          onClick={() => onChange(activeRoute === r.id ? null : r.id)}
          title={r.name}
        >
          <b>{r.id}</b>
          <span>{counts[r.id] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

function BackBar({ onBack, children }) {
  return (
    <div className="back">
      <button onClick={onBack} aria-label="Volver a la lista">‹</button>
      {children}
    </div>
  );
}

/** Tablero de llegadas: el corazón de la app. */
function StationPanel({ data, route, user, onBack, onBus, onLocate }) {
  const { station, rows } = data;
  const [first, ...rest] = rows;
  return (
    <section className="detail">
      <BackBar onBack={onBack}>
        <div className="titles">
          <h2>{station.name}</h2>
          <p>
            <Plate route={route} size="sm" /> {route.name}
          </p>
        </div>
      </BackBar>

      <div className="board" role="status" aria-live="polite">
        {first ? (
          <button className="board-row first" onClick={() => onBus(first.bus.id)}>
            <Plate route={route} />
            <span className="who">
              <b>Camión {first.bus.id}</b>
              <small>
                a {fmtDist(first.dist)} · {clockAt(first.eta * 1000)}
              </small>
            </span>
            <Eta sec={first.eta} big />
          </button>
        ) : (
          <div className="board-empty">Sin camiones en esta ruta ahora</div>
        )}
        {rest.slice(0, 2).map((r) => (
          <button key={r.bus.id} className="board-row" onClick={() => onBus(r.bus.id)}>
            <Plate route={route} size="sm" />
            <span className="who">
              <b>{r.bus.id}</b>
              <small>a {fmtDist(r.dist)}</small>
            </span>
            <Eta sec={r.eta} />
          </button>
        ))}
      </div>

      {rest.length > 2 && (
        <ul className="plain">
          {rest.slice(2).map((r) => (
            <li key={r.bus.id}>
              <button onClick={() => onBus(r.bus.id)}>
                <span className="grow">
                  <b>{r.bus.id}</b> <small>a {fmtDist(r.dist)}</small>
                </span>
                <Eta sec={r.eta} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {first && (
        <p className="hint">
          El tramo amarillo del mapa es lo que le falta al {first.bus.id} para llegar. Toca un camión para ver sus próximas paradas.
        </p>
      )}
      {!user && (
        <button className="ghost" onClick={onLocate}>
          Ver paradas cerca de mí
        </button>
      )}
    </section>
  );
}

function BusPanel({ data, route, onBack, onStation }) {
  const { bus, stops } = data;
  return (
    <section className="detail">
      <BackBar onBack={onBack}>
        <div className="titles">
          <h2>Camión {bus.id}</h2>
          <p>
            <Plate route={route} size="sm" /> {route.name}
          </p>
        </div>
      </BackBar>

      <dl className="facts">
        <div>
          <dt>Velocidad</dt>
          <dd>{bus.speedKmh} km/h</dd>
        </div>
        <div>
          <dt>Pasajeros</dt>
          <dd>
            {bus.occupancy}/{bus.capacity} <Occupancy n={bus.occupancy} cap={bus.capacity} />
          </dd>
        </div>
      </dl>

      <h3 className="sub">Próximas paradas</h3>
      <ol className="stops" style={{ "--c": route.color }}>
        {stops.map((st, i) => (
          <li key={st.station.id} className={i === 0 ? "next" : ""}>
            <button onClick={() => onStation(st.station.id)}>
              <span className="node" />
              <span className="grow">
                <b>{st.station.name}</b>
                <small>{fmtDist(st.dist)}</small>
              </span>
              <Eta sec={st.eta} />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function StationList({ items, routeOf, user, onSelect }) {
  if (!items.length) {
    return <div className="empty">No hay paradas con ese nombre. Prueba con otra palabra o quita el filtro de ruta.</div>;
  }
  return (
    <ul className="list">
      {items.map((s) => {
        const r = routeOf(s.routeId);
        return (
          <li key={s.id}>
            <button onClick={() => onSelect(s.id)}>
              <Plate route={r} size="sm" />
              <span className="grow">
                <b>{s.name}</b>
                <small>{user && s.d != null ? `a ${fmtDist(s.d)} de ti` : r.name}</small>
              </span>
              {s.eta != null && <Eta sec={s.eta} />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const ORDER = ["peek", "half", "full"];

export default function Sidebar({
  routes, counts, activeRoute, query, user, live, sheet, sheetPx, mode, items, stationData, busData,
  onRoute, onQuery, onSheet, onBack, onStation, onBus, onLocate,
}) {
  const routeOf = (id) => routes.find((r) => r.id === id);
  const drag = useRef(null);

  const onDown = (e) => {
    drag.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onUp = (e) => {
    const dy = e.clientY - drag.current;
    const i = ORDER.indexOf(sheet);
    if (Math.abs(dy) < 8) onSheet(sheet === "peek" ? "half" : "peek");
    else onSheet(ORDER[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1)))]);
  };

  return (
    <aside className={`panel sheet-${sheet}`} style={{ "--sheet-h": `${sheetPx}px` }}>
      <button className="grab" aria-label="Subir o bajar el panel" onPointerDown={onDown} onPointerUp={onUp}>
        <i />
      </button>

      <header>
        <div className="brand">
          <h1>RegioBus</h1>
          <span className="where">Cumbres y Dominio Cumbres</span>
          <span className={`live ${live ? "" : "off"}`} role="status">
            <i />
            {live ? "En vivo" : "Sin conexión"}
          </span>
        </div>
        <Chips routes={routes} counts={counts} activeRoute={activeRoute} onChange={onRoute} />
        {mode === "list" && (
          <div className="search">
            <input
              type="search"
              placeholder="Buscar una parada"
              autoComplete="off"
              aria-label="Buscar una parada"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
            />
            <button onClick={onLocate} title="Paradas cerca de mí" aria-label="Paradas cerca de mí">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="3.2" />
                <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                <circle cx="12" cy="12" r="7.5" />
              </svg>
            </button>
          </div>
        )}
      </header>

      <div className="body">
        {mode === "station" && stationData && (
          <StationPanel data={stationData} route={routeOf(stationData.station.routeId)} user={user} onBack={onBack} onBus={onBus} onLocate={onLocate} />
        )}
        {mode === "bus" && busData && (
          <BusPanel data={busData} route={routeOf(busData.bus.routeId)} onBack={onBack} onStation={onStation} />
        )}
        {mode === "list" && <StationList items={items} routeOf={routeOf} user={user} onSelect={onStation} />}
      </div>

      <footer>API inventada · Mapa © OpenStreetMap · Paradas de OpenStreetMap</footer>
    </aside>
  );
}
