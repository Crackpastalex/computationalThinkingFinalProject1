import { useCallback, useEffect, useRef, useState } from "react";
import { get } from "./utils.js";
import { prepareRoute, wrap } from "./geo.js";

/** Fuerza un re-render cada `ms` (cuenta regresiva y tramo resaltado). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Rutas y paradas. Reintenta mientras Render "despierta". */
export function useCatalog() {
  const [catalog, setCatalog] = useState(null);
  useEffect(() => {
    let alive = true;
    let timer;
    const load = async () => {
      try {
        const [routes, stations] = await Promise.all([get("/routes"), get("/stations")]);
        if (alive) setCatalog({ routes: routes.map(prepareRoute), stations });
      } catch {
        timer = setTimeout(load, 3000);
      }
    };
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  return catalog;
}

/**
 * Camiones en vivo. El servidor manda, por camión, `s` (metros recorridos sobre
 * la ruta) y `v` (m/s). Con eso el cliente calcula dónde está AHORA sobre la
 * misma línea que dibuja en el mapa, sin saltos ni atajos por las esquinas.
 */
export function useBuses(ms = 4000) {
  const [state, setState] = useState({ list: [], ok: true });
  const listRef = useRef([]);
  const offsetRef = useRef(null); // servidor - cliente (ms), el menor retraso gana

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const list = await get("/buses");
        if (!alive) return;
        const off = list[0].serverTime - Date.now();
        offsetRef.current = offsetRef.current == null ? off : Math.max(offsetRef.current - 1, off); // deriva lenta
        listRef.current = list;
        setState({ list, ok: true });
      } catch {
        if (alive) setState((s) => ({ ...s, ok: false }));
      }
    };
    tick();
    const id = setInterval(tick, ms);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [ms]);

  /** Metros recorridos por un camión en este instante (extrapolado). */
  const sNow = useCallback((bus, route, t = Date.now()) => {
    const serverNow = t + (offsetRef.current ?? 0);
    return wrap(bus.s + (bus.v * (serverNow - bus.serverTime)) / 1000, route.L);
  }, []);

  return { ...state, listRef, sNow };
}
