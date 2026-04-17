const MINIMUM_FEE = 300;

const form = document.getElementById("quote-form");
const addressInput = document.getElementById("address");
const submitBtn = document.getElementById("submit-btn");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const matchedAddressEl = document.getElementById("matched-address");
const roofSqmEl = document.getElementById("roof-sqm");
const groundSqmEl = document.getElementById("ground-sqm");
const avgPitchEl = document.getElementById("avg-pitch");
const segmentCountEl = document.getElementById("segment-count");
const imageryQualityEl = document.getElementById("imagery-quality");
const rateSelect = document.getElementById("rate");
const subtotalEl = document.getElementById("subtotal");
const totalEl = document.getElementById("total");

let map;
let mapOverlays = [];
let autocomplete;
let selectedPlace = null;
let currentRoofSqm = 0;

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
  return Number(n).toLocaleString("en-AU", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function loadGoogleMaps(apiKey) {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.maps) {
      resolve();
      return;
    }
    const existing = document.querySelector("script[data-google-maps]");
    if (existing) {
      existing.addEventListener("load", resolve);
      existing.addEventListener("error", reject);
      return;
    }
    const script = document.createElement("script");
    const params = new URLSearchParams({
      key: apiKey,
      libraries: "places",
      v: "weekly",
      loading: "async",
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.defer = true;
    script.dataset.googleMaps = "true";
    script.onload = resolve;
    script.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(script);
  });
}

function initAutocomplete() {
  autocomplete = new google.maps.places.Autocomplete(addressInput, {
    componentRestrictions: { country: "au" },
    fields: ["geometry", "formatted_address"],
    types: ["address"],
  });
  autocomplete.addListener("place_changed", () => {
    const place = autocomplete.getPlace();
    if (!place || !place.geometry || !place.geometry.location) {
      selectedPlace = null;
      submitBtn.disabled = true;
      return;
    }
    selectedPlace = {
      lat: place.geometry.location.lat(),
      lng: place.geometry.location.lng(),
      formattedAddress: place.formatted_address || addressInput.value,
    };
    submitBtn.disabled = false;
  });

  addressInput.addEventListener("input", () => {
    selectedPlace = null;
    submitBtn.disabled = true;
  });
}

function initMap() {
  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: -33.8688, lng: 151.2093 },
    zoom: 19,
    mapTypeId: "hybrid",
    tilt: 0,
    streetViewControl: false,
    fullscreenControl: false,
  });
}

function clearOverlays() {
  for (const overlay of mapOverlays) overlay.setMap(null);
  mapOverlays = [];
}

function rectangleFromBoundingBox(box, options) {
  return new google.maps.Rectangle({
    bounds: {
      south: box.sw.latitude,
      west: box.sw.longitude,
      north: box.ne.latitude,
      east: box.ne.longitude,
    },
    ...options,
  });
}

function pitchColor(pitch) {
  const clamped = Math.max(0, Math.min(45, pitch));
  const hue = 200 - (clamped / 45) * 160;
  return `hsl(${hue}, 80%, 50%)`;
}

function renderBuilding(building) {
  clearOverlays();

  const buildingRect = rectangleFromBoundingBox(building.boundingBox, {
    map,
    strokeColor: "#ffffff",
    strokeOpacity: 0.9,
    strokeWeight: 2,
    fillOpacity: 0,
    clickable: false,
  });
  mapOverlays.push(buildingRect);

  const segments = building.solarPotential?.roofSegmentStats || [];
  for (const seg of segments) {
    if (!seg.boundingBox) continue;
    const rect = rectangleFromBoundingBox(seg.boundingBox, {
      map,
      strokeColor: pitchColor(seg.pitchDegrees || 0),
      strokeOpacity: 0.9,
      strokeWeight: 1.5,
      fillColor: pitchColor(seg.pitchDegrees || 0),
      fillOpacity: 0.25,
      clickable: false,
    });
    mapOverlays.push(rect);
  }

  const bounds = new google.maps.LatLngBounds(
    {
      lat: building.boundingBox.sw.latitude,
      lng: building.boundingBox.sw.longitude,
    },
    {
      lat: building.boundingBox.ne.latitude,
      lng: building.boundingBox.ne.longitude,
    }
  );
  map.fitBounds(bounds, 40);
}

