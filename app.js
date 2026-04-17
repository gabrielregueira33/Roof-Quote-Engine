const MINIMUM_FEE = 300;
const SQM_TO_SQFT = 10.7639;
const EARTH_RADIUS_M = 6378137;

const form = document.getElementById("quote-form");
const addressInput = document.getElementById("address");
const submitBtn = document.getElementById("submit-btn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const matchedAddressEl = document.getElementById("matched-address");
const footprintSqftEl = document.getElementById("footprint-sqft");
const footprintSqmEl = document.getElementById("footprint-sqm");
const roofSqftEl = document.getElementById("roof-sqft");
const pitchSelect = document.getElementById("pitch");
const rateSelect = document.getElementById("rate");
const subtotalEl = document.getElementById("subtotal");
const totalEl = document.getElementById("total");

let map;
let buildingLayer;
let currentFootprintSqm = 0;

function setStatus(message, kind) {
  if (!message) {
    statusEl.hidden = true;
    statusEl.textContent = "";
    statusEl.className = "status";
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.className = `status ${kind || ""}`.trim();
}

function formatNumber(n, digits = 0) {
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

async function geocode(address) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", address);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
  const data = await res.json();
  if (!data.length) throw new Error("Address not found");
  const hit = data[0];
  return {
    lat: parseFloat(hit.lat),
    lon: parseFloat(hit.lon),
    displayName: hit.display_name,
  };
}

async function fetchBuildings(lat, lon, radius = 40) {
  const query = `
    [out:json][timeout:25];
    (
      way["building"](around:${radius},${lat},${lon});
      relation["building"](around:${radius},${lat},${lon});
    );
    out geom;
  `;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Building lookup failed (${res.status})`);
  return res.json();
}

function extractPolygons(overpassData) {
  const polygons = [];
  for (const el of overpassData.elements || []) {
    if (el.type === "way" && Array.isArray(el.geometry)) {
      const ring = el.geometry.map((p) => [p.lat, p.lon]);
      if (ring.length >= 3) polygons.push({ id: el.id, ring });
    } else if (el.type === "relation" && Array.isArray(el.members)) {
      for (const m of el.members) {
        if (m.type === "way" && m.role === "outer" && Array.isArray(m.geometry)) {
          const ring = m.geometry.map((p) => [p.lat, p.lon]);
          if (ring.length >= 3) polygons.push({ id: el.id, ring });
        }
      }
    }
  }
  return polygons;
}

function pointInPolygon(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polygonCentroid(ring) {
  let lat = 0;
  let lon = 0;
  for (const [la, lo] of ring) {
    lat += la;
    lon += lo;
  }
  return [lat / ring.length, lon / ring.length];
}

function haversine(a, b) {
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function pickBuilding(polygons, lat, lon) {
  for (const poly of polygons) {
    if (pointInPolygon(lat, lon, poly.ring)) return poly;
  }
  let best = null;
  let bestDist = Infinity;
  for (const poly of polygons) {
    const c = polygonCentroid(poly.ring);
    const d = haversine([lat, lon], c);
    if (d < bestDist) {
      bestDist = d;
      best = poly;
    }
  }
  return best;
}

function polygonAreaSqm(ring) {
  if (ring.length < 3) return 0;
  const toRad = (x) => (x * Math.PI) / 180;
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const [lat1, lon1] = ring[i];
    const [lat2, lon2] = ring[(i + 1) % ring.length];
    total +=
      toRad(lon2 - lon1) *
      (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }
  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

function ensureMap() {
  if (map) return;
  map = L.map("map", { zoomControl: true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);
}

function renderMap(lat, lon, ring) {
  ensureMap();
  if (buildingLayer) {
    buildingLayer.remove();
    buildingLayer = null;
  }
  if (ring && ring.length >= 3) {
    buildingLayer = L.polygon(ring, {
      color: "#0ea5e9",
      weight: 2,
      fillColor: "#0ea5e9",
      fillOpacity: 0.25,
    }).addTo(map);
    map.fitBounds(buildingLayer.getBounds(), { padding: [20, 20] });
  } else {
    map.setView([lat, lon], 19);
    buildingLayer = L.marker([lat, lon]).addTo(map);
  }
  setTimeout(() => map.invalidateSize(), 50);
}

function recalcQuote() {
  const pitch = parseFloat(pitchSelect.value) || 1;
  const rate = parseFloat(rateSelect.value) || 0;
  const footprintSqft = currentFootprintSqm * SQM_TO_SQFT;
  const roofSqft = footprintSqft * pitch;
  const subtotal = roofSqft * rate;
  const total = Math.max(subtotal, MINIMUM_FEE);

  roofSqftEl.textContent = formatNumber(roofSqft);
  subtotalEl.textContent = formatNumber(subtotal, 2);
  totalEl.textContent = formatNumber(total, 2);
}

async function runQuote(address) {
  setStatus("Locating address…", "loading");
  submitBtn.disabled = true;
  resultsEl.hidden = true;

  try {
    const location = await geocode(address);
    setStatus("Scanning for building footprint…", "loading");

    const overpass = await fetchBuildings(location.lat, location.lon);
    const polygons = extractPolygons(overpass);

    if (!polygons.length) {
      renderMap(location.lat, location.lon, null);
      matchedAddressEl.textContent = location.displayName;
      throw new Error(
        "No building footprint found at this address. Try a nearby address or a more specific street number."
      );
    }

    const building = pickBuilding(polygons, location.lat, location.lon);
    const footprintSqm = polygonAreaSqm(building.ring);
    currentFootprintSqm = footprintSqm;

    matchedAddressEl.textContent = location.displayName;
    footprintSqmEl.textContent = formatNumber(footprintSqm);
    footprintSqftEl.textContent = formatNumber(footprintSqm * SQM_TO_SQFT);

    renderMap(location.lat, location.lon, building.ring);
    recalcQuote();

    resultsEl.hidden = false;
    setStatus("", null);
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Something went wrong. Please try again.", "error");
  } finally {
    submitBtn.disabled = false;
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const address = addressInput.value.trim();
  if (!address) return;
  runQuote(address);
});

pitchSelect.addEventListener("change", recalcQuote);
rateSelect.addEventListener("change", recalcQuote);
