# Sunset Somewhere

At any moment, the sun is setting somewhere on Earth. This site works out where, and plays a live public webcam pointed at it.

**Live:** https://vanishaswabhanam.github.io/sunset-somewhere/

## How it works

1. **Places.** `data/places.json` lists about 85 places with public live cams, each with coordinates and a timezone.
2. **Cams.** `data/cams.json` holds up to three YouTube live streams per place that are broadcasting and allow embedding.
3. **Sunset maths.** `sun.js` uses the NOAA solar equations to find when each place's sun centre reaches −0.833° (the official sunset, allowing for the sun's radius and refraction).
4. **Picking.** `app.js` ranks places from 60 minutes before sunset to 25 minutes after, preferring a sun just touching the horizon. It plays the best one and skips any stream that errors or doesn't start within 15 seconds.
5. **Keeping it fresh.** A GitHub Action (`.github/workflows/refresh-cams.yml`) runs every hour and drops streams that went offline. Once a day it searches for replacements where a place has fewer than two cams.

## Setup

The site is static and runs on GitHub Pages. The hourly refresh needs a YouTube Data API key:

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project, enable **YouTube Data API v3**, and create an API key.
2. In this repo, go to **Settings → Secrets and variables → Actions** and add the key as `YOUTUBE_API_KEY`.

Without the key, the site still works from the last saved cam list. It just won't replace streams that go offline.

The hourly check uses about 2 of the 10,000 free daily units. The daily search uses up to 90 of the 100 free daily searches.

## Run locally

```sh
python3 -m http.server 8765
# open http://localhost:8765
```

YouTube refuses embeds on pages opened straight from disk, so use a local server.

To rebuild the cam list without an API key (reads YouTube's public live search, fine for a one-off):

```sh
node scripts/refresh.mjs --discover
```

## Adding a place

Add an entry to `data/places.json` with `name`, `region`, `lat`, `lon`, `tz` (IANA timezone) and `query` (what to search on YouTube). The next daily run finds cams for it. A west-facing coastal cam gives the best sunsets.
