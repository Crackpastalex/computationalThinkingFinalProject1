const assert = require("assert");
const g = require("../lib/geo");

// 1) pico corto (calle sin salida) se elimina
const line = [[25.7, -100.4], [25.7, -100.399], [25.7, -100.398]];
const spur = [[25.7005, -100.399], [25.7010, -100.399]];
const withSpur = [line[0], line[1], spur[0], spur[1], spur[0], line[1], line[2]];
assert.deepStrictEqual(g.removeSpurs(withSpur), line, "debe quitar el pico corto");

// 2) ida y vuelta larga (> 400 m) se conserva
const far = [[25.7, -100.4], [25.7, -100.39], [25.7, -100.38], [25.7, -100.39], [25.7, -100.4]];
assert.deepStrictEqual(g.removeSpurs(far), far, "debe conservar la ida y vuelta larga");

// 3) la posición de un camión siempre cae SOBRE la línea
const route = [[25.7, -100.4], [25.701, -100.398], [25.703, -100.397], [25.706, -100.399], [25.7, -100.4]];
const cum = g.buildCum(route);
const L = cum[cum.length - 1];
function distToPolyline(p) {
  let best = Infinity;
  for (let i = 0; i < route.length - 1; i++) {
    for (let t = 0; t <= 1; t += 0.001) {
      const q = [route[i][0] + (route[i + 1][0] - route[i][0]) * t, route[i][1] + (route[i + 1][1] - route[i][1]) * t];
      best = Math.min(best, g.haversine([p.lat, p.lng], q));
    }
  }
  return best;
}
let worst = 0;
for (let s = 0; s < L * 1.5; s += L / 97) worst = Math.max(worst, distToPolyline(g.pointAt(route, cum, s)));
assert(worst < 0.5, "el camión se salió de la línea: " + worst + " m");

// 4) envolver: s y s+L dan el mismo punto
const a = g.pointAt(route, cum, 123), b = g.pointAt(route, cum, 123 + L);
assert(Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lng - b.lng) < 1e-9);

console.log("geo OK · desviación máxima de un camión a la línea:", worst.toFixed(3), "m");
