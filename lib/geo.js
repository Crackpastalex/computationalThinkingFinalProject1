// Geometría compartida por el servidor (CommonJS). El cliente tiene la misma
// lógica en src/geo.js: ambos miden distancias igual, así que "metros recorridos
// sobre la ruta" (s) significa lo mismo en los dos lados y los camiones nunca
// se salen de la línea.

const R_EARTH = 6371000;
const rad = (d) => (d * Math.PI) / 180;

function haversine(a, b) {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(s));
}

function bearing(a, b) {
  const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0]));
  const x =
    Math.cos(rad(a[0])) * Math.sin(rad(b[0])) -
    Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const round6 = (p) => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6];
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

function dedupe(pts) {
  const out = [];
  for (const p of pts) if (!out.length || !same(out[out.length - 1], p)) out.push(p);
  return out;
}

/**
 * Quita "picos": tramos cortos donde la ruta entra a una calle sin salida y
 * regresa por los mismos puntos (pasa cuando una parada queda en una calle
 * lateral). Los retornos largos (ida y vuelta real) se conservan.
 */
function removeSpurs(input, maxM = 400) {
  let p = input.slice();
  for (let guard = 0; guard < 400; guard++) {
    let found = false;
    for (let i = 1; i < p.length - 1 && !found; i++) {
      if (!same(p[i - 1], p[i + 1])) continue;
      let k = 1;
      while (i - k - 1 >= 0 && i + k + 1 < p.length && same(p[i - k - 1], p[i + k + 1])) k++;
      let len = 0;
      for (let j = i - k; j < i; j++) len += haversine(p[j], p[j + 1]);
      if (len <= maxM) {
        p.splice(i - k + 1, 2 * k); // deja solo el cruce p[i-k]
        found = true;
      }
    }
    if (!found) break;
  }
  return p;
}

function buildCum(geometry) {
  const cum = [0];
  for (let i = 1; i < geometry.length; i++) cum.push(cum[i - 1] + haversine(geometry[i - 1], geometry[i]));
  return cum;
}

function pointAt(geometry, cum, s) {
  const L = cum[cum.length - 1];
  s = ((s % L) + L) % L;
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
  return { lat: a[0] + (b[0] - a[0]) * t, lng: a[1] + (b[1] - a[1]) * t };
}

/** Posición y rumbo (mirando 15 m adelante, para que la flecha no tiemble). */
function locate(geometry, cum, s) {
  const p = pointAt(geometry, cum, s);
  const q = pointAt(geometry, cum, s + 15);
  return { ...p, heading: Math.round(bearing([p.lat, p.lng], [q.lat, q.lng])) };
}

module.exports = { haversine, bearing, round6, dedupe, removeSpurs, buildCum, pointAt, locate };
