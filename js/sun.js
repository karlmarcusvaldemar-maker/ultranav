// Soluppgång/solnedgång och civil skymning (NOAA:s algoritm, ±1 min). Beräknas lokalt.
const rad = Math.PI / 180;

function sunTimes(date, lat, lon, zenith) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 864e5);
  const res = {};
  for (const [key, rising] of [['rise', true], ['set', false]]) {
    const lngHour = lon / 15;
    const t = day + ((rising ? 6 : 18) - lngHour) / 24;
    const M = 0.9856 * t - 3.289;
    let L = M + 1.916 * Math.sin(M * rad) + 0.020 * Math.sin(2 * M * rad) + 282.634;
    L = (L + 360) % 360;
    let RA = Math.atan(0.91764 * Math.tan(L * rad)) / rad;
    RA = (RA + 360) % 360;
    RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90;
    RA /= 15;
    const sinDec = 0.39782 * Math.sin(L * rad), cosDec = Math.cos(Math.asin(sinDec));
    const cosH = (Math.cos(zenith * rad) - sinDec * Math.sin(lat * rad)) / (cosDec * Math.cos(lat * rad));
    if (cosH > 1) { res[key] = null; res.polar = 'night'; continue; }
    if (cosH < -1) { res[key] = null; res.polar = 'day'; continue; }
    let H = rising ? 360 - Math.acos(cosH) / rad : Math.acos(cosH) / rad;
    H /= 15;
    const T = H + RA - 0.06571 * t - 6.622;
    const UT = (((T - lngHour) % 24) + 24) % 24;
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    res[key] = new Date(d.getTime() + UT * 3600e3);
  }
  return res;
}

/** { sunrise, sunset, civilDawn, civilDusk, polar } för given dag (UTC) och plats */
export function sunInfo(date, lat, lon) {
  const s = sunTimes(date, lat, lon, 90.833), c = sunTimes(date, lat, lon, 96);
  return { sunrise: s.rise, sunset: s.set, civilDawn: c.rise, civilDusk: c.set, polar: s.polar };
}
