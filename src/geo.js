// Misma geometría que lib/geo.js del servidor: las distancias se miden igual,
// así que "s" (metros recorridos sobre la ruta) significa lo mismo en ambos lados.

const R_EARTH = 6371000;
const rad = (d) => (d * Math.PI) / 180;

export function haversine(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(s));
}

export function bearing(a, b) {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x =
    Math.cos(rad(a[0])) * Math.sin(rad(b[0])) -
    Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Agrega `cum` (metros acumulados) y `L` (largo total) a una ruta del API. */
export function prepareRoute(r) {
  const cum = [0];
  for (let i = 1; i < r.geometry.length; i++) cum.push(cum[i - 1] + haversine(r.geometry[i - 1], r.geometry[i]));
  return { ...r, cum, L: cum[cum.length - 1] };
}

export const wrap = (s, L) => ((s % L) + L) % L;

/** Punto [lat, lng] a `s` metros del inicio de la ruta (circular). */
export function pointAt(route, s) {
  const { cum, geometry, L } = route;
  s = wrap(s, L);
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = cum[hi] - cum[lo] || 1;
  const t = (s - cum[lo]) / seg;
  const a = geometry[lo];
  const b = geometry[hi];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Rumbo mirando 15 m adelante. */
export function headingAt(route, s) {
  return bearing(pointAt(route, s), pointAt(route, s + 15));
}

/** Tramo de la ruta entre dos distancias (de s0 hacia adelante hasta s1). */
export function subPath(route, s0, s1) {
  const { geometry, cum, L } = route;
  const a = wrap(s0, L);
  let b = wrap(s1, L);
  if (b < a) b += L;
  const pts = [pointAt(route, a)];
  for (let lap = 0; lap < 2; lap++) {
    for (let i = 1; i < geometry.length - 1; i++) {
      const c = cum[i] + lap * L;
      if (c > a && c < b) pts.push(geometry[i]);
    }
  }
  pts.push(pointAt(route, b));
  return pts;
}

/** Metros entre una posición y una parada, yendo hacia adelante. */
export const distAhead = (fromS, toS, L) => wrap(toS - fromS, L);
