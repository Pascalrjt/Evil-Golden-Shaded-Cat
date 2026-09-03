/* Pickup Pilot. One state object, one render() that draws the map, the passenger sheet,
   the driver sheet and the facilitator panel from the same data. */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const STATE_KEY = "pp:state";

/* ---------- State ---------- */

const state = {
  session: { participantId: "P00", role: "passenger", scenarioId: "FREE", variant: "explained", orderPosition: 1, useGps: true },
  scenario: getScenario("FREE"),
  spots: cloneFixture(),
  ui: defaultUi(),
};

function defaultUi() {
  return {
    screen: "locate",
    locateExpanded: false,
    selectedSpotId: null,
    mapCenter: null,
    userPosition: null,
    gpsAttempted: false,
    searchLabel: "",
    chosenAlternativeId: null,
    overridePending: false,
    stepFreeOnly: false,
    suggestionsOpen: false,
    countdownStartedAt: null,
    statusLoggedFor: null,
    relocationLoggedFor: null,
    badLocationLogged: false,
    completed: false,
    driverConfirmed: false,
    driverAddMode: false,
    driverPending: null,
    driverSuggestOpen: false,
    driverSuggested: null,
    driverInspectId: null,
    driverSearch: "",
  };
}

function cloneFixture() {
  return SPOT_FIXTURE.map((spot) => ({ ...spot, reports: [], addedBy: null, lastReporter: null }));
}

function persist() {
  try {
    localStorage.setItem(
      STATE_KEY,
      JSON.stringify({ session: state.session, scenarioId: state.scenario.id, spots: state.spots, ui: state.ui }),
    );
  } catch (error) {
    /* Storage unavailable. The session still runs in memory. */
  }
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY));
    if (!saved || !saved.session || !Array.isArray(saved.spots)) return false;
    state.session = { ...state.session, ...saved.session };
    state.scenario = getScenario(saved.scenarioId);
    state.spots = saved.spots;
    state.ui = { ...defaultUi(), ...saved.ui };
    if (state.ui.screen === "search") {
      state.ui.screen = "locate";
      state.ui.locateExpanded = true;
    }
    return true;
  } catch (error) {
    return false;
  }
}

function log(event, payload = {}) {
  return EventLog.record(state.session, event, payload);
}

/* ---------- Helpers ---------- */

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function validCoords(coords) {
  return Array.isArray(coords) && coords.length === 2 && coords.every(Number.isFinite);
}

function inBounds(coords) {
  const [[south, west], [north, east]] = CBD_BOUNDS;
  return validCoords(coords) && coords[0] >= south && coords[0] <= north && coords[1] >= west && coords[1] <= east;
}

function distanceMetres(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earth = 6371000;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * earth * Math.asin(Math.sqrt(h));
}

function getSpot(id) {
  return state.spots.find((spot) => spot.id === id) || null;
}

function selectedSpot() {
  return getSpot(state.ui.selectedSpotId);
}

function walkFor(spot, origin = selectedSpot()) {
  const overrides = state.scenario.walkOverrides || {};
  if (overrides[spot.id]) return overrides[spot.id];
  if (!origin || !validCoords(origin.coordinates) || !validCoords(spot.coordinates)) return null;
  return Math.max(1, Math.ceil(distanceMetres(origin.coordinates, spot.coordinates) / WALK_METRES_PER_MINUTE));
}

function alternativesFor(spot) {
  return state.spots
    .filter((candidate) => candidate.id !== spot.id && !candidate.custom && ["suitable", "caution"].includes(candidate.status) && validCoords(candidate.coordinates))
    .filter((candidate) => !state.ui.stepFreeOnly || candidate.stepFree)
    .map((candidate) => ({ spot: candidate, walk: walkFor(candidate, spot) }))
    .sort((a, b) => {
      const rank = (item) => (item.spot.status === "suitable" ? 0 : 1);
      return rank(a) - rank(b) || (a.walk ?? 99) - (b.walk ?? 99);
    });
}

function nearestSpot(coords) {
  let best = null;
  state.spots.forEach((spot) => {
    if (!validCoords(spot.coordinates) || spot.custom) return;
    const distance = distanceMetres(coords, spot.coordinates);
    if (!best || distance < best.distance) best = { spot, distance };
  });
  return best;
}

function statusIcon(status) {
  if (status === "unknown") return "map-pin";
  if (status === "blocked") return "circle-alert";
  if (status === "caution") return "triangle-alert";
  return "circle-check-big";
}

function freshnessText(spot) {
  const count = spot.reportCount || 1;
  const reporter = spot.lastReporter === "passenger" ? "passenger" : "driver";
  switch (spot.state) {
    case "unreported":
      return "No driver reports for this kerb yet";
    case "verified":
      return `Verified by ${count} drivers, ${spot.ageText}`;
    case "temporary":
      return `${count === 1 ? `One ${reporter} report` : `${count} reports`}, ${spot.ageText}. Not yet verified`;
    case "reported":
      return `Reported ${spot.ageText}. Waiting for verification`;
    case "corrected":
      return `Corrected after new driver reports, ${spot.ageText}`;
    case "expired":
      return `Report expired. Last report ${spot.ageText}`;
    default:
      return spot.ageText || "";
  }
}

function sourceText(spot) {
  if (spot.state === "unreported") return "no reports yet";
  if (spot.state === "temporary" && spot.lastReporter === "passenger") return "one passenger report";
  if (spot.addedBy === "driver" && spot.state === "temporary") return "one driver report";
  return "driver reports";
}

function reasonSentence(reason, note) {
  const sentences = {
    "Good pickup spot": "Marked as a good pickup spot by a driver",
    "No-stopping zone": "No-stopping zone reported on this kerb",
    "Road closure": "Road closure reported here",
    "Heavy traffic": "Heavy traffic reported at this kerb",
    "Limited access": "Limited kerb access reported here",
    "Unsafe roadside": "Unsafe roadside reported here",
    "Construction or event": "Construction or an event is affecting this kerb",
  };
  const base = sentences[reason] || reason;
  return note ? `${base}. ${note}` : base;
}

function reasonStatus(reason) {
  const option = REPORT_REASONS.find((item) => item.value === reason);
  return option ? option.status : "caution";
}

function defaultReasonFor(status) {
  return {
    suitable: "Confirmed as a suitable pickup spot",
    caution: "Conditions here can make pickup difficult",
    blocked: "Stopping here is not allowed",
  }[status];
}

/* ---------- State machine ---------- */

const TRANSITIONS = {
  report: { from: ["unreported", "reported", "temporary", "verified", "corrected", "expired"], to: "temporary" },
  verify: { from: ["temporary"], to: "verified" },
  correct: { from: ["verified"], to: "corrected" },
  expire: { from: ["reported", "temporary", "verified", "corrected"], to: "expired" },
};

function transition(spotId, trigger, triggeredBy, extra = {}) {
  const spot = getSpot(spotId);
  const rule = TRANSITIONS[trigger];
  if (!spot || !rule) {
    log("error_or_exception", { message: `Unknown transition ${trigger} on ${spotId}` });
    return false;
  }
  const previousState = spot.state;
  if (!rule.from.includes(previousState)) {
    log("error_or_exception", {
      message: `Transition "${trigger}" is not allowed from "${previousState}" on ${spot.id}`,
      spot_id: spot.id,
    });
    showToast("Not allowed", `${spot.name} is ${previousState}. "${trigger}" does not apply.`);
    return false;
  }
  const displayBefore = spot.status;

  if (trigger === "report") {
    const report = extra.report;
    spot.reports.push(report);
    spot.status = reasonStatus(report.reason);
    spot.reason = reasonSentence(report.reason, report.note);
    spot.reportCount = spot.reports.filter((item) => item.reason === report.reason).length;
    spot.lastReporter = report.actor;
    spot.validity = null;
  } else if (trigger === "verify") {
    spot.reportCount = Math.max(3, (spot.reportCount || 1) + 2);
    spot.lastReporter = "driver";
  } else if (trigger === "correct") {
    spot.status = extra.status || "suitable";
    spot.reason = extra.reason || defaultReasonFor(spot.status);
    spot.reportCount = Math.max(2, spot.reportCount || 1);
    spot.validity = null;
  } else if (trigger === "expire") {
    spot.status = "caution";
    spot.reason = "An earlier report has expired and needs checking";
    spot.validity = null;
  }

  spot.state = rule.to;
  spot.ageText = "just now";
  spot.updatedAt = new Date().toISOString();

  log("state_transition", {
    spot_id: spot.id,
    from_status: trigger === "report" ? "reported" : previousState,
    to_status: spot.state,
    previous_state: previousState,
    display_before: displayBefore,
    display_after: spot.status,
    trigger,
    triggered_by: triggeredBy,
  });
  render();
  return true;
}

