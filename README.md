# Roof-Quote-Engine

A zero-dependency, fully client-side app that turns an Australian street
address into a roof cleaning quote using the Google Solar API.

1. Google **Places Autocomplete** narrows the address to an Australian property.
2. Google **Solar API** (`buildingInsights.findClosest`) returns real roof
   geometry: per-segment tilted surface area, pitch, and azimuth.
3. Total tilted roof area × a configurable A$/m² rate (default A$5.00/m²,
   A$300 minimum) produces the quote.
4. The building outline and roof segments are drawn on a Google satellite map.

## Setup

### 1. Get a Google Maps Platform API key

Enable these APIs on your Cloud project:

- Maps JavaScript API
- Places API
- Solar API

Google's per-SKU monthly free tier covers typical single-operator usage.

### 2. Restrict the key

In **Google Cloud Console → APIs & Services → Credentials**, edit your key:

- **Application restrictions → HTTP referrers**:
  - `https://<your-github-username>.github.io/*`
  - `http://localhost:*/*` (for local dev)
- **API restrictions → Restrict key**: tick only Maps JavaScript API,
  Places API, Solar API.
- Set a **daily quota cap** and a **billing budget alert** so you can't be
  surprised by a leak.

### 3. Drop in your key (kept out of git)

```bash
cp config.example.js config.js
# edit config.js and paste your key
```

`config.js` is in `.gitignore` so your key never leaves your machine.

### 4. Run it

Either open `index.html` directly, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

### Deploying to GitHub Pages

Because `config.js` is gitignored, you either need to:

- Commit a deployment-only `config.js` with a **referrer-restricted** key
  (safe because the key only works from your Pages URL), or
- Inject the key via a build step / GitHub Actions workflow that writes
  `config.js` at deploy time.

## Files

- `index.html` – markup
- `styles.css` – styling
- `app.js` – autocomplete, Solar API call, map rendering, quote math
- `config.example.js` – template for `config.js`

## Caveats

- Google Solar coverage is broad in major AU cities but not everywhere. A
  404 from the Solar API means no imagery yet for that property.
- `imageryQuality` (HIGH / MEDIUM / LOW) is displayed so operators can
  gauge confidence in the measurement.
- GST is not included in the displayed price.
