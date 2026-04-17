# Roof-Quote-Engine

A zero-dependency, fully client-side app that turns an Australian street
address into a roof cleaning quote. Enter an address (with autocomplete),
and the app will:

1. Geocode it via the free [Nominatim](https://nominatim.openstreetmap.org/)
   service (OpenStreetMap).
2. Fetch the building footprint at that location from the
   [Overpass API](https://overpass-api.de/).
3. Compute the footprint area using a spherical polygon formula.
4. Apply a configurable roof-pitch multiplier to estimate the true roof surface.
5. Multiply by a configurable cleaning rate in A$/m² (default A$5.00/m², with a
   A$300 minimum service fee) to produce a quote in AUD.

The building footprint is also drawn on an interactive Leaflet map so users can
verify the correct structure was measured.

## Running it

No build step and no API keys. Just open `index.html` in a browser, or serve it
locally:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Files

- `index.html` – markup and form
- `styles.css` – styling
- `app.js` – geocoding, Overpass query, area math, and quote calculation

## Caveats

- Accuracy depends on OpenStreetMap coverage. Rural or newly-built properties
  may lack footprint data.
- The pitch multiplier is a user-selected approximation; real roofs vary.
- Final pricing should always be confirmed with an on-site inspection.