/* ---------- Map ---------- */

const map = L.map("map", {
  zoomControl: false,
  attributionControl: true,
  minZoom: 14,
  maxZoom: 19,
  maxBounds: L.latLngBounds(CBD_BOUNDS).pad(0.4),
  maxBoundsViscosity: 0.7,
}).setView(CBD_CENTER, 16);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const markerLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);

function pinIcon(spot, options = {}) {
  const eta = options.eta ? `<span class="pin-eta"><b>${options.eta}</b><small>MIN</small></span>` : "";
  const glyph = options.pickup ? '<span class="pin-pickup"></span>' : '<span class="pin-dot"></span>';
  const classes = ["pin", spot.status, options.pickup ? "is-pickup" : "", options.chosen ? "is-chosen" : "", options.pending ? "is-pending" : ""]
    .filter(Boolean)
    .join(" ");
  return L.divIcon({
    className: "pin-shell",
    html: `<div class="${classes}">${glyph}<span class="pin-label">${eta}<span class="pin-name">${escapeHtml(spot.name)}</span><i data-lucide="chevron-right"></i></span></div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function carIcon() {
  return L.divIcon({
    className: "pin-shell",
    html: '<div class="car-marker"><i data-lucide="car-front"></i></div>',
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function renderMap() {
  markerLayer.clearLayers();
  routeLayer.clearLayers();
  const ui = state.ui;
  const role = state.session.role;
  const selected = selectedSpot();
  const chosen = getSpot(ui.chosenAlternativeId) || getSpot(ui.driverSuggested);
  const showStatusPins = role === "driver" || ui.screen !== "search";
  const hidePickup = role === "passenger" && ui.screen === "locate";

  state.spots.forEach((spot) => {
    if (!validCoords(spot.coordinates)) return;
    const isPickup = !hidePickup && selected && spot.id === selected.id;
    const isChosen = chosen && spot.id === chosen.id;
    if (!showStatusPins && !isPickup) return;
    if (spot.custom && !isPickup) return;
    const eta = isPickup || isChosen ? spot.driverEta : null;
    const marker = L.marker(spot.coordinates, {
      icon: pinIcon(spot, { pickup: isPickup, chosen: isChosen, eta }),
      keyboard: false,
    });
    marker.on("click", () => onPinTap(spot.id));
    marker.addTo(markerLayer);
  });

  if (ui.driverPending && validCoords(ui.driverPending.coordinates)) {
    L.marker(ui.driverPending.coordinates, {
      icon: pinIcon({ name: ui.driverPending.name, status: "pending" }, { pending: true }),
      keyboard: false,
    }).addTo(markerLayer);
  }

  const showCar = role === "driver" || ui.screen === "confirmed";
  if (showCar) {
    L.marker(DRIVER_POSITION, { icon: carIcon(), keyboard: false, interactive: false }).addTo(markerLayer);
  }

  if (selected && chosen && validCoords(selected.coordinates) && validCoords(chosen.coordinates)) {
    L.polyline([selected.coordinates, chosen.coordinates], {
      color: "#ffffff",
      weight: 4,
      opacity: 0.9,
      dashArray: "6 8",
    }).addTo(routeLayer);
  }
  if (showCar && (chosen || selected)) {
    const target = chosen || selected;
    if (validCoords(target.coordinates)) {
      L.polyline([DRIVER_POSITION, target.coordinates], { color: "#ffffff", weight: 3, opacity: 0.55 }).addTo(routeLayer);
    }
  }
}

function focusSpot(spot, zoom = 16) {
  if (!spot || !validCoords(spot.coordinates)) return;
  map.setView(spot.coordinates, zoom, { animate: true });
}

function focusPair(a, b) {
  if (!a || !b || !validCoords(a.coordinates) || !validCoords(b.coordinates)) return focusSpot(a || b);
  map.fitBounds(L.latLngBounds([a.coordinates, b.coordinates]), { padding: [70, 70], maxZoom: 17 });
}

function onPinTap(spotId) {
  const spot = getSpot(spotId);
  if (!spot) return;
  if (state.session.role === "driver") {
    if (state.ui.driverAddMode) {
      openReport({ mode: "suggest", actor: "driver", spotId: spot.id });
      return;
    }
    state.ui.driverInspectId = spot.id;
    focusSpot(spot);
    render();
    return;
  }
  if (state.ui.screen !== "pickup") return;
  const selected = selectedSpot();
  if (!selected || spot.id === selected.id || state.scenario.suggestions === "none") return;
  if (alternativesFor(selected).some((item) => item.spot.id === spot.id)) {
    if (!state.ui.suggestionsOpen) {
      state.ui.suggestionsOpen = true;
      log("alternatives_opened", { via: "map" });
    }
    chooseAlternative(spot.id);
  }
}

map.on("click", (event) => {
  if (state.session.role !== "driver" || !state.ui.driverAddMode) return;
  const coords = [Number(event.latlng.lat.toFixed(5)), Number(event.latlng.lng.toFixed(5))];
  if (!inBounds(coords)) {
    showToast("Outside the study area", "Pins can only be placed in the Brisbane CBD study area.");
    return;
  }
  const nearest = nearestSpot(coords);
  const name = nearest && nearest.distance < 400 ? `Near ${nearest.spot.name}` : "Driver pin";
  state.ui.driverPending = { coordinates: coords, name };
  render();
  openReport({ mode: "suggest", actor: "driver", pending: true });
});

/* ---------- Locate screen (drag the map under a fixed pin) ---------- */

function pinPoint() {
  const phone = $("#phone");
  return L.point(phone.clientWidth / 2, Math.round(phone.clientHeight * 0.4));
}

function centreCoords() {
  const latlng = map.containerPointToLatLng(pinPoint());
  return [Number(latlng.lat.toFixed(5)), Number(latlng.lng.toFixed(5))];
}

function resolveCentre() {
  const coords = centreCoords();
  const nearest = nearestSpot(coords);
  return { coords, nearest, inside: inBounds(coords) };
}

function locateStatusLine(resolved) {
  if (!resolved.inside) return "Move the pin back into the city centre";
  if (resolved.nearest && resolved.nearest.distance <= SNAP_METRES) return `Pin at ${resolved.nearest.spot.name}`;
  if (resolved.nearest && resolved.nearest.distance <= 600) return `Pin ${Math.round(resolved.nearest.distance)} m from ${resolved.nearest.spot.name}`;
  return "Pin in the Brisbane CBD";
}

function locateTemplate() {
  const resolved = resolveCentre();
  if (state.ui.locateExpanded) return planRideTemplate();
  return `
    <header class="sheet-header centred">
      <h1>Set your pickup spot</h1>
      <p class="muted">Drag map to move pin</p>
      <p class="locate-status" id="locate-status">${escapeHtml(locateStatusLine(resolved))}</p>
    </header>
    <button class="locate-field" type="button" id="locate-search" aria-label="Search for a pickup location">
      <span class="locate-glyph"></span>
      <span class="locate-placeholder">Where should we pick you up?</span>
      <i data-lucide="search"></i>
    </button>
    <div class="actions">
      <button class="button primary" type="button" id="locate-confirm" ${resolved.inside ? "" : "disabled"}>Confirm pickup spot</button>
    </div>`;
}

function planRideTemplate() {
  return `
    <section class="plan-ride" aria-label="Plan your ride">
      <header class="plan-ride-header">
        <h2>Plan your ride</h2>
        <button class="icon-button" id="collapse-plan" type="button" aria-label="Collapse Plan your ride">
          <i data-lucide="chevron-down"></i>
        </button>
      </header>
      <div class="chip-row">
        <button class="chip" type="button"><i data-lucide="clock-3"></i>Pick up now<i data-lucide="chevron-down"></i></button>
        <button class="chip" type="button"><i data-lucide="user-round"></i>For me<i data-lucide="chevron-down"></i></button>
      </div>
      <div class="route-fields">
        <div class="route-glyphs" aria-hidden="true">
          <span class="glyph-dot"></span>
          <span class="glyph-line"></span>
          <span class="glyph-square"></span>
        </div>
        <div class="route-inputs">
          <input
            id="search-input"
            type="search"
            placeholder="Pickup location"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            aria-label="Pickup location"
          />
          <div class="route-static">Brisbane Airport</div>
        </div>
        <button class="icon-button" id="search-clear" type="button" aria-label="Clear pickup location">
          <i data-lucide="circle-x"></i>
        </button>
      </div>
      <ul class="result-list" id="search-results" aria-label="Pickup suggestions"></ul>
    </section>`;
}

function removeCustomPins() {
  state.spots = state.spots.filter((spot) => !spot.custom);
}

function confirmCentre() {
  const resolved = resolveCentre();
  if (!resolved.inside) {
    showToast("Outside the study area", "Move the pin back into the Brisbane CBD.");
    return;
  }
  removeCustomPins();
  if (resolved.nearest && resolved.nearest.distance <= SNAP_METRES) {
    placePin(resolved.nearest.spot.id, resolved.nearest.spot.name, "map");
    return;
  }
  const nearest = resolved.nearest;
  const pin = {
    id: `pin-${Date.now()}`,
    name: "Dropped pin",
    address: nearest ? `${Math.round(nearest.distance)} m from ${nearest.spot.name}` : "Brisbane CBD",
    coordinates: resolved.coords,
    status: "unknown",
    state: "unreported",
    reason: "No driver reports for this exact kerb yet",
    reportCount: 0,
    ageText: "",
    driverEta: nearest ? nearest.spot.driverEta + 1 : 6,
    stepFree: true,
    reports: [],
    addedBy: "passenger",
    lastReporter: null,
    custom: true,
  };
  state.spots.push(pin);
  placePin(pin.id, "Dropped pin", "map");
}

let locateMoveTimer = null;
map.on("moveend", () => {
  if (state.session.role !== "passenger" || state.ui.screen !== "locate") return;
  const resolved = resolveCentre();
  state.ui.mapCenter = [map.getCenter().lat, map.getCenter().lng, map.getZoom()];
  const line = $("#locate-status");
  if (line) line.textContent = locateStatusLine(resolved);
  const confirm = $("#locate-confirm");
  if (confirm) confirm.disabled = !resolved.inside;
  window.clearTimeout(locateMoveTimer);
  locateMoveTimer = window.setTimeout(() => {
    log("map_moved", {
      coordinates: resolved.coords,
      nearest_spot_id: resolved.nearest ? resolved.nearest.spot.id : null,
      nearest_distance_m: resolved.nearest ? Math.round(resolved.nearest.distance) : null,
      inside_area: resolved.inside,
    });
    persist();
  }, 400);
});

/* ---------- Device location (used only to start the map, never logged) ---------- */

const userLayer = L.layerGroup().addTo(map);
const USER_DOT_RADIUS = 9;

function renderUserPosition() {
  userLayer.clearLayers();
  const position = state.ui.userPosition;
  if (!position || state.session.role !== "passenger") return;
  const [lat, lng, accuracy] = position;
  if (accuracy && accuracy < 400) {
    L.circle([lat, lng], { radius: accuracy, color: "#2f6df6", weight: 1, opacity: 0.5, fillColor: "#2f6df6", fillOpacity: 0.12, interactive: false }).addTo(userLayer);
  }
  L.marker([lat, lng], {
    icon: L.divIcon({ className: "pin-shell", html: '<div class="user-dot"></div>', iconSize: [0, 0], iconAnchor: [0, 0] }),
    interactive: false,
    keyboard: false,
  }).addTo(userLayer);
}

function centreMapOnUserPosition(position, options = {}) {
  const zoom = options.zoom || 17;
  const locationPoint = map.project([position[0], position[1]], zoom);
  const mapSize = map.getSize();
  const gpsMarkerPoint = pinPoint().add(L.point(0, USER_DOT_RADIUS));
  const viewportCentre = L.point(mapSize.x / 2, mapSize.y / 2);
  const adjustedCentre = locationPoint.add(viewportCentre.subtract(gpsMarkerPoint));
  map.setView(map.unproject(adjustedCentre, zoom), zoom, { animate: options.animate === true });
}

function requestUserPosition(options = {}) {
  const { recenter = true, manual = false } = options;
  if (state.session.role !== "passenger") return;
  if (!navigator.geolocation) {
    log("geolocation_result", { status: "unavailable", manual });
    if (manual) showToast("Location unavailable", "This browser does not offer location services.");
    return;
  }
  state.ui.gpsAttempted = true;
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const coords = [Number(position.coords.latitude.toFixed(5)), Number(position.coords.longitude.toFixed(5)), Math.round(position.coords.accuracy || 0)];
      const inside = inBounds([coords[0], coords[1]]);
      state.ui.userPosition = inside ? coords : [...DEFAULT_GPS_POSITION, 0];
      renderUserPosition();
      log("geolocation_result", { status: "granted", inside_area: inside, accuracy_band: coords[2] < 50 ? "under_50m" : coords[2] < 200 ? "under_200m" : "over_200m", manual });
      if (!inside) {
        showToast("Outside the study area", "Showing Hungry Jack's on Queen Street instead of your location.");
      }
      if (recenter) centreMapOnUserPosition(state.ui.userPosition, { animate: manual });
      persist();
    },
    (error) => {
      const status = error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable";
      log("geolocation_result", { status, manual });
      if (manual) showToast("Location not available", status === "denied" ? "Location permission was refused." : "Could not get a position. Drag the map instead.");
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
  );
}

/* ---------- Bottom sheet ---------- */

const SHEET_LEVELS = { peek: 0.38, half: 0.6, full: 0.92 };
const SHEET_TRANSITION_MS = 240;
let sheetLevel = "half";
let dragging = null;

function setSheet(level) {
  sheetLevel = level;
  const phoneHeight = $("#phone").clientHeight;
  const sheetHeight = Math.round(phoneHeight * SHEET_LEVELS[level]);
  $("#sheet").style.height = `${sheetHeight}px`;
  $("#phone").style.setProperty("--sheet-height", `${sheetHeight}px`);
  window.setTimeout(() => map.invalidateSize(), SHEET_TRANSITION_MS);
}

function expandLocateSheet(via) {
  const wasExpanded = state.ui.locateExpanded;
  state.ui.locateExpanded = true;
  if (!wasExpanded) log("search_opened", { from: "locate", via });
  render();
  setSheet("full");
}

function collapseLocateSheet() {
  state.ui.locateExpanded = false;
  render();
  setSheet("peek");
}

function initSheetDrag() {
  const handle = $("#sheet-handle");
  const sheet = $("#sheet");
  handle.addEventListener("pointerdown", (event) => {
    dragging = { startY: event.clientY, startHeight: sheet.getBoundingClientRect().height, moved: false };
    sheet.classList.add("dragging");
    $("#phone").classList.add("sheet-dragging");
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const delta = dragging.startY - event.clientY;
    if (Math.abs(delta) > 4) dragging.moved = true;
    const phoneHeight = $("#phone").clientHeight;
    const next = Math.min(phoneHeight * 0.95, Math.max(phoneHeight * 0.2, dragging.startHeight + delta));
    sheet.style.height = `${next}px`;
    $("#phone").style.setProperty("--sheet-height", `${next}px`);
  });
  const finish = () => {
    if (!dragging) return;
    const phoneHeight = $("#phone").clientHeight;
    const ratio = sheet.getBoundingClientRect().height / phoneHeight;
    const isLocateSheet = state.session.role === "passenger" && state.ui.screen === "locate";
    sheet.classList.remove("dragging");
    $("#phone").classList.remove("sheet-dragging");
    if (!dragging.moved) {
      if (isLocateSheet && state.ui.locateExpanded) collapseLocateSheet();
      else if (isLocateSheet) expandLocateSheet("sheet_handle");
      else setSheet(sheetLevel === "full" ? "half" : "full");
    } else {
      const nearest = Object.entries(SHEET_LEVELS).sort((a, b) => Math.abs(a[1] - ratio) - Math.abs(b[1] - ratio))[0][0];
      if (isLocateSheet && nearest === "peek") collapseLocateSheet();
      else if (isLocateSheet) expandLocateSheet("sheet_drag");
      else setSheet(nearest);
    }
    dragging = null;
  };
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("keydown", (event) => {
    const isLocateSheet = state.session.role === "passenger" && state.ui.screen === "locate";
    if (event.key === "ArrowUp") {
      if (isLocateSheet) expandLocateSheet("keyboard");
      else setSheet("full");
    }
    if (event.key === "ArrowDown") {
      if (isLocateSheet) collapseLocateSheet();
      else setSheet("peek");
    }
  });
}

/* ---------- Templates ---------- */

function statusCard(spot, options = {}) {
  const explain = options.explain !== false;
  if (!validCoords(spot.coordinates)) {
    return `
      <div class="status-card caution">
        <span class="status-icon"><i data-lucide="map-pin-off"></i></span>
        <div>
          <p class="status-label">Location unavailable</p>
          <p class="status-reason">The pin has no usable location data. Ask the facilitator to reset the scenario.</p>
        </div>
      </div>`;
  }
  return `
    <div class="status-card ${spot.status}">
      <span class="status-icon"><i data-lucide="${statusIcon(spot.status)}"></i></span>
      <div>
        <p class="status-label">${STATUS_LABEL[spot.status]}</p>
        ${explain ? `<p class="status-reason">${escapeHtml(spot.reason)}</p>` : ""}
        ${explain && spot.validity ? `<p class="status-validity"><i data-lucide="calendar-clock"></i>${escapeHtml(spot.validity)}</p>` : ""}
        <p class="status-meta"><i data-lucide="badge-check"></i>${escapeHtml(freshnessText(spot))}</p>
        <p class="status-source">Source: ${sourceText(spot)}</p>
      </div>
    </div>`;
}

function statusTag(spot) {
  return `<span class="tag ${spot.status}">${STATUS_LABEL[spot.status]}</span>`;
}

function passengerPickupTemplate(spot) {
  const ui = state.ui;
  const scenario = state.scenario;
  const explain = scenario.variant !== "unexplained";
  const suggestionsMode = scenario.suggestions;
  const suitable = spot.status === "suitable" && validCoords(spot.coordinates);
  const showSuggestions = suggestionsMode !== "none" && !suitable && validCoords(spot.coordinates);
  const alternatives = showSuggestions ? alternativesFor(spot) : [];
  const chosen = getSpot(ui.chosenAlternativeId);

  const pressure = scenario.pressure
    ? `<div class="late-banner">
        <i data-lucide="alarm-clock"></i>
        <div><strong>You're running late</strong><span>Driver arrives in <b id="countdown">${countdownText()}</b></span></div>
      </div>`
    : "";

  const suggestionCards = alternatives
    .map(
      ({ spot: alt, walk }) => `
        <button class="option-card ${chosen && chosen.id === alt.id ? "is-chosen" : ""}" type="button" data-alt="${alt.id}">
          <span class="option-main">
            <strong>${escapeHtml(alt.name)}</strong>
            <span class="option-tags">${statusTag(alt)}<span class="tag">${alt.stepFree ? "Step-free" : "Stairs nearby"}</span></span>
            ${explain ? `<span class="option-reason">${escapeHtml(alt.reason)}</span>` : ""}
          </span>
          <span class="option-meta"><strong>${walk ?? "?"} min walk</strong><span>Driver ${alt.driverEta} min</span></span>
        </button>`,
    )
    .join("");

  const suggestions = showSuggestions
    ? `
      <section class="suggestions">
        <button class="section-toggle" type="button" id="toggle-suggestions" aria-expanded="${ui.suggestionsOpen}">
          <span><strong>Suggested pickup spots</strong><small>${alternatives.length} nearby</small></span>
          <i data-lucide="chevron-${ui.suggestionsOpen ? "up" : "down"}"></i>
        </button>
        ${
          ui.suggestionsOpen
            ? `<label class="toggle-row"><span>Step-free only</span><input type="checkbox" id="step-free" ${ui.stepFreeOnly ? "checked" : ""} /></label>
               <div class="option-list">${suggestionCards || '<p class="muted">No spots match this filter.</p>'}</div>`
            : ""
        }
      </section>`
    : "";

  let primary = "";
  if (suitable || suggestionsMode === "none") {
    primary = `<button class="button primary" type="button" id="confirm-pin"><i data-lucide="check"></i>Confirm pickup here</button>`;
  } else if (chosen) {
    primary = `<button class="button primary" type="button" id="confirm-alternative"><i data-lucide="check"></i>Confirm ${escapeHtml(chosen.name)}</button>`;
  } else if (!ui.suggestionsOpen) {
    primary = `<button class="button primary" type="button" id="open-suggestions"><i data-lucide="waypoints"></i>See suggested pickup spots</button>`;
  } else {
    primary = `<button class="button primary" type="button" disabled>Choose a pickup spot</button>`;
  }

  const keepPin =
    suggestionsMode === "full" && !suitable && !ui.overridePending
      ? `<button class="button text" type="button" id="keep-pin">Keep my pin anyway<i data-lucide="chevron-right"></i></button>`
      : "";

  const override = ui.overridePending
    ? `
      <div class="override-box">
        <i data-lucide="shield-alert"></i>
        <div>
          <strong>${STATUS_LABEL[spot.status]} at ${escapeHtml(spot.name)}</strong>
          ${explain ? `<span>${escapeHtml(spot.reason)}</span>` : ""}
          <span>The driver may not be able to stop here. Keep this pin?</span>
        </div>
        <div class="row two">
          <button class="button secondary" type="button" id="override-cancel">Go back</button>
          <button class="button primary" type="button" id="override-confirm">Keep my pin</button>
        </div>
      </div>`
    : "";

  return `
    ${pressure}
    <header class="sheet-header">
      <p class="eyebrow">Confirm your pickup spot</p>
      <h1>${escapeHtml(spot.name)}</h1>
      <p class="muted">${escapeHtml(spot.address)}</p>
    </header>
    ${statusCard(spot, { explain })}
    ${suggestions}
    <div class="actions">
      ${primary}
      ${keepPin}
      ${override}
      <button class="button ghost" type="button" id="open-report"><i data-lucide="flag"></i>Report a problem here</button>
    </div>`;
}

function passengerConfirmedTemplate(spot) {
  const ui = state.ui;
  const chosen = getSpot(ui.chosenAlternativeId) || spot;
  const moved = chosen.id !== spot.id;
  const walk = moved ? walkFor(chosen, spot) : null;
  const note = moved
    ? `<p class="muted small"><i data-lucide="footprints"></i>${walk ? `${walk} min walk from ${escapeHtml(spot.name)}` : `Moved from ${escapeHtml(spot.name)}`}</p>`
    : chosen.status !== "suitable"
      ? `<p class="warn small"><i data-lucide="info"></i>${DRIVER_NAME} has been told this spot is ${STATUS_LABEL[chosen.status].toLowerCase()}.</p>`
      : "";
  if (ui.completed) {
    return `
      <header class="sheet-header">
        <p class="eyebrow">Session complete</p>
        <h1>Thanks</h1>
        <p class="muted">Please hand the device back to the facilitator.</p>
      </header>`;
  }
  return `
    <header class="sheet-header">
      <p class="eyebrow">Pickup confirmed</p>
      <h1>${escapeHtml(chosen.name)}</h1>
      <p class="muted">${escapeHtml(chosen.address)}</p>
    </header>
    ${statusCard(chosen)}
    <div class="driver-card">
      <span class="avatar">${DRIVER_NAME[0]}</span>
      <div>
        <strong>${DRIVER_NAME} is heading to ${escapeHtml(chosen.name)}</strong>
        <span>Arriving in ${chosen.driverEta} min · White Toyota Camry · 123 ABC</span>
      </div>
    </div>
    ${note}
    <div class="actions">
      <button class="button primary" type="button" id="done"><i data-lucide="check"></i>Done</button>
      <button class="button ghost" type="button" id="open-report"><i data-lucide="flag"></i>Report a problem here</button>
    </div>`;
}

function driverKnownSpotsTemplate() {
  const rows = state.spots
    .slice()
    .sort((a, b) => (a.addedBy === "driver" ? -1 : 0) - (b.addedBy === "driver" ? -1 : 0))
    .map(
      (spot) => `
        <button class="spot-row ${state.ui.driverInspectId === spot.id ? "is-active" : ""}" type="button" data-inspect="${spot.id}">
          <span class="spot-dot ${spot.status}"></span>
          <span class="spot-main">
            <strong>${escapeHtml(spot.name)}${spot.addedBy === "driver" ? ' <em class="added">your pin</em>' : ""}</strong>
            <span>${escapeHtml(freshnessText(spot))}</span>
          </span>
          ${statusTag(spot)}
        </button>`,
    )
    .join("");
  return `<section class="known-spots"><h2>Known pickup spots</h2><div class="spot-list">${rows}</div></section>`;
}

function driverAddTemplate() {
  const query = state.ui.driverSearch.trim().toLowerCase();
  const matches = searchGazetteer(query).slice(0, 6);
  const results = matches
    .map(
      (item) => `
        <button class="result-row" type="button" data-suggest-spot="${item.spotId}" data-label="${escapeHtml(item.name)}">
          <span class="result-icon"><i data-lucide="map-pin"></i></span>
          <span><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.address)}</span></span>
        </button>`,
    )
    .join("");
  return `
    <header class="sheet-header row">
      <div>
        <p class="eyebrow">Add a pickup spot</p>
        <h1>Where is it?</h1>
      </div>
      <button class="button secondary small" type="button" id="driver-add-cancel">Cancel</button>
    </header>
    <div class="search-field">
      <i data-lucide="search"></i>
      <input id="driver-search" type="search" placeholder="Search a place or street" value="${escapeHtml(state.ui.driverSearch)}" autocomplete="off" />
    </div>
    <div class="result-block">${results || '<p class="muted">No matches. Tap the map instead.</p>'}</div>
    <p class="muted small"><i data-lucide="map-pin-plus"></i>Or tap the map where the pickup spot is.</p>`;
}

function driverTemplate() {
  const ui = state.ui;
  const scenario = state.scenario;
  if (ui.driverAddMode) return driverAddTemplate();
  const pin = selectedSpot() || getSpot(scenario.presetSpot);
  const alternative = getSpot(ui.chosenAlternativeId) || getSpot(scenario.alternativeSpot);
  const screen = scenario.driverScreen;
  const target = screen === "accepted-alternative" ? alternative : pin;
  const eyebrow = { request: "New pickup request", "accepted-alternative": "Pickup updated", "kept-pin": "Pickup warning" }[screen];

  let banner = "";
  if (screen === "accepted-alternative") {
    banner = `<div class="notice good"><i data-lucide="route"></i><div><strong>${PASSENGER_NAME} moved the pickup to ${escapeHtml(alternative.name)}</strong><span>Previously ${escapeHtml(pin.name)}. ${walkFor(alternative, pin) ?? 3} min walk for the passenger.</span></div></div>`;
  } else if (screen === "kept-pin") {
    banner = `<div class="notice warn"><i data-lucide="shield-alert"></i><div><strong>${PASSENGER_NAME} kept ${escapeHtml(pin.name)} despite the warning</strong><span>You may need to ask for a relocation before you arrive.</span></div></div>`;
  }

  const suggested = getSpot(ui.driverSuggested);
  const suggestBlock =
    screen === "kept-pin"
      ? suggested
        ? `<div class="notice good"><i data-lucide="send"></i><div><strong>${escapeHtml(suggested.name)} sent to ${PASSENGER_NAME}</strong><span>Waiting for the passenger to accept.</span></div></div>`
        : ui.driverSuggestOpen
          ? `<div class="option-list">${alternativesFor(pin)
              .map(
                ({ spot, walk }) => `
                <button class="option-card" type="button" data-driver-suggest="${spot.id}">
                  <span class="option-main"><strong>${escapeHtml(spot.name)}</strong><span class="option-tags">${statusTag(spot)}</span><span class="option-reason">${escapeHtml(spot.reason)}</span></span>
                  <span class="option-meta"><strong>${walk ?? "?"} min walk</strong><span>You ${spot.driverEta} min</span></span>
                </button>`,
              )
              .join("")}</div>`
          : `<button class="button secondary" type="button" id="driver-suggest"><i data-lucide="waypoints"></i>Suggest a safer spot</button>`
      : "";

  return `
    <header class="sheet-header row">
      <div>
        <p class="eyebrow">${eyebrow}</p>
        <h1>Pickup for ${PASSENGER_NAME}</h1>
        <p class="muted">2 riders · Trip P-204</p>
      </div>
      <span class="avatar passenger">${PASSENGER_NAME[0]}</span>
    </header>
    ${banner}
    <p class="section-label">${escapeHtml(target.name)} · ${escapeHtml(target.address)}</p>
    ${statusCard(target)}
    <div class="eta-row">
      <div><p class="eyebrow">Your arrival</p><strong>${target.driverEta} min</strong></div>
      <div class="right"><strong>1.2 km</strong><span>via Elizabeth St</span></div>
    </div>
    <div class="actions">
      <button class="button primary" type="button" id="driver-confirm" ${ui.driverConfirmed ? "disabled" : ""}>
        <i data-lucide="${ui.driverConfirmed ? "circle-check-big" : "check"}"></i>${ui.driverConfirmed ? "Pickup plan confirmed" : "Confirm pickup plan"}
      </button>
      ${suggestBlock}
      <div class="row two">
        <button class="button secondary" type="button" id="driver-report"><i data-lucide="flag"></i>Report a condition</button>
        <button class="button secondary" type="button" id="driver-add"><i data-lucide="map-pin-plus"></i>Add a pickup spot</button>
      </div>
    </div>
    ${driverKnownSpotsTemplate()}`;
}

/* ---------- Search ---------- */

function searchGazetteer(query) {
  const spotsAsEntries = state.spots
    .filter((spot) => validCoords(spot.coordinates) && !spot.custom)
    .map((spot) => ({ name: spot.name, address: spot.address, spotId: spot.id }));
  const entries = [...GAZETTEER, ...spotsAsEntries.filter((entry) => !GAZETTEER.some((g) => g.name === entry.name))];
  if (!query) return entries;
  return entries.filter((entry) => `${entry.name} ${entry.address}`.toLowerCase().includes(query));
}

function renderSearch() {
  const input = $("#search-input");
  const query = input.value.trim().toLowerCase();
  const results = searchGazetteer(query).slice(0, 8);
  $("#search-results").innerHTML = results
    .map((item) => {
      const spot = getSpot(item.spotId);
      const km = spot && validCoords(spot.coordinates) ? (distanceMetres(CBD_CENTER, spot.coordinates) / 1000).toFixed(1) : "?";
      return `
        <li>
          <button type="button" data-result="${item.spotId}" data-label="${escapeHtml(item.name)}">
            <span class="result-icon"><i data-lucide="${query ? "map-pin" : "clock-3"}"></i><small>${km} km</small></span>
            <span class="result-copy"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.address)}</span></span>
          </button>
        </li>`;
    })
    .join("");
  $$("[data-result]").forEach((button) => {
    button.addEventListener("click", () => placePin(button.dataset.result, button.dataset.label, "search"));
  });
  refreshIcons();
}

/* ---------- Actions ---------- */

function placePin(spotId, label, entry) {
  const spot = getSpot(spotId);
  if (!spot) return;
  const ui = state.ui;
  ui.selectedSpotId = spot.id;
  ui.searchLabel = label || spot.name;
  ui.screen = "pickup";
  ui.locateExpanded = false;
  ui.chosenAlternativeId = null;
  ui.overridePending = false;
  ui.suggestionsOpen = Boolean(state.scenario.suggestionsExpanded);
  ui.completed = false;
  log("pin_placed", { spot_id: spot.id, search_label: ui.searchLabel, entry, coordinates: spot.coordinates });
  render();
  focusSpot(spot, 17);
  setSheet("half");
}

function chooseAlternative(spotId) {
  const spot = getSpot(spotId);
  const origin = selectedSpot();
  if (!spot || !origin) return;
  state.ui.chosenAlternativeId = spot.id;
  state.ui.overridePending = false;
  log("alternative_selected", { spot_id: spot.id, walk_minutes: walkFor(spot, origin), driver_eta_minutes: spot.driverEta });
  render();
  focusPair(origin, spot);
}

function confirmPickup(outcome) {
  const ui = state.ui;
  const origin = selectedSpot();
  const chosen = outcome === "alternative" ? getSpot(ui.chosenAlternativeId) : origin;
  if (!chosen) return;
  if (outcome !== "alternative") ui.chosenAlternativeId = null;
  ui.screen = "confirmed";
  ui.overridePending = false;
  const walk = outcome === "alternative" ? walkFor(chosen, origin) : 0;
  log("confirmed", { chosen_spot_id: chosen.id, outcome, walk_minutes: walk, status: chosen.status });
  log("scenario_completed", { outcome: outcome === "alternative" ? "alternative" : "original" });
  render();
  focusPair({ coordinates: DRIVER_POSITION }, chosen);
  setSheet("half");
  showToast(
    outcome === "alternative" ? "Pickup updated" : "Pickup confirmed",
    outcome === "override" ? `${DRIVER_NAME} has been told about the pickup status.` : `${DRIVER_NAME} can see ${chosen.name}.`,
  );
}

function countdownText() {
  const ui = state.ui;
  const total = state.scenario.countdownSeconds || 240;
  if (!ui.countdownStartedAt) return formatSeconds(total);
  const elapsed = Math.floor((Date.now() - new Date(ui.countdownStartedAt).getTime()) / 1000);
  const remaining = total - elapsed;
  return remaining > 0 ? formatSeconds(remaining) : "now";
}

function formatSeconds(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

window.setInterval(() => {
  const el = $("#countdown");
  if (el) el.textContent = countdownText();
}, 1000);

/* ---------- Report dialog ---------- */

let reportContext = null;

function openReport(context) {
  reportContext = context;
  const dialog = $("#report-dialog");
  const spot = context.spotId ? getSpot(context.spotId) : null;
  const pending = context.pending ? state.ui.driverPending : null;
  const suggest = context.mode === "suggest";
  $("#report-eyebrow").textContent = suggest ? "Add a pickup spot" : "Report a condition";
  $("#report-title").textContent = suggest ? "What is this spot like?" : "What is happening here?";
  $("#report-location").textContent = pending
    ? `${pending.name} · ${pending.coordinates[0].toFixed(4)}, ${pending.coordinates[1].toFixed(4)}`
    : spot
      ? `${spot.name}, ${spot.address}`
      : "";
  const nameField = $("#report-name-field");
  nameField.hidden = !pending;
  $("#report-name").value = "";
  $("#report-name").placeholder = pending ? `For example, ${pending.name}` : "";
  const options = REPORT_REASONS.filter((reason) => !reason.driverOnly || context.actor === "driver");
  const defaultValue = suggest ? "Good pickup spot" : options.find((reason) => !reason.driverOnly).value;
  $("#report-options").innerHTML = options
    .map(
      (reason) => `
        <label>
          <input type="radio" name="report-reason" value="${escapeHtml(reason.value)}" ${reason.value === defaultValue ? "checked" : ""} />
          <span><i data-lucide="${reason.icon}"></i>${escapeHtml(reason.value)}</span>
        </label>`,
    )
    .join("");
  $("#report-note").value = "";
  $("#report-submit").textContent = suggest ? "Save this spot" : "Submit report";
  refreshIcons();
  log("report_opened", { actor: context.actor, spot_id: spot ? spot.id : null, mode: context.mode });
  $("#dialog-backdrop").hidden = false;
  dialog.show();
  const firstInput = pending ? $("#report-name") : $("#report-options input:checked");
  if (firstInput) firstInput.focus();
}

function closeReport(cancelled) {
  const dialog = $("#report-dialog");
  if (dialog.open) dialog.close();
  $("#dialog-backdrop").hidden = true;
  if (cancelled && reportContext) {
    log("report_cancelled", { actor: reportContext.actor, spot_id: reportContext.spotId || null });
    if (reportContext.pending) {
      state.ui.driverPending = null;
      render();
    }
  }
  reportContext = null;
}

function handleReportSubmit(event) {
  event.preventDefault();
  if (!reportContext) return;
  const reason = new FormData(event.currentTarget).get("report-reason");
  const note = $("#report-note").value.trim();
  const actor = reportContext.actor;
  const report = { reason, note, actor, at: new Date().toISOString() };
  let spot;

  if (reportContext.pending && state.ui.driverPending) {
    const pending = state.ui.driverPending;
    const typedName = $("#report-name").value.trim();
    const nearest = nearestSpot(pending.coordinates);
    spot = {
      id: `driver-${Date.now()}`,
      name: typedName || pending.name,
      address: "Placed by a driver",
      coordinates: pending.coordinates,
      status: reasonStatus(reason),
      state: "temporary",
      reason: reasonSentence(reason, note),
      reportCount: 1,
      ageText: "just now",
      driverEta: nearest ? nearest.spot.driverEta : 5,
      stepFree: true,
      reports: [report],
      addedBy: "driver",
      lastReporter: "driver",
      updatedAt: report.at,
    };
    state.spots.push(spot);
    state.ui.driverPending = null;
    state.ui.driverAddMode = false;
    state.ui.driverInspectId = spot.id;
    log("state_transition", {
      spot_id: spot.id,
      from_status: "reported",
      to_status: "temporary",
      previous_state: null,
      display_before: null,
      display_after: spot.status,
      trigger: "report",
      triggered_by: actor,
    });
    log("spot_suggested", { spot_id: spot.id, name: spot.name, coordinates: spot.coordinates, reason, new_pin: true });
  } else {
    spot = getSpot(reportContext.spotId);
    if (!spot) return closeReport(false);
    const previous = spot.state;
    const ok = transition(spot.id, "report", actor, { report });
    if (!ok) return closeReport(false);
    if (actor === "driver" && reason === "Good pickup spot") {
      log("spot_suggested", { spot_id: spot.id, name: spot.name, coordinates: spot.coordinates, reason, new_pin: false, previous_state: previous });
    }
    if (state.ui.driverAddMode) state.ui.driverAddMode = false;
  }

  log("report_submitted", { spot_id: spot.id, reason, note_present: Boolean(note), actor });
  if (state.scenario.id === "R1-C") log("scenario_completed", { outcome: "report" });
  reportContext = null;
  $("#report-dialog").close();
  $("#dialog-backdrop").hidden = true;
  render();
  showToast("Report shared", `${spot.name} is now marked as temporary until other drivers verify it.`);
}

/* ---------- Facilitator ---------- */

let facilitatorTaps = [];

function openFacilitator(open = true) {
  $("#facilitator").hidden = !open;
  if (open) renderFacilitator();
}

function facilitatorSelectedScenario() {
  return getScenario($("#fac-scenario").value);
}

function loadScenario(scenarioId, participantId, variant, orderPosition, options = {}) {
  const scenario = getScenario(scenarioId);
  state.scenario = scenario;
  state.session = {
    participantId: participantId || state.session.participantId || "P00",
    role: scenario.role,
    scenarioId: scenario.id,
    variant: scenario.role === "passenger" ? variant || scenario.variant : "n/a",
    orderPosition: Number(orderPosition) || 1,
    useGps: state.session.useGps !== false,
  };
  resetSpotsForScenario();
  log("scenario_started", {
    scenario_id: scenario.id,
    role: scenario.role,
    entry: scenario.entry,
    suggestions: scenario.suggestions,
    variant: state.session.variant,
    pressure: scenario.pressure,
    countdown_seconds: scenario.pressure ? scenario.countdownSeconds : null,
    driver_screen: scenario.role === "driver" ? scenario.driverScreen : null,
    reset: Boolean(options.reset),
  });
  if (scenario.role === "passenger" && scenario.entry === "preset") {
    placePin(scenario.presetSpot, getSpot(scenario.presetSpot).name, "preset");
  } else {
    render();
    if (scenario.role === "driver") {
      focusPair({ coordinates: DRIVER_POSITION }, selectedSpot());
      setSheet("half");
    } else {
      map.setView(CBD_CENTER, 16);
      setSheet("peek");
      if (state.session.useGps) requestUserPosition({ recenter: true });
    }
  }
}

function switchView(role) {
  if (role === state.session.role) return;
  state.session.role = role;
  const ui = state.ui;
  ui.driverAddMode = false;
  ui.driverPending = null;
  ui.overridePending = false;
  if (role === "driver") {
    ui.screen = "driver";
    if (!ui.selectedSpotId) ui.selectedSpotId = state.scenario.presetSpot;
  } else {
    ui.screen = ui.selectedSpotId ? "pickup" : "locate";
    ui.locateExpanded = false;
    ui.suggestionsOpen = true;
  }
  log("view_switched", { view: role, spot_id: ui.selectedSpotId });
  render();
  const selected = selectedSpot();
  if (role === "driver") focusPair({ coordinates: DRIVER_POSITION }, selected);
  else if (selected) focusSpot(selected, 17);
  setSheet("half");
}

function resetSpotsForScenario() {
  const scenario = state.scenario;
  state.spots = cloneFixture();
  state.ui = defaultUi();
  if (scenario.role === "driver") {
    state.ui.screen = "driver";
    state.ui.selectedSpotId = scenario.presetSpot;
    if (scenario.driverScreen === "accepted-alternative") state.ui.chosenAlternativeId = scenario.alternativeSpot;
  } else {
    state.ui.screen = scenario.entry === "preset" ? "pickup" : "locate";
    state.ui.selectedSpotId = scenario.entry === "preset" ? scenario.presetSpot : null;
    state.ui.suggestionsOpen = Boolean(scenario.suggestionsExpanded);
  }
}

function renderFacilitator() {
  const panel = $("#facilitator");
  if (panel.hidden) return;
  const select = $("#fac-scenario");
  if (!select.options.length) {
    select.innerHTML = Object.keys(SCENARIOS)
      .map((id) => `<option value="${id}">${id} · ${escapeHtml(SCENARIOS[id].label)}</option>`)
      .join("");
    select.value = state.scenario.id;
    $("#fac-variant").value = state.session.variant === "unexplained" ? "unexplained" : "explained";
    $("#fac-order").value = String(state.session.orderPosition || 1);
    $("#fac-pid").value = state.session.participantId;
    $("#fac-gps").checked = state.session.useGps !== false;
    $("#fac-break").innerHTML = BREAK_CONDITIONS.map((condition) => `<option value="${condition}">${condition}</option>`).join("");
  }
  const chosen = facilitatorSelectedScenario();
  $("#fac-task").textContent = chosen.task || "";
  $("#fac-variant").disabled = chosen.role !== "passenger";
  $("#fac-session-summary").textContent =
    `Active: ${state.session.participantId} · ${state.session.role} · ${state.scenario.id} · ${state.session.variant} · order ${state.session.orderPosition}`;
  $("#fac-switch").textContent = state.session.role === "driver" ? "Show passenger view (keep spots)" : "Show driver view (keep spots)";

  $("#fac-spots").innerHTML = state.spots
    .map(
      (spot) => `
        <div class="fac-spot">
          <div class="fac-spot-copy">
            <strong>${escapeHtml(spot.name)}</strong>
            <span>${spot.state} · ${STATUS_LABEL[spot.status]}${validCoords(spot.coordinates) ? "" : " · no location"}</span>
          </div>
          <div class="fac-spot-actions">
            <button type="button" data-fac="verify" data-spot="${spot.id}" ${spot.state === "temporary" ? "" : "disabled"}>Verify</button>
            <select data-fac-status="${spot.id}" aria-label="Corrected status" ${spot.state === "verified" ? "" : "disabled"}>
              <option value="suitable">suitable</option>
              <option value="caution">caution</option>
              <option value="blocked">not recommended</option>
            </select>
            <button type="button" data-fac="correct" data-spot="${spot.id}" ${spot.state === "verified" ? "" : "disabled"}>Correct</button>
            <button type="button" data-fac="expire" data-spot="${spot.id}" ${spot.state === "expired" ? "disabled" : ""}>Expire</button>
          </div>
        </div>`,
    )
    .join("");
  $$("[data-fac]").forEach((button) => {
    button.addEventListener("click", () => {
      const spotId = button.dataset.spot;
      const action = button.dataset.fac;
      const extra = action === "correct" ? { status: $(`[data-fac-status="${spotId}"]`).value } : {};
      transition(spotId, action, "facilitator", extra);
    });
  });

  $("#fac-log-count").textContent = `${EventLog.count()} events stored on this device.`;
  $("#fac-log-tail").innerHTML = EventLog.all()
    .slice(-8)
    .reverse()
    .map((entry) => `<li><b>${escapeHtml(entry.event)}</b> <span>${entry.timestamp.slice(11, 19)}</span> <code>${escapeHtml(JSON.stringify(entry.payload)).slice(0, 110)}</code></li>`)
    .join("");
  refreshIcons();
}

function initFacilitator() {
  $("#facilitator-close").addEventListener("click", () => openFacilitator(false));
  $("#fac-scenario").addEventListener("change", () => {
    const chosen = facilitatorSelectedScenario();
    $("#fac-variant").value = chosen.variant === "unexplained" ? "unexplained" : "explained";
    renderFacilitator();
  });
  $("#fac-gps").addEventListener("change", () => {
    state.session.useGps = $("#fac-gps").checked;
    log("gps_setting_changed", { enabled: state.session.useGps });
    render();
  });
  $("#fac-load").addEventListener("click", () => {
    loadScenario($("#fac-scenario").value, $("#fac-pid").value.trim(), $("#fac-variant").value, $("#fac-order").value);
    openFacilitator(false);
    showToast("Scenario loaded", `${state.scenario.id} for ${state.session.participantId}.`);
  });
  $("#fac-reset").addEventListener("click", () => {
    loadScenario(state.scenario.id, state.session.participantId, state.session.variant, state.session.orderPosition, { reset: true });
    renderFacilitator();
    showToast("Reset", "Spots and screen restored for this scenario. The log was kept.");
  });
  $("#fac-switch").addEventListener("click", () => {
    switchView(state.session.role === "driver" ? "passenger" : "driver");
    renderFacilitator();
    showToast("View switched", `Now showing the ${state.session.role} view with the same spots.`);
  });
  $("#fac-break-apply").addEventListener("click", () => {
    const condition = $("#fac-break").value;
    log("break_condition_applied", { condition });
    if (condition === "reload") {
      persist();
      window.location.reload();
      return;
    }
    if (condition === "bad_location_data") {
      const spot = selectedSpot() || getSpot(state.scenario.presetSpot);
      if (spot) {
        spot.coordinates = null;
        state.ui.badLocationLogged = false;
      }
      render();
    }
    renderFacilitator();
    showToast("Break condition marked", condition);
  });
  $("#fac-export-json").addEventListener("click", () => exportLog("json", false));
  $("#fac-export-csv").addEventListener("click", () => exportLog("csv", false));
  $("#fac-share").addEventListener("click", () => exportLog("json", true));
  $("#fac-clear").addEventListener("click", () => {
    if (!window.confirm("Clear the event log on this device? Export it first.")) return;
    EventLog.clear();
    renderFacilitator();
  });
  document.addEventListener("pp:log", () => {
    if (!$("#facilitator").hidden) {
      $("#fac-log-count").textContent = `${EventLog.count()} events stored on this device.`;
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      openFacilitator($("#facilitator").hidden);
    }
  });
  $("#app-badge").addEventListener("click", () => {
    const now = Date.now();
    facilitatorTaps = facilitatorTaps.filter((time) => now - time < 2500);
    facilitatorTaps.push(now);
    if (facilitatorTaps.length >= 5) {
      facilitatorTaps = [];
      openFacilitator(true);
    }
  });
}

async function exportLog(format, preferShare) {
  if (!EventLog.count()) {
    showToast("Nothing to export", "The log is empty.");
    return;
  }
  const result = await EventLog.exportAs(state.session, format, preferShare);
  const name = EventLog.filename(state.session, format === "csv" ? "csv" : "json");
  showToast(result === "shared" ? "Shared" : result === "downloaded" ? "Downloaded" : "Cancelled", name);
}

/* ---------- Render ---------- */

let lastViewSignature = "";

function render() {
  const ui = state.ui;
  const role = state.session.role;
  const sheet = $("#sheet");
  const back = $("#back-button");
  const hint = $("#add-pin-hint");

  renderMap();

  const centrePin = $("#centre-pin");
  centrePin.hidden = !(role === "passenger" && ui.screen === "locate");
  centrePin.style.top = `${pinPoint().y}px`;
  $("#locate-me").hidden = !(role === "passenger" && state.session.useGps && ui.screen === "locate" && !ui.locateExpanded);
  renderUserPosition();

  sheet.hidden = false;
  hint.hidden = !(role === "driver" && ui.driverAddMode);
  back.hidden = !((role === "passenger" && ui.screen === "pickup" && state.scenario.entry === "search") || (role === "driver" && ui.driverAddMode));
  const body = $("#sheet-body");
  if (role === "passenger" && ui.screen === "locate") {
    body.innerHTML = locateTemplate();
  } else if (role === "driver") {
    body.innerHTML = driverTemplate();
  } else if (ui.screen === "confirmed") {
    body.innerHTML = passengerConfirmedTemplate(selectedSpot());
  } else {
    body.innerHTML = passengerPickupTemplate(selectedSpot());
  }
  bindSheetHandlers();

  logRenderEvents();
  renderFacilitator();
  refreshIcons();
  persist();
}

function bindSheetHandlers() {
  const on = (selector, handler) => {
    const el = $(selector);
    if (el) el.addEventListener("click", handler);
  };
  on("#locate-search", () => {
    expandLocateSheet("search_field");
    $("#search-input").focus();
  });
  on("#collapse-plan", collapseLocateSheet);
  const searchInput = $("#search-input");
  if (searchInput) {
    searchInput.addEventListener("input", renderSearch);
    on("#search-clear", () => {
      searchInput.value = "";
      searchInput.focus();
      renderSearch();
    });
    renderSearch();
  }
  on("#locate-confirm", confirmCentre);
  on("#toggle-suggestions", () => toggleSuggestions());
  on("#open-suggestions", () => toggleSuggestions(true));
  $$("[data-alt]").forEach((button) => button.addEventListener("click", () => chooseAlternative(button.dataset.alt)));
  on("#confirm-pin", () => confirmPickup("original"));
  on("#confirm-alternative", () => confirmPickup("alternative"));
  on("#keep-pin", () => {
    state.ui.overridePending = true;
    log("override_attempted", { spot_id: state.ui.selectedSpotId });
    render();
    setSheet("full");
  });
  on("#override-cancel", () => {
    state.ui.overridePending = false;
    log("override_cancelled", { spot_id: state.ui.selectedSpotId });
    render();
  });
  on("#override-confirm", () => {
    log("override_confirmed", { spot_id: state.ui.selectedSpotId });
    confirmPickup("override");
  });
  on("#open-report", () => openReport({ mode: "report", actor: "passenger", spotId: state.ui.selectedSpotId }));
  on("#done", () => {
    state.ui.completed = true;
    log("session_done", {});
    render();
  });
  const stepFree = $("#step-free");
  if (stepFree) {
    stepFree.addEventListener("change", () => {
      state.ui.stepFreeOnly = stepFree.checked;
      log("step_free_filter", { enabled: stepFree.checked });
      render();
    });
  }

  on("#driver-confirm", () => {
    state.ui.driverConfirmed = true;
    log("driver_plan_confirmed", { spot_id: state.ui.chosenAlternativeId || state.ui.selectedSpotId });
    render();
    showToast("Plan confirmed", `${PASSENGER_NAME} will be told before you arrive.`);
  });
  on("#driver-report", () => openReport({ mode: "report", actor: "driver", spotId: state.ui.driverInspectId || state.ui.selectedSpotId }));
  on("#driver-add", () => {
    state.ui.driverAddMode = true;
    state.ui.driverSearch = "";
    log("spot_add_opened", {});
    render();
    setSheet("half");
  });
  on("#driver-add-cancel", () => {
    state.ui.driverAddMode = false;
    state.ui.driverPending = null;
    render();
  });
  on("#driver-suggest", () => {
    state.ui.driverSuggestOpen = true;
    render();
    setSheet("full");
  });
  $$("[data-driver-suggest]").forEach((button) =>
    button.addEventListener("click", () => {
      state.ui.driverSuggested = button.dataset.driverSuggest;
      state.ui.driverSuggestOpen = false;
      log("driver_suggested_relocation", { spot_id: button.dataset.driverSuggest });
      render();
      focusPair(selectedSpot(), getSpot(button.dataset.driverSuggest));
    }),
  );
  $$("[data-inspect]").forEach((button) =>
    button.addEventListener("click", () => {
      state.ui.driverInspectId = button.dataset.inspect;
      focusSpot(getSpot(button.dataset.inspect));
      render();
    }),
  );
  $$("[data-suggest-spot]").forEach((button) =>
    button.addEventListener("click", () => openReport({ mode: "suggest", actor: "driver", spotId: button.dataset.suggestSpot })),
  );
  const driverSearch = $("#driver-search");
  if (driverSearch) {
    driverSearch.addEventListener("input", () => {
      state.ui.driverSearch = driverSearch.value;
      const block = $(".result-block");
      const matches = searchGazetteer(driverSearch.value.trim().toLowerCase()).slice(0, 6);
      block.innerHTML =
        matches
          .map(
            (item) => `
            <button class="result-row" type="button" data-suggest-spot="${item.spotId}">
              <span class="result-icon"><i data-lucide="map-pin"></i></span>
              <span><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.address)}</span></span>
            </button>`,
          )
          .join("") || '<p class="muted">No matches. Tap the map instead.</p>';
      $$("[data-suggest-spot]", block).forEach((button) =>
        button.addEventListener("click", () => openReport({ mode: "suggest", actor: "driver", spotId: button.dataset.suggestSpot })),
      );
      refreshIcons();
      persist();
    });
  }
}

function toggleSuggestions(forceOpen) {
  const ui = state.ui;
  const next = forceOpen === true ? true : !ui.suggestionsOpen;
  ui.suggestionsOpen = next;
  if (next) log("alternatives_opened", { via: "sheet" });
  render();
  if (next) setSheet("full");
}

function logRenderEvents() {
  const ui = state.ui;
  const role = state.session.role;
  const scenario = state.scenario;
  let focal = null;
  if (role === "driver") {
    focal = scenario.driverScreen === "accepted-alternative" ? getSpot(ui.chosenAlternativeId) || getSpot(scenario.alternativeSpot) : selectedSpot();
  } else if (ui.screen === "confirmed") {
    focal = getSpot(ui.chosenAlternativeId) || selectedSpot();
  } else if (ui.screen === "pickup") {
    focal = selectedSpot();
  }
  if (!focal) return;

  if (!validCoords(focal.coordinates)) {
    if (!ui.badLocationLogged) {
      ui.badLocationLogged = true;
      log("error_or_exception", { message: `Spot ${focal.id} has no usable coordinates`, spot_id: focal.id });
    }
  }

  const label = validCoords(focal.coordinates) ? freshnessText(focal) : "Location unavailable";
  const signature = `${role}|${ui.screen}|${focal.id}|${focal.state}|${focal.status}|${label}|${scenario.variant}`;
  if (signature !== lastViewSignature) {
    lastViewSignature = signature;
    log("view_rendered", {
      view: role,
      screen: ui.screen,
      spot_id: focal.id,
      lifecycle_state: focal.state,
      status_displayed: focal.status,
      label_displayed: label,
      reason_displayed: role === "driver" || scenario.variant !== "unexplained" ? focal.reason : null,
    });
  }

  if (role === "passenger" && ui.screen === "pickup" && ui.statusLoggedFor !== focal.id) {
    ui.statusLoggedFor = focal.id;
    log("status_shown", {
      spot_id: focal.id,
      status: focal.status,
      freshness_label: label,
      source_label: sourceText(focal),
      reason_visible: scenario.variant !== "unexplained",
    });
    if (scenario.pressure && ui.relocationLoggedFor !== focal.id) {
      ui.relocationLoggedFor = focal.id;
      ui.countdownStartedAt = new Date().toISOString();
      const best = alternativesFor(focal)[0];
      log("relocation_shown", {
        spot_id: focal.id,
        variant: scenario.variant,
        alternative_spot_id: best ? best.spot.id : null,
        alternative_walk_minutes: best ? best.walk : null,
        countdown_start: scenario.countdownSeconds,
      });
      log("explanation_visible", { value: scenario.variant !== "unexplained" });
    }
  }
}

/* ---------- Toasts, icons, boot ---------- */

function showToast(title, message) {
  const region = $("#toast-region");
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<i data-lucide="bell-ring"></i><span><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></span>`;
  region.append(toast);
  refreshIcons();
  window.setTimeout(() => toast.remove(), 3800);
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function applyUrlParams() {
  const params = new URLSearchParams(window.location.search);
  const scenarioId = params.get("scenario");
  const facilitator = ["1", "true", "yes"].includes(String(params.get("facilitator") || "").toLowerCase());
  if (scenarioId) {
    loadScenario(
      scenarioId.toUpperCase(),
      params.get("pid") || params.get("participant") || state.session.participantId,
      params.get("variant") || getScenario(scenarioId.toUpperCase()).variant,
      params.get("order") || 1,
    );
    window.history.replaceState({}, "", window.location.pathname + (facilitator ? "?facilitator=1" : ""));
    return true;
  }
  if (params.get("pid")) {
    state.session.participantId = params.get("pid");
  }
  return false;
}

