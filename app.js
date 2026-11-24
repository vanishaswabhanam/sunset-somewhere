// Picks the camera closest to the sunset line and plays it.
(function () {
  const $ = id => document.getElementById(id);
  const feed = $("feed");
  const AFTER = 25, BEFORE = 60;   // minutes either side of sunset that count as "happening now"
  const LOAD_TIMEOUT = 15000;       // skip a stream that hasn't started playing by then

  let places = [], cams = {}, queue = [], at = 0, player = null, ready = false, loadTimer = null;
  const broken = new Set();

  const fmtClock = (ms, tz) => {
    try { return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: tz }).format(ms); }
    catch { return ""; }
  };

  // Places with cams, best sunset first; each place carries its cams in order.
  function rank() {
    const now = Date.now();
    const withSun = places.filter(p => cams[p.name]?.some(c => !broken.has(c.id)))
      .map(p => ({ ...p, sunset: Sun.nextSunset(p.lat, p.lon, now) }))
      .filter(p => p.sunset);
    const mins = p => (p.sunset - now) / 60000;
    const score = p => mins(p) >= 0 ? Math.abs(mins(p) - 4) : (4 - mins(p)) * 2;
    let near = withSun.filter(p => mins(p) > -AFTER && mins(p) < BEFORE).sort((a, b) => score(a) - score(b));
    const soon = withSun.filter(p => mins(p) >= BEFORE).sort((a, b) => a.sunset - b.sunset);
    near = near.concat(soon.slice(0, 4));
    const q = [];
    for (const p of near) for (const c of cams[p.name]) if (!broken.has(c.id)) q.push({ place: p, cam: c });
    return q;
  }

  function show() {
    const item = queue[at];
    if (!item) return;
    const { place: p } = item, now = Date.now();
    $("stamp").textContent = fmtClock(now, p.tz);
    const loc = $("loc");
    loc.textContent = p.name + " ";
    const r = document.createElement("span"); r.textContent = p.region; loc.appendChild(r);
    $("coord").textContent = `${Math.abs(p.lat).toFixed(2)}°${p.lat >= 0 ? "N" : "S"} ${Math.abs(p.lon).toFixed(2)}°${p.lon >= 0 ? "E" : "W"}`;
    const m = Math.round((p.sunset - now) / 60000);
    const span = Math.abs(m) >= 60 ? `${Math.floor(Math.abs(m) / 60)}h ${String(Math.abs(m) % 60).padStart(2, "0")}m` : `${Math.abs(m)} min`;
    $("when").textContent = m >= 0 ? `sunset in ${span}` : `sun set ${span} ago`;
    const otherPlaces = new Set(queue.map(x => x.place.name)).size > 1;
    $("next").hidden = !otherPlaces;
  }

  function play(i) {
    if (!queue.length) { $("status").textContent = "no live cameras right now"; return; }
    at = (i + queue.length) % queue.length;
    feed.classList.remove("playing");
    $("status").textContent = "tuning in";
    show();
    if (!ready) return;
    player.loadVideoById(queue[at].cam.id);
    clearTimeout(loadTimer);
    loadTimer = setTimeout(() => skip(), LOAD_TIMEOUT);
  }

  function skip() {
    const item = queue[at];
    if (item) broken.add(item.cam.id);
    queue = rank();
    const same = queue.findIndex(x => x.place.name === item?.place.name);
    play(same >= 0 ? same : 0);
  }

  function nextPlace() {
    const name = queue[at]?.place.name;
    let j = at;
    for (let k = 0; k < queue.length; k++) { j = (j + 1) % queue.length; if (queue[j].place.name !== name) break; }
    play(j);
  }

  // Every minute: re-rank, and move on if this sunset is long over.
  function tick() {
    const cur = queue[at];
    queue = rank();
    if (!queue.length) return;
    const idx = cur ? queue.findIndex(x => x.cam.id === cur.cam.id) : -1;
    const stale = !cur || idx < 0 || (Date.now() - cur.place.sunset) / 60000 > AFTER;
    if (stale) play(0); else at = idx;
  }

  $("next").addEventListener("click", nextPlace);
  $("sound").addEventListener("click", () => {
    if (!player) return;
    if (player.isMuted()) { player.unMute(); player.setVolume(70); $("sound").textContent = "sound on"; }
    else { player.mute(); $("sound").textContent = "sound off"; }
  });

  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player("player", {
      width: "100%", height: "100%",
      playerVars: { autoplay: 1, mute: 1, controls: 0, disablekb: 1, modestbranding: 1, playsinline: 1, rel: 0, iv_load_policy: 3, fs: 0 },
      events: {
        onReady: () => { ready = true; player.mute(); if (queue.length) play(at); },
        onStateChange: e => {
          if (e.data === YT.PlayerState.PLAYING) { clearTimeout(loadTimer); feed.classList.add("playing"); $("sound").hidden = false; }
          if (e.data === YT.PlayerState.ENDED) skip();
        },
        onError: () => skip(),
      },
    });
  };

  Promise.all([fetch("data/places.json").then(r => r.json()), fetch("data/cams.json").then(r => r.json())])
    .then(([p, c]) => {
      places = p; cams = c.cams || {};
      queue = rank();
      play(0);
      setInterval(show, 1000);
      setInterval(tick, 60000);
    })
    .catch(() => { $("status").textContent = "couldn't load the camera list"; });
})();
