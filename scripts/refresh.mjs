// Builds data/cams.json: for every place in data/places.json, a short list of
// YouTube live streams that are broadcasting and can be embedded.
//
//   node scripts/refresh.mjs            check the cams we already have, drop dead ones
//   node scripts/refresh.mjs --discover also search for new cams where a place has fewer than 2
//
// With YOUTUBE_API_KEY set it uses the YouTube Data API (search.list for discovery,
// videos.list for the live check). Without a key it reads YouTube's public live-search
// page instead, which is fine for a one-off seed but not for a scheduled job.

import { readFile, writeFile } from "node:fs/promises";

const KEY = process.env.YOUTUBE_API_KEY || "";
const DISCOVER = process.argv.includes("--discover");
const MAX_PER_PLACE = 3;
const SEARCH_BUDGET = 90; // search.list has its own 100-calls-a-day bucket
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

const places = JSON.parse(await readFile(new URL("../data/places.json", import.meta.url), "utf8"));
const camsPath = new URL("../data/cams.json", import.meta.url);
let store = { updated: null, cams: {} };
try { store = JSON.parse(await readFile(camsPath, "utf8")); } catch {}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const fold = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const STOP = new Set(["live", "cam", "webcam", "beach", "sunset", "the", "city", "harbour", "bridge"]);
const BAD = /\b(music|lofi|lo-fi|radio|news|asmr|relax(ing)?|sleep|gameplay|game|minecraft|gta|chat|podcast|church|mass|prayer|train ?sim|flight ?sim|replay|highlights?)\b/i;

function matches(place, title) {
  const t = fold(title);
  if (BAD.test(t)) return false;
  if (!/\b(cam|webcam|camera|live ?stream|live)\b/.test(t)) return false;
  const terms = fold(`${place.name} ${place.region} ${place.query}`).split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !STOP.has(w));
  return terms.some(w => t.includes(w));
}

async function getJSON(url) {
  const r = await fetch(url, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(`${r.status} ${url.replace(KEY, "KEY")}`);
  return r.json();
}

// ---------- discovery
async function searchApi(q) {
  const u = new URL("https://www.googleapis.com/youtube/v3/search");
  Object.entries({ part: "snippet", q, type: "video", eventType: "live", videoEmbeddable: "true", maxResults: "8", key: KEY })
    .forEach(([k, v]) => u.searchParams.set(k, v));
  const d = await getJSON(u.toString());
  return d.items.map(i => ({ id: i.id.videoId, title: i.snippet.title, channel: i.snippet.channelTitle }));
}

async function searchPage(q) {
  const u = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgJAAQ%253D%253D&hl=en&gl=US`;
  let html = "";
  for (let attempt = 0; attempt < 3 && !html; attempt++) {
    try { html = await (await fetch(u, { headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9", cookie: "CONSENT=YES+1" } })).text(); }
    catch (e) { if (attempt === 2) throw e; await sleep(5000 * (attempt + 1)); }
  }
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) return [];
  const found = [];
  (function walk(o) {
    if (!o || typeof o !== "object") return;
    if (o.videoRenderer) {
      const v = o.videoRenderer;
      const live = JSON.stringify(v.badges || []).includes("LIVE") || JSON.stringify(v.thumbnailOverlays || []).includes('"LIVE"');
      if (live) found.push({ id: v.videoId, title: v.title?.runs?.[0]?.text || "", channel: v.ownerText?.runs?.[0]?.text || "" });
      return;
    }
    for (const k in o) walk(o[k]);
  })(JSON.parse(m[1]));
  return found;
}

// ---------- live check
async function checkApi(ids) {
  const alive = new Set();
  for (let i = 0; i < ids.length; i += 50) {
    const u = new URL("https://www.googleapis.com/youtube/v3/videos");
    u.searchParams.set("part", "snippet,status");
    u.searchParams.set("id", ids.slice(i, i + 50).join(","));
    u.searchParams.set("key", KEY);
    const d = await getJSON(u.toString());
    for (const v of d.items) if (v.snippet.liveBroadcastContent === "live" && v.status.embeddable && v.status.privacyStatus === "public") alive.add(v.id);
  }
  return alive;
}

async function checkPage(ids) {
  const alive = new Set();
  for (const id of ids) {
    try {
      const html = await (await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, { headers: { "user-agent": UA, cookie: "CONSENT=YES+1" } })).text();
      if (html.includes('"isLiveNow":true') && html.includes('"playableInEmbed":true')) alive.add(id);
    } catch {}
  }
  return alive;
}

// ---------- run
const known = Object.values(store.cams).flat().map(c => c.id);
const alive = known.length ? await (KEY ? checkApi(known) : checkPage(known)) : new Set();
let dropped = 0;
for (const name of Object.keys(store.cams)) {
  const before = store.cams[name].length;
  store.cams[name] = store.cams[name].filter(c => alive.has(c.id));
  dropped += before - store.cams[name].length;
  if (!store.cams[name].length) delete store.cams[name];
}

let searches = 0, added = 0;
if (DISCOVER) {
  const used = new Set(Object.values(store.cams).flat().map(c => c.id));
  const want = places.filter(p => (store.cams[p.name]?.length || 0) < 2);
  for (const p of want) {
    if (searches >= SEARCH_BUDGET) break;
    searches++;
    let results = [];
    try { results = await (KEY ? searchApi(p.query) : searchPage(p.query)); }
    catch (e) { console.error(`search failed for ${p.name}: ${e.message}`); if (/403|429/.test(e.message)) break; continue; }
    const list = store.cams[p.name] || [];
    for (const r of results) {
      if (list.length >= MAX_PER_PLACE) break;
      if (used.has(r.id) || !matches(p, r.title)) continue;
      list.push(r); used.add(r.id); added++;
    }
    if (list.length) store.cams[p.name] = list;
    if (!KEY) await sleep(3000);
  }
}

const ordered = {};
for (const p of places) if (store.cams[p.name]) ordered[p.name] = store.cams[p.name];
store = { updated: new Date().toISOString(), cams: ordered };
await writeFile(camsPath, JSON.stringify(store, null, 1) + "\n");
const total = Object.values(ordered).flat().length;
console.log(`checked ${known.length}, dropped ${dropped}, searched ${searches}, added ${added}; ${total} cams across ${Object.keys(ordered).length} places`);