function applyGpsParam() {
  const value = new URLSearchParams(window.location.search).get("gps");
  if (value === null) return;
  state.session.useGps = !["0", "false", "off", "no"].includes(value.toLowerCase());
}

function boot() {
  initSheetDrag();
  initFacilitator();

  $("#back-button").addEventListener("click", () => {
    if (state.session.role === "driver") {
      state.ui.driverAddMode = false;
      state.ui.driverPending = null;
      render();
      return;
    }
    removeCustomPins();
    state.ui.screen = "locate";
    state.ui.locateExpanded = false;
    state.ui.selectedSpotId = null;
    state.ui.chosenAlternativeId = null;
    state.ui.overridePending = false;
    log("pin_removed", {});
    render();
    setSheet("peek");
  });
  $("#report-form").addEventListener("submit", handleReportSubmit);
  $("#report-close").addEventListener("click", () => closeReport(true));
  $("#dialog-backdrop").addEventListener("click", () => closeReport(true));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $("#report-dialog").open) closeReport(true);
  });

  window.addEventListener("error", (event) => {
    EventLog.record(state.session, "error_or_exception", { message: String(event.message || event.error || "Unknown error") });
  });
  window.addEventListener("unhandledrejection", (event) => {
    EventLog.record(state.session, "error_or_exception", { message: String((event.reason && event.reason.message) || event.reason || "Unhandled rejection") });
  });
  window.addEventListener("resize", () => {
    map.invalidateSize();
    setSheet(sheetLevel);
  });

  const restored = restore();
  applyGpsParam();
  const loadedFromUrl = applyUrlParams();
  if (!loadedFromUrl) {
    if (!restored) {
      resetSpotsForScenario();
      log("scenario_started", { scenario_id: state.scenario.id, role: state.session.role, entry: state.scenario.entry, suggestions: state.scenario.suggestions, variant: state.session.variant, pressure: false, reset: false });
    }
    render();
    const selected = selectedSpot();
    if (state.session.role === "driver") focusPair({ coordinates: DRIVER_POSITION }, selected);
    else if (selected) focusSpot(selected, 17);
    else if (state.ui.mapCenter) map.setView([state.ui.mapCenter[0], state.ui.mapCenter[1]], state.ui.mapCenter[2] || 16, { animate: false });
    else map.setView(CBD_CENTER, 16);
    if (state.session.role === "passenger" && state.ui.screen === "locate" && state.session.useGps && !state.ui.mapCenter) {
      requestUserPosition({ recenter: true });
    }
  }
  $("#locate-me").addEventListener("click", () => requestUserPosition({ recenter: true, manual: true }));
  if (["1", "true", "yes"].includes(String(new URLSearchParams(window.location.search).get("facilitator") || "").toLowerCase())) openFacilitator(true);
  setSheet(state.session.role === "passenger" && state.ui.screen === "locate" ? (state.ui.locateExpanded ? "full" : "peek") : "half");
  window.setTimeout(() => map.invalidateSize(true), 200);
}

boot();
