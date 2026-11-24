// Sun position from the NOAA solar equations. Accurate to about a minute for sunset times.
(function (root) {
  const RAD = Math.PI / 180, DEG = 180 / Math.PI;
  const SUNSET_ALT = -0.833; // sun's centre, allowing for its radius and atmospheric refraction

  function solarParams(ms) {
    const t = (ms / 86400000 + 2440587.5 - 2451545) / 36525;
    const L0 = ((280.46646 + t * (36000.76983 + 0.0003032 * t)) % 360 + 360) % 360;
    const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
    const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
    const Mr = M * RAD;
    const C = Math.sin(Mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * t) + Math.sin(3 * Mr) * 0.000289;
    const omega = 125.04 - 1934.136 * t;
    const lambda = (L0 + C - 0.00569 - 0.00478 * Math.sin(omega * RAD)) * RAD;
    const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
    const eps = (eps0 + 0.00256 * Math.cos(omega * RAD)) * RAD;
    const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
    const y = Math.tan(eps / 2) ** 2, L0r = L0 * RAD;
    const eqTime = 4 * DEG * (y * Math.sin(2 * L0r) - 2 * e * Math.sin(Mr) + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r)
      - 0.5 * y * y * Math.sin(4 * L0r) - 1.25 * e * e * Math.sin(2 * Mr));
    const d = new Date(ms);
    const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60000;
    return { decl, eqTime, utcMin };
  }

  function altitude(ms, lat, lon) {
    const sp = solarParams(ms);
    const H = ((sp.utcMin + sp.eqTime + 4 * lon) / 4 - 180) * RAD, phi = lat * RAD;
    return Math.asin(Math.sin(phi) * Math.sin(sp.decl) + Math.cos(phi) * Math.cos(sp.decl) * Math.cos(H)) * DEG;
  }

  // The next sunset at this place, searching from `fromMs - 3h` up to a day ahead. null if the sun doesn't set.
  function nextSunset(lat, lon, fromMs) {
    const step = 10 * 60000;
    let t0 = fromMs - 3 * 3600000, a0 = altitude(t0, lat, lon) - SUNSET_ALT;
    for (let t1 = t0 + step; t1 <= fromMs + 24 * 3600000; t1 += step) {
      const a1 = altitude(t1, lat, lon) - SUNSET_ALT;
      if (a0 > 0 && a1 <= 0) {
        let lo = t0, hi = t1;
        for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; altitude(m, lat, lon) - SUNSET_ALT > 0 ? lo = m : hi = m; }
        return (lo + hi) / 2;
      }
      t0 = t1; a0 = a1;
    }
    return null;
  }

  root.Sun = { altitude, nextSunset, SUNSET_ALT };
  if (typeof module !== "undefined") module.exports = root.Sun;
})(typeof window !== "undefined" ? window : globalThis);
