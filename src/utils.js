export const API = "/api/v1";

export async function get(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export const fmtDist = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

/** Segundos -> { big, unit } para el tablero de llegadas. */
export function fmtEta(sec) {
  if (sec <= 20) return { big: "Ya", unit: "llegando" };
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m >= 60) return { big: `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`, unit: "" };
  return { big: `${m}:${String(s).padStart(2, "0")}`, unit: "min" };
}

/** Hora de llegada estimada, "3:42 p. m." */
export function clockAt(msFromNow) {
  return new Date(Date.now() + msFromNow).toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
}
