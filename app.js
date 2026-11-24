// Picks the camera closest to the sunset line and plays it.
//
// Two YouTube players sit on top of each other. The one on screen keeps playing while the
// next stream loads hidden in the other; once that stream has played cleanly for a few
// seconds it crossfades in. Dead or blocked streams fail off screen, so switching cams,
// places or sunsets never shows a black frame, a spinner or YouTube's own controls.
(function () {
  const $ = id => document.getElementById(id);
  const feed = $("feed");
  const AFTER = 25, BEFORE = 60;   // minutes either side of sunset that count as "happening now"
  const LOAD_TIMEOUT = 15000;       // give up on a stream that hasn't started by then
  const REVEAL_DELAY = 4200;        // YouTube shows its title, controls and play icon for ~3.5 s after a stream starts
  const FADE = 1200;                // matches the CSS opacity transition

  let places = [], cams = {}, queue = [], at = -1;
  let apiReady = false, soundOn = false, blockedByBrowser = false;
  const broken = new Set();

  // ---- the two players
  const slots = [0, 1].map(i => ({ el: $("p" + i), yt: null, ready: false, item: null, loadTimer: 0, revealTimer: 0 }));
  let shown = null; // the slot on screen

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
    const near = withSun.filter(p => mins(p) > -AFTER && mins(p) < BEFORE).sort((a, b) => score(a) - score(b));
    const soon = withSun.filter(p => mins(p) >= BEFORE).sort((a, b) => a.sunset - b.sunset);
    const q = [];
    for (const p of near.concat(soon.slice(0, 4))) for (const c of cams[p.name]) if (!broken.has(c.id)) q.push({ place: p, cam: c });
    return q;
  }

  // ---- text under the frame follows whatever is on screen
  function show() {
    const item = shown?.item || queue[at];
    if (!item) return;
    const p = item.place, now = Date.now();
    $("stamp").textContent = fmtClock(now, p.tz);
    const loc = $("loc");
    if (loc.dataset.place !== p.name) {
      loc.dataset.place = p.name;
      loc.textContent = p.name + " ";
      const r = document.createElement("span"); r.textContent = p.region; loc.appendChild(r);
      $("coord").textContent = `${Math.abs(p.lat).toFixed(2)}°${p.lat >= 0 ? "N" : "S"} ${Math.abs(p.lon).toFixed(2)}°${p.lon >= 0 ? "E" : "W"}`;
    }
    const m = Math.round((p.sunset - now) / 60000), a = Math.abs(m);
    const span = a >= 60 ? `${Math.floor(a / 60)}h ${String(a % 60).padStart(2, "0")}m` : `${a} min`;
    $("when").textContent = m >= 0 ? `sunset in ${span}` : `sun set ${span} ago`;
    $("next").hidden = new Set(queue.map(x => x.place.name)).size < 2;
  }

  // ---- loading and swapping
  const standby = () => slots.find(s => s !== shown) || slots[0];

  function load(i) {
    if (!queue.length) return;
    at = (i + queue.length) % queue.length;
    const s = standby();
    if (!s.ready) return; // picked up when that player is ready
    clearTimeout(s.loadTimer); clearTimeout(s.revealTimer);
    s.item = queue[at];
    s.yt.mute();
    s.yt.loadVideoById(s.item.cam.id);
    s.loadTimer = setTimeout(() => stalled(s), LOAD_TIMEOUT);
    if (!shown) show();
  }

  function reveal(s) {
    if (s === shown) return;
    const old = shown;
    shown = s;
    s.el.classList.add("on");
    if (soundOn) { s.yt.unMute(); s.yt.setVolume(70); }
    if (old) {
      old.el.classList.remove("on");
      setTimeout(() => { if (old !== shown) { old.yt.stopVideo(); old.item = null; } }, FADE);
    }
    feed.classList.remove("tap");
    $("status").textContent = "";
    $("sound").hidden = false;
    show();
  }

  // The stream in `s` failed. Try the next cam off screen; whatever is showing keeps playing.
  function failed(s) {
    clearTimeout(s.loadTimer); clearTimeout(s.revealTimer);
    if (s.item) broken.add(s.item.cam.id);
    const was = s.item;
    queue = rank();
    if (s === shown) { // the stream on screen died: hand over to the other player
      shown = null; s.el.classList.remove("on");
    }
    const same = queue.findIndex(x => x.place.name === was?.place.name);
    load(same >= 0 ? same : 0);
  }

  // Not playing after LOAD_TIMEOUT. If it never left "unstarted" or "cued", and nothing is on
  // screen yet, the browser blocked autoplay: ask for one tap. Otherwise the stream is dead.
  function stalled(s) {
    const st = s.yt.getPlayerState?.();
    if (!shown && (st === YT.PlayerState.UNSTARTED || st === YT.PlayerState.CUED)) {
      blockedByBrowser = true;
      feed.classList.add("tap");
      $("status").textContent = "tap to watch";
      return;
    }
    failed(s);
  }

  function nextPlace() {
    const name = (shown?.item || queue[at])?.place.name;
    let j = at;
    for (let k = 0; k < queue.length; k++) { j = (j + 1) % queue.length; if (queue[j].place.name !== name) break; }
    load(j);
  }

  // Every minute: re-rank, and move on once this sunset is long over.
  function tick() {
    queue = rank();
    const cur = shown?.item;
    if (!queue.length || !cur) return;
    const idx = queue.findIndex(x => x.cam.id === cur.cam.id);
    if (idx >= 0) at = idx;
    if (idx < 0 || (Date.now() - cur.place.sunset) / 60000 > AFTER) {
      if (!standby().item) load(0); // the current picture stays up until the new one is ready
    }
  }

  // ---- controls
  $("next").addEventListener("click", nextPlace);
  $("sound").addEventListener("click", () => {
    if (!shown) return;
    soundOn = !soundOn;
    if (soundOn) { shown.yt.unMute(); shown.yt.setVolume(70); } else shown.yt.mute();
    $("sound").textContent = soundOn ? "sound on" : "sound off";
  });
  feed.addEventListener("click", () => {
    if (!blockedByBrowser || shown) return;
    const s = standby();
    s.yt.playVideo();
    clearTimeout(s.loadTimer);
    s.loadTimer = setTimeout(() => stalled(s), LOAD_TIMEOUT);
  });

  window.onYouTubeIframeAPIReady = function () {
    apiReady = true;
    for (const s of slots) {
      s.yt = new YT.Player(s.el.firstElementChild, {
        width: "100%", height: "100%",
        playerVars: { autoplay: 1, mute: 1, controls: 0, disablekb: 1, playsinline: 1, rel: 0, iv_load_policy: 3, fs: 0 },
        events: {
          onReady: () => { s.ready = true; s.yt.mute(); if (queue.length && !slots.some(x => x.item)) load(Math.max(at, 0)); },
          onStateChange: e => {
            if (!s.item) return;
            if (e.data === YT.PlayerState.PLAYING) {
              clearTimeout(s.loadTimer);
              if (s !== shown) {
                clearTimeout(s.revealTimer);
                s.revealTimer = setTimeout(() => { if (s.yt.getPlayerState() === YT.PlayerState.PLAYING) reveal(s); }, REVEAL_DELAY);
              }
            } else if (e.data === YT.PlayerState.ENDED) {
              failed(s);
            } else if (e.data === YT.PlayerState.BUFFERING && s === shown) {
              // a stream that stalls on screen for good gets replaced behind it
              clearTimeout(s.loadTimer);
              s.loadTimer = setTimeout(() => { if (s.yt.getPlayerState() === YT.PlayerState.BUFFERING) failed(s); }, LOAD_TIMEOUT);
            }
          },
          onError: () => { if (s.item) failed(s); },
        },
      });
    }
  };

  // YouTube's player script never arrived (usually an ad blocker): offer the stream on YouTube.
  setTimeout(() => {
    if (apiReady) return;
    const st = $("status");
    st.textContent = "the video player was blocked, often by an ad blocker. ";
    const a = document.createElement("a");
    a.textContent = "open on youtube";
    a.target = "_blank"; a.rel = "noopener";
    const id = queue[at]?.cam.id;
    a.href = id ? `https://www.youtube.com/watch?v=${id}` : "https://www.youtube.com/results?search_query=sunset+live+cam";
    st.appendChild(a);
    feed.classList.add("blocked");
  }, 10000);

  Promise.all([fetch("data/places.json").then(r => r.json()), fetch("data/cams.json").then(r => r.json())])
    .then(([p, c]) => {
      places = p; cams = c.cams || {};
      queue = rank();
      load(0);
      show();
      setInterval(show, 1000);
      setInterval(tick, 60000);
    })
    .catch(() => {});
})();