async function fetchBuildingInsights(lat, lng, apiKey) {
  const url = new URL(
    "https://solar.googleapis.com/v1/buildingInsights:findClosest"
  );
  url.searchParams.set("location.latitude", String(lat));
  url.searchParams.set("location.longitude", String(lng));
  url.searchParams.set("requiredQuality", "LOW");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url);
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = body.error?.message || "";
    } catch {}
    if (res.status === 404) {
      throw new Error(
        "No solar coverage at this address yet. Google Solar doesn't have imagery for this building."
      );
    }
    throw new Error(
      `Solar API error (${res.status})${detail ? ": " + detail : ""}`
    );
  }
  return res.json();
}

function summariseRoof(building) {
  const segments = building.solarPotential?.roofSegmentStats || [];
  let tilted = 0;
  let ground = 0;
  let pitchWeighted = 0;
  for (const seg of segments) {
    const area = seg.stats?.areaMeters2 || 0;
    const groundArea = seg.stats?.groundAreaMeters2 || 0;
    tilted += area;
    ground += groundArea;
    pitchWeighted += (seg.pitchDegrees || 0) * area;
  }
  const avgPitch = tilted > 0 ? pitchWeighted / tilted : 0;
  return {
    tilted,
    ground,
    avgPitch,
    segmentCount: segments.length,
    imageryQuality: building.imageryQuality || "UNKNOWN",
  };
}

function recalcQuote() {
  const rate = parseFloat(rateSelect.value) || 0;
  const subtotal = currentRoofSqm * rate;
  const total = Math.max(subtotal, MINIMUM_FEE);
  subtotalEl.textContent = formatNumber(subtotal, 2);
  totalEl.textContent = formatNumber(total, 2);
}

async function runQuote() {
  if (!selectedPlace) {
    setStatus("Please pick an address from the suggestions.", "error");
    return;
  }
  submitBtn.disabled = true;
  resultsEl.hidden = true;
  setStatus("Measuring roof with Google Solar…", "loading");

  try {
    const building = await fetchBuildingInsights(
      selectedPlace.lat,
      selectedPlace.lng,
      window.APP_CONFIG.googleMapsApiKey
    );
    const summary = summariseRoof(building);
    currentRoofSqm = summary.tilted;

    matchedAddressEl.textContent = selectedPlace.formattedAddress;
    roofSqmEl.textContent = formatNumber(summary.tilted);
    groundSqmEl.textContent = formatNumber(summary.ground);
    avgPitchEl.textContent = formatNumber(summary.avgPitch, 1);
    segmentCountEl.textContent = String(summary.segmentCount);
    imageryQualityEl.textContent = summary.imageryQuality;

    renderBuilding(building);
    recalcQuote();

    resultsEl.hidden = false;
    setStatus("", null);
  } catch (err) {
    console.error(err);
    setStatus(err.message || "Something went wrong. Please try again.", "error");
  } finally {
    submitBtn.disabled = !selectedPlace;
  }
}

async function bootstrap() {
  if (!window.APP_CONFIG || !window.APP_CONFIG.googleMapsApiKey) {
    setStatus(
      "Missing API key. Copy config.example.js to config.js and add your Google Maps API key.",
      "error"
    );
    return;
  }
  try {
    await loadGoogleMaps(window.APP_CONFIG.googleMapsApiKey);
    initAutocomplete();
    initMap();
  } catch (err) {
    console.error(err);
    setStatus("Failed to load Google Maps. Check your API key and domain restrictions.", "error");
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  runQuote();
});

rateSelect.addEventListener("change", recalcQuote);

bootstrap();
