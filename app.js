/* Pickup Pilot. One state object, one render() that draws the map, the passenger sheet,
   the driver sheet and the facilitator panel from the same data. */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const STATE_KEY = "pp:state:study-v2";

/* ---------- State ---------- */

const state = {
  session: { participantId: "P00", role: "passenger", scenarioId: "FREE", variant: "explained", orderPosition: 1, useGps: false, mode:"study", prepared:false, id:crypto.randomUUID(), group:"A", device:navigator.userAgent },
  scenario: getScenario("FREE"),
  attempt: newAttempt(),
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
    originalChosen: false,
    overridePending: false,
    suggestionsOpen: false,
    statusDetailOpen: false,
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
  return SPOT_FIXTURE.map((spot) => ({ ...structuredClone(spot), reports: [], history: [], addedBy: null, lastReporter: null }));
}

function persist() {
  try {
    localStorage.setItem(
      STATE_KEY,
      JSON.stringify({ session: state.session, scenarioId: state.scenario.id, spots: state.spots, ui: state.ui, attempt:state.attempt, version:PROTOTYPE_VERSION }),
    );
  } catch (error) {
    /* Storage unavailable. The session still runs in memory. */
  }
}

function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STATE_KEY));
    if (!saved || (saved.version!==PROTOTYPE_VERSION && saved.version!=="passenger-study-2026-09-08-central-entrance") || !saved.session || !saved.attempt || !Array.isArray(saved.spots)) return false;
    state.session = { ...state.session, ...saved.session };
    state.scenario = getScenario(saved.scenarioId);
    configureDriverScenario(state.scenario, state.session.driverLocation);
    state.session.mode = saved.session.mode || (state.scenario.study ? "study" : "technical");
    state.session.prepared = saved.session.prepared ?? Boolean(state.scenario.study);
    state.attempt = saved.attempt;
    state.spots = saved.spots;
    if (state.scenario.study) state.session.useGps=false;
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
  trackDriverEvent(event, payload);
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

/* Walk times and the walking line start from the passenger's position when the app has one
   (device GPS, or the simulated Queen Street position outside the study area). Without a
   position, and always on the driver side, they start from the selected pin. */
function walkOrigin() {
  if (state.scenario.study) return getSpot(state.scenario.presetSpot);
  const position = state.ui.userPosition;
  if (state.session.role === "passenger" && position && validCoords([position[0], position[1]])) {
    return { id: "you", name: "where you are", coordinates: [position[0], position[1]], device: true };
  }
  return selectedSpot();
}

function walkOriginKind() {
  const origin = walkOrigin();
  return origin && origin.device ? "position" : "pin";
}

function walkFor(spot, origin = walkOrigin()) {
  const overrides = state.scenario.walkOverrides || {};
  if (overrides[spot.id]) return overrides[spot.id];
  if (!origin || !validCoords(origin.coordinates) || !validCoords(spot.coordinates)) return null;
  if (origin.id === spot.id) return 0;
  return Math.max(1, Math.ceil(distanceMetres(origin.coordinates, spot.coordinates) / WALK_METRES_PER_MINUTE));
}

function alternativesFor(spot) {
  if (!spot) return [];
  const ids=state.scenario.alternativeIds || LOCAL_ALTERNATIVES[spot.area] || [];
  return ids.map(getSpot).filter(candidate=>candidate && candidate.id!==spot.id && validCoords(candidate.coordinates))
    .map(candidate=>({spot:candidate,walk:walkFor(candidate,state.session.role==="passenger"?walkOrigin():spot)}));
}

function nearestSpot(coords) {
  let best = null;
  state.spots.forEach((spot) => {
    if (state.scenario.study && spot.area!==getSpot(state.scenario.presetSpot).area) return;
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
    spot.history ||= [];
    spot.history.push(spotSnapshot(spot));
    // History entries retain prior evidence without recursively nesting older history.
    delete spot.history[spot.history.length-1].history;
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
  if (trigger!=="expire") spot.ageText = "just now";
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

/* The pan limit extends south of the study area because the map centre sits under the bottom
   sheet (see focusSpot); without that room Leaflet clamps the view and hides the focused spot. */
function mapMaxBounds() {
  const bounds = L.latLngBounds(CBD_BOUNDS).pad(0.4);
  const height = bounds.getNorth() - bounds.getSouth();
  return bounds.extend([bounds.getSouth() - height * 0.5, bounds.getWest()]);
}

const map = L.map("map", {
  zoomControl: false,
  attributionControl: true,
  minZoom: 14,
  maxZoom: 19,
  maxBounds: mapMaxBounds(),
  maxBoundsViscosity: 0.7,
}).setView(CBD_CENTER, 16);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const markerLayer = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);

function pinIcon(spot, options = {}) {
  const eta = options.eta != null ? `<span class="pin-eta"><b>${options.eta}</b><small>${options.etaLabel || "MIN"}</small></span>` : "";
  const glyph = options.pickup ? '<span class="pin-pickup"></span>' : '<span class="pin-dot"></span>';
  const classes = ["pin", spot.status, options.pickup ? "is-pickup" : "", options.chosen ? "is-chosen" : "", options.pending ? "is-pending" : "", options.bare ? "is-bare" : ""]
    .filter(Boolean)
    .join(" ");
  const label = options.bare ? "" : `<span class="pin-label">${eta}<span class="pin-name">${escapeHtml(spot.name)}</span>${options.interactive?'<i data-lucide="chevron-right"></i>':""}</span>`;
  return L.divIcon({
    className: "pin-shell",
    html: `<div class="${classes}">${glyph}${label}</div>`,
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
  $("#map").classList.toggle("driver-map", state.session.role === "driver");
  if (state.session.role === "driver") { renderDriverMap(); return; }
  const ui = state.ui;
  const role = state.session.role;
  const selected = selectedSpot();
  const chosen = getSpot(ui.chosenAlternativeId) || getSpot(ui.driverSuggested);
  const proposed = isDriverInterview() ? getSpot(driverInterviewState().pendingId) : null;
  const activePickup = isDriverInterview() ? driverPickupTarget() : chosen || selected;
  const showStatusPins = role === "driver" || ui.screen !== "search";
  const hidePickup = role === "passenger" && ui.screen === "locate";
  /* While browsing suggestions only the original pin and its candidates are drawn.
     The passenger's active pickup carries the label; the original remains a reference dot. */
  const browsing = role === "passenger" && passengerPickupState().browsing;
  const candidateIds = browsing ? new Set(alternativesFor(selected).map((item) => item.spot.id)) : null;

  state.spots.forEach((spot) => {
    if (state.scenario.study && spot.area!==getSpot(state.scenario.presetSpot).area) return;
    if (!validCoords(spot.coordinates)) return;
    const isPickup = !hidePickup && selected && spot.id === selected.id;
    const isChosen = chosen && spot.id === chosen.id;
    const isProposed = proposed && spot.id === proposed.id;
    if (!showStatusPins && !isPickup) return;
    if (spot.custom && !isPickup) return;
    if (candidateIds && !isPickup && !candidateIds.has(spot.id)) return;
    const isActivePickup = !hidePickup && activePickup && spot.id === activePickup.id;
    const eta = role === "passenger"
      ? (isActivePickup && (walkOrigin()?.device || isChosen) ? walkFor(spot) : null)
      : (isPickup || isChosen ? spot.driverEta : null);
    const etaLabel = role === "passenger" ? "MIN WALK" : "MIN";
    const bare = (Boolean(candidateIds) && !isPickup && !isChosen)
      || (role === "passenger" && isPickup && !isActivePickup);
    const interactive=(role === "driver" && !(isDriverInterview() && driverInterviewState().mirror)) || (passengerPickupState().canOpenSuggestions && alternativesFor(selected).some(item=>item.spot.id===spot.id));
    const marker = L.marker(spot.coordinates, {
      interactive,
      icon: pinIcon(spot, { pickup: isPickup, chosen: isChosen, pending:Boolean(isProposed), eta, etaLabel, bare, interactive }),
      keyboard: false,
      zIndexOffset: isActivePickup ? 1000 : isPickup || isChosen ? 900 : 0,
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

  const showCar = role === "driver" || (!state.scenario.p4 && ui.screen === "confirmed");
  if (showCar) {
    L.marker(DRIVER_POSITION, { icon: carIcon(), keyboard: false, interactive: false }).addTo(markerLayer);
  }

  /* Passengers see one walking line, from where they are to the active pickup. Drivers have no
     passenger position, so they see the relocation between the pin and the suggested spot. */
  const walkStart = role === "passenger" ? walkOrigin() : selected;
  const walkEnd = chosen || (role === "passenger" ? selected : null);
  const showWalk = role === "driver" || ["pickup", "confirmed"].includes(ui.screen);
  if (showWalk && walkStart && walkEnd && walkStart.id !== walkEnd.id && validCoords(walkStart.coordinates) && validCoords(walkEnd.coordinates)) {
    L.polyline([walkStart.coordinates, walkEnd.coordinates], {
      color: "#ffffff",
      weight: 4,
      opacity: 0.9,
      dashArray: "6 8",
    }).addTo(routeLayer);
  }
  if (showCar && (chosen || selected)) {
    const target = isDriverInterview() ? driverPickupTarget() : chosen || selected;
    if (validCoords(target.coordinates)) {
      L.polyline([DRIVER_POSITION, target.coordinates], { color: "#ffffff", weight: 3, opacity: 0.55 }).addTo(routeLayer);
    }
  }
}

/* The map fills the phone and the sheet floats over it, so a focused spot must land in the strip
   between the top bar and the sheet rather than at the centre of the map. The strip is computed
   from the sheet level that is about to apply, so callers set the sheet before focusing. */

const FOCUS_MARGIN = 24;
const MIN_VISIBLE_MAP = 24;
const PAIR_PADDING = 28;
let mapFocus = null;

function visibleMapStrip() {
  const phone = $("#phone");
  const phoneTop = phone.getBoundingClientRect().top;
  const topBar = $("#top-bar").getBoundingClientRect().bottom - phoneTop;
  const sheetHeight = Math.round(phone.clientHeight * SHEET_LEVELS[sheetLevel]);
  return { top: Math.max(0, topBar) + FOCUS_MARGIN, bottom: phone.clientHeight - sheetHeight - FOCUS_MARGIN };
}

function focusSpot(spot, zoom = 16) {
  if (!spot || !validCoords(spot.coordinates)) return;
  mapFocus = { type: "spot", spot, zoom };
  const strip = visibleMapStrip();
  if (strip.bottom - strip.top < MIN_VISIBLE_MAP) return;
  if (state.scenario.p4) { map.setView(spot.coordinates,zoom,{animate:false}); return; }
  const size = map.getSize();
  const target = L.point(size.x / 2, (strip.top + strip.bottom) / 2);
  const centre = map.project(spot.coordinates, zoom).add(L.point(size.x / 2, size.y / 2).subtract(target));
  map.setView(map.unproject(centre, zoom), zoom, { animate: true });
}

function focusPoints(list) {
  const points = list.filter((point) => point && validCoords(point.coordinates));
  const unique = points.filter(
    (point, index) => points.findIndex((other) => other.coordinates[0] === point.coordinates[0] && other.coordinates[1] === point.coordinates[1]) === index,
  );
  if (unique.length === 0) return;
  if (unique.length === 1) return focusSpot(unique[0], 17);
  mapFocus = { type: "points", points: unique };
  if (state.scenario.p4) { map.fitBounds(L.latLngBounds(unique.map(p=>p.coordinates)),{padding:[20,20],maxZoom:17,animate:false}); return; }
  const strip = visibleMapStrip();
  if (strip.bottom - strip.top < MIN_VISIBLE_MAP) return;
  const size = map.getSize();
  map.fitBounds(L.latLngBounds(unique.map((point) => point.coordinates)), {
    paddingTopLeft: [60, strip.top + PAIR_PADDING],
    paddingBottomRight: [60, size.y - strip.bottom + PAIR_PADDING],
    maxZoom: 17,
  });
}

function focusPair(a, b) {
  focusPoints([a, b]);
}

/* Passenger view: where they are, the pin they set, the suggested spot once chosen, and the
   driver once the pickup is confirmed. */
function focusPickup() {
  const ui = state.ui;
  const selected = selectedSpot();
  const points = [walkOrigin(), selected, getSpot(ui.chosenAlternativeId)];
  if (ui.screen === "confirmed" && !state.scenario.p4) points.unshift({ coordinates: DRIVER_POSITION });
  if (passengerPickupState().browsing && selected) points.push(...alternativesFor(selected).map((item) => item.spot));
  focusPoints(points);
}

function refocusMap() {
  if (!mapFocus) return;
  if (state.session.role === "passenger" && state.ui.screen === "locate") return;
  if (mapFocus.type === "points") focusPoints(mapFocus.points);
  else focusSpot(mapFocus.spot, mapFocus.zoom);
}

function onPinTap(spotId) {
  if (!studyCanInteract()) return;
  const spot = getSpot(spotId);
  if (!spot) return;
  if (state.session.role === "driver") {
    if (state.ui.driverAddMode) {
      openReport({ mode: "suggest", actor: "driver", spotId: spot.id });
      return;
    }
    state.ui.driverInspectId = spot.id;
    if (isDriverInterview()) log("driver_spot_inspected", {spot_id:spot.id});
    focusSpot(spot);
    render();
    return;
  }
  if (state.ui.screen !== "pickup") return;
  const selected = selectedSpot();
  if (!selected || spot.id === selected.id || !passengerPickupState().canOpenSuggestions) return;
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
    reports: [],
    addedBy: "passenger",
    lastReporter: null,
    area:state.scenario.study?getSpot(state.scenario.presetSpot).area:nearest?.spot.area,
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

/* ---------- Device location (starts the map and anchors walk times; coordinates are never logged) ---------- */

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
  if (!options.animate && state.ui.screen === "locate") {
    const line = $("#locate-status");
    if (line) line.textContent = locateStatusLine(resolveCentre());
  }
}

function recenterPassengerPosition() {
  if (state.session.role !== "passenger" || state.ui.screen !== "locate") return;
  if (state.scenario.study || !state.session.useGps) {
    if (state.scenario.study) {
      checkStudyDeadline();
      if (state.attempt.status === "ended" || state.attempt.pausedAt) return;
    }
    centreMapOnUserPosition(state.ui.userPosition, { animate: true });
    log("map_recentered", { position_source: state.scenario.study ? "scenario" : "simulated" });
  } else {
    requestUserPosition({ recenter: true, manual: true });
  }
}

function requestUserPosition(options = {}) {
  if (state.scenario.study || !state.session.useGps) return;
  const requestSessionId=state.session.id;
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
      if (state.scenario.study || !state.session.useGps || requestSessionId!==state.session.id) return;
      const coords = [Number(position.coords.latitude.toFixed(5)), Number(position.coords.longitude.toFixed(5)), Math.round(position.coords.accuracy || 0)];
      const inside = inBounds([coords[0], coords[1]]);
      state.ui.userPosition = inside ? coords : [...DEFAULT_GPS_POSITION, 0];
      renderUserPosition();
      log("geolocation_result", { status: "granted", inside_area: inside, accuracy_band: coords[2] < 50 ? "under_50m" : coords[2] < 200 ? "under_200m" : "over_200m", manual });
      if (!inside) {
        showToast("Outside the study area", "Showing Hungry Jack's on Queen Street instead of your location.");
      }
      if (state.ui.screen === "locate") {
        if (recenter) centreMapOnUserPosition(state.ui.userPosition, { animate: manual });
      } else {
        render();
        focusPickup();
      }
      persist();
    },
    (error) => {
      const status = error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable";
      if (state.scenario.study || requestSessionId!==state.session.id) return;
      log("geolocation_result", { status, manual });
      if (manual) showToast("Location not available", status === "denied" ? "Location permission was refused." : "Could not get a position. Drag the map instead.");
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
  );
}

/* ---------- Bottom sheet ---------- */

const SHEET_LEVELS = { peek: 0.38, half: 0.6, study:0.82, full: 0.92 };
const SHEET_TRANSITION_MS = 240;
let sheetLevel = "half";
let dragging = null;

function setSheet(level) {
  if (state.scenario.p4 && level==="half") level="study";
  sheetLevel = level;
  const phoneHeight = $("#phone").clientHeight;
  const sheetHeight = Math.round(phoneHeight * SHEET_LEVELS[level]);
  $("#sheet").style.height = `${sheetHeight}px`;
  $("#phone").style.setProperty("--sheet-height", `${sheetHeight}px`);
  window.setTimeout(() => { map.invalidateSize(); if (state.scenario.study && state.attempt.status==="ready" && state.ui.screen==="locate") centreMapOnUserPosition(state.ui.userPosition); else refocusMap(); }, SHEET_TRANSITION_MS);
}

function snapSheet(level) {
  setSheet(level);
  refocusMap();
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
      else snapSheet(sheetLevel === "full" ? "half" : "full");
    } else {
      const nearest = Object.entries(SHEET_LEVELS).sort((a, b) => Math.abs(a[1] - ratio) - Math.abs(b[1] - ratio))[0][0];
      if (isLocateSheet && nearest === "peek") collapseLocateSheet();
      else if (isLocateSheet) expandLocateSheet("sheet_drag");
      else snapSheet(nearest);
    }
    dragging = null;
  };
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("keydown", (event) => {
    const isLocateSheet = state.session.role === "passenger" && state.ui.screen === "locate";
    if (event.key === "ArrowUp") {
      if (isLocateSheet) expandLocateSheet("keyboard");
      else snapSheet("full");
    }
    if (event.key === "ArrowDown") {
      if (isLocateSheet) collapseLocateSheet();
      else snapSheet("peek");
    }
  });
}

/* ---------- Templates ---------- */

function statusCard(spot, options = {}) {
  const explain=options.explain ?? supportingVisible();
  const compact=Boolean(options.compact);
  if (!validCoords(spot.coordinates)) return '<div class="status-card caution"><p>Location unavailable. Please tell the facilitator.</p></div>';
  const history=explain && spot.history?.length ? `<details class="evidence-history"><summary>Earlier pickup information</summary>${spot.history.map(h=>`<p>${escapeHtml(STATUS_LABEL[h.suitability])}: ${escapeHtml(h.reason)}. ${escapeHtml(h.evidence_state)}, ${escapeHtml(h.age)}; ${h.report_count} reports.</p>`).join("")}</details>`:"";
  const supporting=!explain?"":compact
    ?`<p class="status-reason">${escapeHtml(spot.reason)}</p><p class="status-meta">${escapeHtml(freshnessText(spot))} · ${escapeHtml(sourceText(spot))}</p>`
    :`<p class="status-reason">${escapeHtml(spot.reason)}</p><p class="status-meta">${escapeHtml(freshnessText(spot))}</p><p class="status-source">Source: ${escapeHtml(sourceText(spot))}</p>`;
  return `<div class="status-card ${spot.status} ${compact?"compact":""} ${state.scenario.p4?"matched-status":""}">
    <span class="status-icon"><i data-lucide="${statusIcon(spot.status)}"></i></span><div>
    <p class="status-label">${STATUS_LABEL[spot.status]}</p>
    <div class="supporting-slot">${supporting}</div>
    ${history}</div></div>`;
}
function statusTag(spot) { return `<span class="tag ${spot.status}">${STATUS_LABEL[spot.status]}</span>`; }
/* Shared by templates, map shortcuts and action handlers. */
function passengerPickupState(spot = selectedSpot()) {
 const ui=state.ui, scenario=state.scenario, a=state.attempt;
 const frozen=Boolean(scenario.study && (a.status==="ended" || a.pausedAt));
 const active=state.session.role==="passenger" && ui.screen==="pickup" && !frozen && !ui.completed;
 const valid=Boolean(spot && validCoords(spot.coordinates));
 const suitable=spot?.status==="suitable";
 const alternatives=alternativesFor(spot);
 const canSuggest=active && valid && !suitable && scenario.suggestions!=="none" && alternatives.length>0;
 const canKeep=active && valid && !suitable;
 const overriding=canKeep && ui.overridePending;
 const chosen=canSuggest ? alternatives.find(item=>item.spot.id===ui.chosenAlternativeId)?.spot || null : null;
 const originalChosen=canSuggest && !chosen && Boolean(ui.originalChosen);
 return {active,valid,suitable,alternatives,canSuggest,canKeep,overriding,chosen,originalChosen,
  browsing:canSuggest && ui.suggestionsOpen && !overriding,
  canReport:active && valid && !overriding,
  canConfirmOriginal:active && valid && suitable,
  canConfirmAlternative:Boolean(chosen && !overriding),
  canOpenSuggestions:canSuggest && !overriding};
}
function syncPassengerPickupState() {
 if (state.session.role!=="passenger" || state.ui.screen!=="pickup") return;
 const view=passengerPickupState();
 if (!view.canSuggest) { state.ui.suggestionsOpen=false; state.ui.chosenAlternativeId=null; state.ui.originalChosen=false; }
 else if (!view.chosen) state.ui.chosenAlternativeId=null;
 if (!view.canKeep) state.ui.overridePending=false;
}
function passengerPickupTemplate(spot) {
 const ui=state.ui, scenario=state.scenario, a=state.attempt;
 const view=passengerPickupState(spot);
 if (!spot) return '<header class="sheet-header"><h1>Choose a pickup location</h1><p>Go back to the map to select a pickup.</p></header>';
 const originalLabel=scenario.p4?"Your original pickup":"Confirm your pickup spot";
 const head=`<header class="sheet-header"><p class="eyebrow">${originalLabel}</p><h1>${escapeHtml(spot.name)}</h1><p class="muted">${escapeHtml(spot.address)}</p></header>${statusCard(spot)}`;
 if (!view.active || !view.valid) return head;
 if (view.overriding) {
  const message=spot.status==="unknown"?"Pickup availability here is unconfirmed. Use this pin?":"The driver may not be able to stop here. Keep this pin?";
  return `${head}<div class="override-box ${spot.status}"><i data-lucide="${spot.status==="unknown"?"circle-help":"triangle-alert"}"></i><div><strong>${STATUS_LABEL[spot.status]}</strong><div class="override-support">${supportingVisible()?escapeHtml(spot.reason):""}</div><span>${message}</span></div><div class="row two"><button class="button secondary" id="override-cancel" type="button">Go back</button><button class="button primary" id="override-confirm" type="button">${spot.status==="unknown"?"Use this pin":"Keep my pin"}</button></div></div>`;
 }
 const cards=view.alternatives.map(({spot:alt,walk})=>`<button class="option-card ${view.chosen?.id===alt.id?"is-chosen":""}" type="button" data-alt="${alt.id}" aria-pressed="${view.chosen?.id===alt.id}">
  <span class="option-main"><strong>${escapeHtml(alt.name)}</strong><span class="option-address">${escapeHtml(alt.address)}</span><span class="option-tags">${statusTag(alt)}</span>
  <span class="alternative-support">${supportingVisible()?escapeHtml(alt.reason):""}${supportingVisible()&&!scenario.p4?`<span class="alternative-evidence">${escapeHtml(freshnessText(alt))}<br>Source: ${escapeHtml(sourceText(alt))}</span>`:""}</span></span><span class="option-meta"><strong>${walk ?? "?"} min walk</strong></span></button>`).join("");
 const primary=view.canConfirmAlternative?`<button class="button primary" id="confirm-alternative" type="button">Confirm ${escapeHtml(view.chosen.name)}</button>`:view.canConfirmOriginal?'<button class="button primary" id="confirm-pin" type="button">Confirm pickup here</button>':"";
 const keep=view.canKeep?`<button class="button ${primary || view.canOpenSuggestions?"secondary":"primary"}" id="keep-pin" type="button">${spot.status==="unknown"?"Use this pickup anyway":"Keep my pin anyway"}</button>`:"";
 const note=!view.suitable && !view.canSuggest?'<p class="muted">No suggested alternatives are available. You can choose another location on the map or keep this pin.</p>':"";
 const report=view.canReport?`<button class="button ghost" id="open-report" type="button">${view.canSuggest || scenario.p4?"Report a problem at the original pickup":"Report a problem here"}</button>`:"";
 if (view.browsing) {
  const detailOpen=Boolean(ui.statusDetailOpen);
  const summary=`<button class="browse-summary" id="toggle-status-detail" type="button" aria-expanded="${detailOpen}"><span class="swatch ${spot.status}"></span><span class="browse-summary-text"><strong>${STATUS_LABEL[spot.status]}</strong><small>${escapeHtml(spot.address)}</small></span><i data-lucide="${detailOpen?"chevron-up":"chevron-down"}"></i></button>`;
  const browseHead=`<header class="sheet-header compact"><p class="eyebrow">${originalLabel}</p><h1>${escapeHtml(spot.name)}</h1></header>${summary}${detailOpen?statusCard(spot):""}`;
  const toggle=`<button class="section-toggle" id="toggle-suggestions" type="button" aria-expanded="true"><strong>Suggested pickup spots</strong><span>${view.alternatives.length} nearby</span></button>`;
  const originWalk=walkFor(spot);
  const originalCard=view.canKeep?`<button class="option-card original ${view.originalChosen?"is-chosen":""}" type="button" data-alt="${spot.id}" aria-pressed="${view.originalChosen}">
  <span class="option-main"><span class="option-eyebrow">Your original pin</span><strong>${escapeHtml(spot.name)}</strong><span class="option-tags">${statusTag(spot)}</span>
  <span class="alternative-support">${supportingVisible()?escapeHtml(spot.reason):""}${supportingVisible()&&!scenario.p4?`<span class="alternative-evidence">${escapeHtml(freshnessText(spot))}<br>Source: ${escapeHtml(sourceText(spot))}</span>`:""}</span></span><span class="option-meta"><strong>${originWalk===0?"At your pin":`${originWalk ?? "?"} min walk`}</strong></span></button>`:"";
  const browsePrimary=primary?primary:view.originalChosen&&view.canKeep?`<button class="button primary" id="keep-pin" type="button">${spot.status==="unknown"?"Use this pickup anyway":"Keep my pin anyway"}</button>`:"";
  const footer=browsePrimary||report?`<div class="browse-actions">${browsePrimary}${report}</div>`:"";
  return `<div class="browse-head">${browseHead}${toggle}</div><div class="browse-list"><div class="option-list">${cards}${originalCard}</div></div>${footer}`;
 }
 const suggest=view.canOpenSuggestions?'<button class="button primary" id="open-suggestions" type="button">See suggested pickup spots</button>':"";
 const footer=`${primary}${suggest}${keep}${report}`;
 return `<div class="sheet-scroll">${head}${note}</div>${footer?`<div class="browse-actions">${footer}</div>`:""}`;
}
function passengerConfirmedTemplate(spot) {
 const chosen=getSpot(state.ui.chosenAlternativeId)||spot;
 if (state.ui.completed) return '<header class="sheet-header"><h1>Thanks</h1><p>Please hand the device back to the facilitator.</p></header>';
 return `<header class="sheet-header"><p class="eyebrow">Pickup confirmed</p><h1>${escapeHtml(chosen.name)}</h1><p class="muted">${escapeHtml(chosen.address)}</p></header>${statusCard(chosen)}
 <p>Your pickup choice has been recorded.</p>${state.scenario.study?'<p class="muted">Please hand the device back to the facilitator.</p>':'<button class="button primary" id="done" type="button">Done</button>'}`;
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

function driverPickupTarget() {
 if (isDriverInterview()) return getSpot(driverInterviewState().activeId);
 return state.scenario.driverScreen === "accepted-alternative"
  ? getSpot(state.ui.chosenAlternativeId) || getSpot(state.scenario.alternativeSpot)
  : selectedSpot() || getSpot(state.scenario.presetSpot);
}
function canDriverSuggest() {
 const target=driverPickupTarget();
 return state.session.role==="driver" && !state.ui.driverAddMode && state.scenario.driverScreen==="kept-pin"
  && target && validCoords(target.coordinates) && target.status!=="suitable" && alternativesFor(target).length>0;
}

function driverTemplate() {
  if (isDriverInterview()) return driverInterviewTemplate();
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
    canDriverSuggest()
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
      <button class="button primary" type="button" id="driver-confirm" ${ui.driverConfirmed || !validCoords(target.coordinates) ? "disabled" : ""}>
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
  const local=state.scenario.study?entries.filter(e=>getSpot(e.spotId)?.area===getSpot(state.scenario.presetSpot).area):entries;
  const normalise=text=>text.toLowerCase().replace(/[’']/g, "");
  const matches=query?local.filter(entry=>normalise(`${entry.name} ${entry.address}`).includes(normalise(query))):local;
  return matches.filter((entry,index)=>matches.findIndex(other=>other.spotId===entry.spotId)===index);
}

function renderSearch() {
  const input = $("#search-input");
  const query = input.value.trim().toLowerCase();
  const results = searchGazetteer(query).slice(0, 8);
  $("#search-results").innerHTML = results
    .map((item) => {
      const spot = getSpot(item.spotId);
      const km = spot && validCoords(spot.coordinates) ? (distanceMetres(state.scenario.study?getSpot(state.scenario.presetSpot).coordinates:CBD_CENTER, spot.coordinates) / 1000).toFixed(1) : "?";
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

/* ---------- Back navigation ---------- */

/* The top-left back button steps out of the current layer: an open override prompt or
   suggestion list closes first, then the screen returns to the one before it. */
function canGoBack() {
  if (isDriverInterview() && driverInterviewState()?.mirror) return false;
  if (state.scenario.study && (state.attempt.status !== "running" || state.attempt.pausedAt)) return false;
  if (state.scenario.p4 && !state.ui.overridePending) return false;
  const ui = state.ui;
  if (state.session.role === "driver") return ui.driverAddMode || ui.driverSuggestOpen;
  if (ui.screen === "pickup") return true;
  if (ui.screen === "confirmed") return !ui.completed;
  return false;
}

function goBack() {
  const ui = state.ui;
  if (!canGoBack()) return;
  if (state.session.role === "driver") {
    if (ui.driverAddMode) {
      ui.driverAddMode = false;
      ui.driverPending = null;
    } else {
      ui.driverSuggestOpen = false;
    }
    ui.driverInspectId = null;
    render();
    setSheet("half");
    focusDriverMap();
    return;
  }
  if (ui.screen === "confirmed") {
    ui.screen = "pickup";
    log("confirmation_reverted", { spot_id: ui.chosenAlternativeId || ui.selectedSpotId });
    render();
    setSheet("half");
    focusPickup();
    return;
  }
  if (ui.overridePending) {
    ui.overridePending = false;
    log("override_cancelled", { spot_id: ui.selectedSpotId });
    render();
    return;
  }
  removeCustomPins();
  ui.screen = "locate";
  ui.locateExpanded = false;
  ui.selectedSpotId = null;
  ui.chosenAlternativeId = null;
  ui.originalChosen = false;
  ui.overridePending = false;
  ui.suggestionsOpen = false;
  ui.statusDetailOpen = false;
  log("pin_removed", {});
  mapFocus = null;
  render();
  setSheet("peek");
}

/* ---------- Actions ---------- */

function placePin(spotId, label, entry) {
  const spot = getSpot(spotId);
  if (!spot || (entry!=="preset" && !studyCanInteract())) return;
  const ui = state.ui;
  if (state.scenario.p4 && spot.id!==state.scenario.presetSpot) return;
  ui.selectedSpotId = spot.id;
  ui.searchLabel = label || spot.name;
  ui.screen = "pickup";
  ui.locateExpanded = false;
  ui.chosenAlternativeId = null;
  ui.originalChosen = false;
  ui.overridePending = false;
  ui.suggestionsOpen = Boolean(state.scenario.suggestionsExpanded);
  ui.statusDetailOpen = false;
  ui.completed = false;
  log("pin_placed", { spot_id: spot.id, search_label: ui.searchLabel, entry, coordinates: spot.coordinates });
  render();
  setSheet("half");
  focusPickup();
}

function chooseAlternative(spotId, via = "tap") {
  const spot = getSpot(spotId);
  const origin = selectedSpot();
  if (spot && origin && spot.id === origin.id) return chooseOriginal(via);
  if (!spot || !origin || !studyCanInteract() || !passengerPickupState().canOpenSuggestions || !alternativesFor(origin).some(a=>a.spot.id===spot.id)) return;
  if (state.ui.chosenAlternativeId === spot.id) { snapChosenCard(); return; }
  state.ui.chosenAlternativeId = spot.id;
  state.ui.originalChosen = false;
  state.ui.overridePending = false;
  log("alternative_selected", { spot_id: spot.id, walk_minutes: walkFor(spot), walk_origin: walkOriginKind(), driver_eta_minutes: spot.driverEta, via });
  render();
  snapChosenCard();
  focusPickup();
}

/* The original pin is the last card in the suggestion list; selecting it offers "Keep my pin". */
function chooseOriginal(via = "tap") {
  const origin = selectedSpot();
  const view = passengerPickupState();
  if (!origin || !studyCanInteract() || !view.canOpenSuggestions || !view.canKeep) return;
  if (view.originalChosen) { snapChosenCard(); return; }
  state.ui.originalChosen = true;
  state.ui.chosenAlternativeId = null;
  state.ui.overridePending = false;
  log("original_pin_selected", { spot_id: origin.id, walk_minutes: walkFor(origin), walk_origin: walkOriginKind(), via });
  render();
  snapChosenCard();
  focusPickup();
}

function requestPickupOverride() {
 if (!studyCanInteract() || !passengerPickupState().canKeep) return;
 state.ui.overridePending=true;
 log("override_attempted", {spot_id:state.ui.selectedSpotId});
 render(); setSheet("full");
}

function confirmPickup(outcome) {
 if (!studyCanInteract()) return;
 const ui=state.ui, origin=selectedSpot();
 const view=passengerPickupState();
 if (outcome==="original" ? !view.canConfirmOriginal : outcome==="alternative" ? !view.canConfirmAlternative : outcome==="override" ? !view.overriding : true) return;
 const chosen=outcome==="alternative"?getSpot(ui.chosenAlternativeId):origin;
 if (!chosen || !validCoords(chosen.coordinates)) return;
 if (outcome!=="alternative") ui.chosenAlternativeId=null;
 ui.originalChosen=false;
 ui.screen="confirmed"; ui.overridePending=false;
 const snapshot=spotSnapshot(chosen);
 log("confirmed",{chosen_spot_id:chosen.id,outcome,walk_minutes:walkFor(chosen),walk_origin:walkOriginKind(),chosen:snapshot,displayed:displayedSnapshot(chosen)});
 if (state.scenario.study) finishTask("confirmed",chosen,outcome==="alternative"?"accept":"override");
 else log("scenario_completed",{outcome});
 render(); setSheet("half"); focusPickup();
}

function formatSeconds(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ---------- Report dialog ---------- */

let reportContext = null;

function openReport(context) {
  if (!studyCanInteract()) return;
  if (context.actor==="passenger" && !passengerPickupState().canReport) return;
  if (context.actor==="driver" && !context.pending && !validCoords(getSpot(context.spotId)?.coordinates)) {
    showToast("Location unavailable", "Select a valid pickup point before reporting."); return;
  }
  reportContext = {...context, submissionId:crypto.randomUUID()};
  $("#report-error").textContent="";
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
  const defaultValue = null;
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
  const firstInput = pending ? $("#report-name") : $("#report-options input");
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
  if (!reportContext || !studyCanInteract()) return;
  const reason = new FormData(event.currentTarget).get("report-reason");
  const note = $("#report-note").value.trim();
  const actor = reportContext.actor;
  const report = { id:reportContext.submissionId, reason, note, actor, at: new Date().toISOString() };
  const targetId=state.ui.badReportTarget?"unknown-target":reportContext.spotId;
  state.attempt.reportAttemptCount++;
  log("report_attempted",{submission_id:report.id,spot_id:targetId,reason,note_present:Boolean(note),actor});
  const reject=(code,message)=>{ log("report_rejected",{submission_id:report.id,spot_id:targetId,code}); $("#report-error").textContent=message; };
  const allowed=REPORT_REASONS.filter(r=>!r.driverOnly || actor==="driver");
  if (!allowed.some(r=>r.value===reason)) return reject("missing_or_unsupported_category","Choose a category that matches what you observed. Use the note for extra detail.");
  if (!reportContext.pending && !getSpot(targetId)) return reject("unknown_target","This pickup location is unavailable. Close the form and choose a valid point.");
  if (state.ui.failNextReport) { state.ui.failNextReport=false; return reject("simulated_failure","The report could not be submitted. Your entries are saved here; try again."); }
  if (state.spots.some(s=>s.reports.some(r=>r.id===report.id))) return reject("duplicate_submission","This report has already been received.");
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

  state.ui.lastAcceptedReport=structuredClone(report);
  state.ui.suggestionsOpen=true;
  state.ui.lastAcceptedTarget=spot.id;
  log("report_accepted",{submission_id:report.id,spot_id:spot.id,reason,actor,chosen:spotSnapshot(spot),displayed:displayedSnapshot(spot)});
  state.attempt.reportCount++;
  if (state.scenario.p4) log("p4_report_flagged",{spot_id:spot.id});
  if (state.scenario.id==="P3" && spot.id===state.scenario.presetSpot && ["Limited access","Construction or event"].includes(reason)) {
    state.attempt.reportAccepted=true;
    log("p3_valid_obstruction_report_accepted",{spot_id:spot.id});
  }
  log("report_submitted", { spot_id: spot.id, reason, note_present: Boolean(note), actor });
  reportContext = null;
  $("#report-dialog").close();
  $("#dialog-backdrop").hidden = true;
  render();
  showToast("Report received", supportingVisible()?`${spot.name}: awaiting verification.`:"Your report has been received.");
}

/* ---------- Facilitator ---------- */

let facilitatorTaps = [];

function openFacilitator(open = true) {
  $("#facilitator").hidden = !open;
  if (!open && state.scenario.study && !state.attempt.screenRevealedAt) {
    state.attempt.screenRevealedAt=Date.now(); log("screen_revealed",{displayed:displayedSnapshot(selectedSpot())}); persist();
  }
  if (open) renderFacilitator();
}

function facilitatorSelectedScenario() {
  return getScenario($("#fac-scenario").value);
}

function loadScenario(scenarioId, participantId, variant, orderPosition, options = {}) {
  const scenario = getScenario(scenarioId);
  configureDriverScenario(scenario, options.driverLocation || state.session.driverLocation);
  if (state.scenario.study && state.attempt.status==="running") finishTask(options.reset?"reset_interrupted":"scenario_switched");
  closeReport(false);
  options = {driverLocation:state.session.driverLocation, driverContext:state.session.driverContext, ...options};
  const sameParticipant=state.session.participantId===(participantId || state.session.participantId);
  state.scenario=scenario;
  if (!scenario.study && variant && scenario.role==="passenger") scenario.variant=variant;
  state.attempt=newAttempt();
  const mode=scenario.driverInterview ? "driver" : options.mode || (state.session.mode === "driver" ? "study" : state.session.mode) || "study";
  const prepared=options.prepared ?? (["study", "driver"].includes(mode) && Boolean(scenario.study));
  state.session={participantId:participantId||state.session.participantId||"P00",role:scenario.role,scenarioId:scenario.id,variant:scenario.role==="passenger"?scenario.variant:"n/a",orderPosition:Number(orderPosition)||1,useGps:scenario.study?false:state.session.useGps,mode,prepared,id:sameParticipant && !options.newSession && mode === state.session.mode?state.session.id:crypto.randomUUID(),attemptId:state.attempt.id,attemptKind:options.reset?"retry":"initial",group:STUDY_GROUPS[options.group]?options.group:state.session.group||"A",location:scenario.location||scenario.presetSpot,device:navigator.userAgent,thinkAloud:false};
  state.session.driverLocation = options.driverLocation || state.session.driverLocation || "wendys";
  state.session.driverContext = options.driverContext || state.session.driverContext || "parked";
  if (scenario.driverInterview) { state.session.group = null; state.session.variant = "n/a"; }
  if (mode === "preview") state.attempt.status="running";
  $("#fac-end-options").hidden=true;
  lastViewSignature="";
  if ($("#fac-scenario").options.length) $("#fac-scenario").value=scenario.id;
  $("#fac-pid").value=state.session.participantId;
  $("#fac-variant").value=scenario.variant;
  $("#fac-order").value=String(state.session.orderPosition);
  $("#fac-group").value=state.session.group;
  $("#fac-preview-scenario").value=scenario.id;
  $("#fac-think-aloud").checked=false;
  $("#fac-driver-location").value=state.session.driverLocation;
  $("#fac-driver-context").value=state.session.driverContext;
  $("#fac-driver-response").value="declined";
  $("#fac-driver-branches").open=false;
  $("#fac-driver-script-details").open=false;
  $("#fac-driver-timing").open=false;
  $("#fac-driver-response-note").value="";
  $("#toast-region").innerHTML="";
  resetSpotsForScenario();
  log("scenario_loaded", {
    scenario_id: scenario.id,
    role: scenario.role,
    entry: scenario.entry,
    suggestions: scenario.suggestions,
    variant: state.session.variant,
    pressure: scenario.pressure,
    countdown_seconds: scenario.pressure ? scenario.countdownSeconds : null,
    driver_screen: scenario.role === "driver" ? scenario.driverScreen : null,
    reset: Boolean(options.reset),
    allocation_match: !scenario.p4 || STUDY_GROUPS[state.session.group]?.[state.session.orderPosition-1]===scenario.id,
    local_alternatives:alternativesFor(getSpot(scenario.presetSpot)).map(a=>({spot:spotSnapshot(a.spot),walk_minutes:a.walk})),
    gps_enabled:state.session.useGps,
    driver_location:scenario.driverInterview ? state.session.driverLocation : null,
    interview_context:scenario.driverInterview ? state.session.driverContext : null,
  });
  if (scenario.role === "passenger" && scenario.entry === "preset") {
    placePin(scenario.presetSpot, getSpot(scenario.presetSpot).name, "preset");
    if (state.session.useGps) requestUserPosition({ recenter: false });
  } else {
    render();
    if (scenario.role === "driver") {
      setSheet("half");
      focusDriverMap();
    } else {
      mapFocus = null;
      map.setView(scenario.study?getSpot(scenario.presetSpot).coordinates:CBD_CENTER, 17);
      setSheet("peek");
      if (scenario.study) centreMapOnUserPosition(state.ui.userPosition);
      else if (state.session.useGps) requestUserPosition({ recenter: true });
    }
  }
}

function switchView(role) {
  if (state.scenario.study) return;
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
  setSheet("half");
  const selected = selectedSpot();
  if (role === "driver") focusDriverMap();
  else if (selected) focusPickup();
}

function resetSpotsForScenario() {
  const scenario = state.scenario;
  state.spots = cloneFixture();
  state.ui = defaultUi();
  state.ui.userPosition=[...DEFAULT_GPS_POSITION,0];
  if (scenario.study) state.ui.userPosition=[...getSpot(scenario.presetSpot).coordinates,0];
  if (scenario.role === "driver") {
    state.ui.screen = "driver";
    state.ui.selectedSpotId = scenario.presetSpot;
    if (scenario.driverScreen === "accepted-alternative") state.ui.chosenAlternativeId = scenario.alternativeSpot;
  } else {
    state.ui.screen = scenario.entry === "preset" ? "pickup" : "locate";
    state.ui.selectedSpotId = scenario.entry === "preset" ? scenario.presetSpot : null;
    state.ui.suggestionsOpen = Boolean(scenario.suggestionsExpanded);
  }
  resetDriverInterview();
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
    $("#fac-group").value=state.session.group;
    $("#fac-preview-scenario").innerHTML=Object.keys(SCENARIOS).filter(id=>SCENARIOS[id].study && !SCENARIOS[id].driverInterview).map(id=>`<option value="${id}">${id} · ${escapeHtml(SCENARIOS[id].label)}</option>`).join("");
    $("#fac-preview-scenario").value=state.scenario.id;
    $("#fac-gps").checked = state.session.useGps !== false;
    $("#fac-break").innerHTML = BREAK_CONDITIONS.map((condition) => `<option value="${condition}">${condition}</option>`).join("");
  }
  const chosen = facilitatorSelectedScenario();
  $("#fac-task").textContent = state.scenario.task || "";
  if (state.scenario.p4 && STUDY_GROUPS[state.session.group]?.[state.session.orderPosition-1]!==state.scenario.id) $("#fac-task").textContent+=" ALLOCATION CHECK: active condition differs from assigned group/order. Load the correct task before starting.";
  $("#fac-variant").disabled = chosen.role !== "passenger" || chosen.study;
  $("#fac-order").disabled=Boolean(chosen.study);
  $("#fac-variant").closest?.(".fac-grid")?.toggleAttribute("hidden", Boolean(chosen.study));
  $("#fac-gps").closest?.("label")?.toggleAttribute("hidden", state.session.mode !== "technical");
  $("#fac-gps").disabled=Boolean(state.scenario.study);
  $("#fac-gps").checked=state.session.useGps;
  $("#fac-switch").disabled=Boolean(state.scenario.study);
  renderStudyControls();
  $("#fac-break-apply").disabled=Boolean(state.scenario.study);
  $("#fac-session-summary").textContent =
    isPreview() ? `Preview · ${state.scenario.id}` : sessionPrepared() ? `${state.session.participantId} · Group ${state.session.group} · ${state.scenario.id}` : "Session setup";
  renderDriverControls();
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
            <button type="button" data-fac="verify" data-spot="${spot.id}" ${!state.scenario.study && spot.state === "temporary" ? "" : "disabled"}>Verify</button>
            <select data-fac-status="${spot.id}" aria-label="Corrected status" ${!state.scenario.study && spot.state === "verified" ? "" : "disabled"}>
              <option value="suitable">suitable</option>
              <option value="caution">caution</option>
              <option value="blocked">not recommended</option>
            </select>
            <button type="button" data-fac="correct" data-spot="${spot.id}" ${!state.scenario.study && spot.state === "verified" ? "" : "disabled"}>Correct</button>
            <button type="button" data-fac="expire" data-spot="${spot.id}" ${state.scenario.study || spot.state === "expired" ? "disabled" : ""}>Expire</button>
          </div>
        </div>`,
    )
    .join("");
  $$("[data-fac]").forEach((button) => {
    button.addEventListener("click", () => {
      if (state.scenario.study) return;
      const spotId = button.dataset.spot;
      const action = button.dataset.fac;
      const extra = action === "correct" ? { status: $(`[data-fac-status="${spotId}"]`).value } : {};
      transition(spotId, action, "facilitator", extra);
    });
  });

  $("#fac-log-count").textContent = `${EventLog.count()} events stored on this device.${EventLog.storageWarning()?" Storage unavailable: export this session before closing the page.":""}`;
  $("#fac-log-tail").innerHTML = EventLog.all()
    .slice(-8)
    .reverse()
    .map((entry) => `<li><b>${escapeHtml(entry.event)}</b> <span>${entry.timestamp.slice(11, 19)}</span> <code>${escapeHtml(JSON.stringify(entry.payload)).slice(0, 110)}</code></li>`)
    .join("");
  refreshIcons();
}

function applyTechnicalFault() {
 if (state.scenario.study) return;
 const condition=$("#fac-break").value, spot=selectedSpot()||getSpot(state.scenario.presetSpot);
 log("break_condition_applied",{condition});
 if (condition==="reload") {persist(); window.location.reload(); return;}
 if (condition==="bad_location_data" && spot) spot.coordinates=null;
 if (condition==="report_failure") state.ui.failNextReport=true;
 if (condition==="bad_report_target") state.ui.badReportTarget=!state.ui.badReportTarget;
 if (condition==="interrupt_mid_report") closeReport(true);
 if (condition==="conflicting_reports" && spot) transition(spot.id,"report","driver",{report:{id:crypto.randomUUID(),actor:"driver",reason:"Good pickup spot",note:"Conflicting technical test observation",at:new Date().toISOString()}});
 if (condition==="duplicate_report") {
  const report=state.ui.lastAcceptedReport;
  if (report) {
   log("report_attempted",{submission_id:report.id,spot_id:state.ui.lastAcceptedTarget,reason:report.reason,technical_replay:true});
   log("report_rejected",{submission_id:report.id,spot_id:state.ui.lastAcceptedTarget,code:"duplicate_submission"});
  } else {showToast("Submit a report first","The duplicate test replays the last accepted submission ID.");return;}
 }
 render(); showToast("Technical condition applied",condition);
}
function initFacilitator() {
  $("#facilitator-close").addEventListener("click", () => openFacilitator(false));
  $("#fac-scenario").addEventListener("change", () => {
    const chosen = facilitatorSelectedScenario();
    $("#fac-variant").value = chosen.variant === "unexplained" ? "unexplained" : "explained";
    renderFacilitator();
  });
  $("#fac-gps").addEventListener("change", () => {
    state.session.useGps = state.scenario.study?false:$("#fac-gps").checked;
    log("gps_setting_changed", { enabled: state.session.useGps });
    render();
  });
  $("#fac-load").addEventListener("click", () => {
    if (timedTaskRunning()) return;
    const scenario=facilitatorSelectedScenario();
    const group=state.session.group || $("#fac-group").value;
    const order=scenario.p4 ? Math.max(1,STUDY_GROUPS[group].indexOf(scenario.id)+1) : 1;
    loadScenario(scenario.id, state.session.participantId, $("#fac-variant").value, order,{group,mode:scenario.driverInterview ? "driver" : scenario.study ? (isPreview()?"preview":"study") : "technical"});
    openFacilitator(false);
    openFacilitator(true);
  });
  $("#fac-reset").addEventListener("click", () => {
    if (timedTaskRunning()) return;
    loadScenario(state.scenario.id, state.session.participantId, state.session.variant, state.session.orderPosition, { reset: true });
    renderFacilitator();
    showToast("Reset", "Spots and screen restored for this scenario. The log was kept.");
  });
  $("#fac-switch").addEventListener("click", () => {
    switchView(state.session.role === "driver" ? "passenger" : "driver");
    renderFacilitator();
    showToast("View switched", `Now showing the ${state.session.role} view with the same spots.`);
  });
  $("#fac-break-apply").addEventListener("click",applyTechnicalFault);
  $("#fac-export-summary").addEventListener("click",()=>exportLog("summary",false));
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
      $("#fac-log-count").textContent = `${EventLog.count()} events stored on this device.${EventLog.storageWarning()?" Storage unavailable: export this session before closing the page.":""}`;
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
    if (facilitatorTaps.length >= 3) {
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
  const name = EventLog.filename(state.session, format === "summary" ? "summary.csv" : format === "csv" ? "csv" : "json");
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

  syncPassengerPickupState();
  renderMap();

  const centrePin = $("#centre-pin");
  centrePin.hidden = !(role === "passenger" && ui.screen === "locate" && !studyNotice());
  centrePin.style.top = `${pinPoint().y}px`;
  $("#locate-me").hidden = !(role === "passenger" && ui.screen === "locate" && !ui.locateExpanded && (!state.scenario.study || (state.attempt.status !== "ended" && !state.attempt.pausedAt)));
  renderUserPosition();

  sheet.hidden = false;
  hint.hidden = !(role === "driver" && ui.driverAddMode);
  back.hidden = !canGoBack();
  const body = $("#sheet-body");
  const previousList = body.querySelector(".browse-list");
  const listScroll = previousList ? previousList.scrollTop : 0;
  const notice=studyNotice();
  if (notice) { body.innerHTML=notice; }
  else if (role === "passenger" && ui.screen === "locate") {
    body.innerHTML = locateTemplate();
  } else if (role === "driver") {
    body.innerHTML = driverTemplate();
  } else if (ui.screen === "confirmed") {
    body.innerHTML = passengerConfirmedTemplate(selectedSpot());
  } else {
    body.innerHTML = passengerPickupTemplate(selectedSpot());
  }
  const list = body.querySelector(".browse-list");
  body.classList.toggle("browsing", Boolean(body.querySelector(".browse-actions")));
  if (list) list.scrollTop = listScroll;
  bindBrowseListScroll(list);
  $("#phone").classList.toggle("p4-study",Boolean(state.scenario.p4));
  bindSheetHandlers();

  logRenderEvents();
  renderFacilitator();
  refreshIcons();
  persist();
}

function bindSheetHandlers() {
  const on = (selector, handler) => {
    const el = $(selector);
    if (el) el.addEventListener("click",event=>{if (studyCanInteract()) handler(event);});
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
  on("#toggle-status-detail", toggleStatusDetail);
  on("#open-suggestions", () => toggleSuggestions(true));
  $$("[data-alt]").forEach((button) => button.addEventListener("click", () => chooseAlternative(button.dataset.alt)));
  on("#confirm-pin", () => confirmPickup("original"));
  on("#confirm-alternative", () => confirmPickup("alternative"));
  on("#keep-pin", requestPickupOverride);
  on("#override-cancel", () => {
    state.ui.overridePending = false;
    log("override_cancelled", { spot_id: state.ui.selectedSpotId });
    render();
    if (passengerPickupState().browsing) { setSheet("half"); snapChosenCard(); focusPickup(); }
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

  bindDriverInterviewHandlers(on);

  on("#driver-confirm", () => {
    if (state.ui.driverConfirmed || !validCoords(driverPickupTarget()?.coordinates)) return;
    state.ui.driverConfirmed = true;
    log("driver_plan_confirmed", { spot_id: state.ui.chosenAlternativeId || state.ui.selectedSpotId });
    render();
    showToast("Plan confirmed", `${PASSENGER_NAME} will be told before you arrive.`);
  });
  on("#driver-report", () => openReport({ mode: "report", actor: "driver", spotId: driverPickupTarget()?.id }));
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
    if (!canDriverSuggest()) return;
    state.ui.driverSuggestOpen = true;
    render();
    setSheet("full");
  });
  $$("[data-driver-suggest]").forEach((button) =>
    button.addEventListener("click", () => {
      if (!canDriverSuggest() || !alternativesFor(driverPickupTarget()).some(item=>item.spot.id===button.dataset.driverSuggest)) return;
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

/* Scroll the chosen card to the list's snap position so it sits flush at the top. */
function snapChosenCard() {
  const list = $(".browse-list");
  const card = list?.querySelector(".option-card.is-chosen");
  if (!list || !card) return;
  const padding = parseFloat(getComputedStyle(list).scrollPaddingTop) || 0;
  const top = list.scrollTop + card.getBoundingClientRect().top - list.getBoundingClientRect().top - padding;
  list.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
}
/* The card resting in the snap position is the selected one. Selection only follows
   scrolls the participant started themselves, never programmatic ones. */
let browseScrollArmed = false;
let browseScrollTimer = null;
function bindBrowseListScroll(list) {
  if (!list) return;
  const arm = () => { browseScrollArmed = true; };
  ["pointerdown", "touchstart", "wheel"].forEach((type) => list.addEventListener(type, arm, { passive: true }));
  list.addEventListener("scroll", () => {
    window.clearTimeout(browseScrollTimer);
    browseScrollTimer = window.setTimeout(() => {
      if (!browseScrollArmed) return;
      browseScrollArmed = false;
      selectSnappedCard(list);
    }, 150);
  }, { passive: true });
}
function snappedCard(list) {
  const padding = parseFloat(getComputedStyle(list).scrollPaddingTop) || 0;
  const line = list.getBoundingClientRect().top + padding;
  let best = null, bestDistance = Infinity;
  list.querySelectorAll(".option-card[data-alt]").forEach((card) => {
    const distance = Math.abs(card.getBoundingClientRect().top - line);
    if (distance < bestDistance) { best = card; bestDistance = distance; }
  });
  return best;
}
function browseSelectionId() {
  const view = passengerPickupState();
  return view.chosen?.id || (view.originalChosen ? selectedSpot()?.id : null) || null;
}
function selectSnappedCard(list) {
  if (!document.contains(list) || !passengerPickupState().browsing) return;
  const card = snappedCard(list);
  if (card && card.dataset.alt !== browseSelectionId()) chooseAlternative(card.dataset.alt, "scroll");
}
function toggleStatusDetail() {
  if (!passengerPickupState().browsing) return;
  state.ui.statusDetailOpen = !state.ui.statusDetailOpen;
  if (state.ui.statusDetailOpen) log("status_detail_opened", { spot_id: state.ui.selectedSpotId, via: "browse_summary" });
  render();
}
function toggleSuggestions(forceOpen) {
  if (!studyCanInteract() || !passengerPickupState().canOpenSuggestions) return;
  const ui = state.ui;
  const next = forceOpen === true ? true : !ui.suggestionsOpen;
  ui.suggestionsOpen = next;
  ui.statusDetailOpen = false;
  if (next) log("alternatives_opened", { via: "sheet" });
  render();
  setSheet("half");
  focusPickup();
}

function logRenderEvents() {
 if (studyNotice()) return;
 if (isDriverInterview()) {
  const snapshot=driverPassengerSnapshot();
  const signature=JSON.stringify([state.session.attemptId,snapshot,driverInterviewState().mirror,state.ui.driverInspectId,state.ui.driverSuggestOpen]);
  if (signature===lastViewSignature) return;
  lastViewSignature=signature;
  log("view_rendered",{screen:driverInterviewState().mirror?"simulated_passenger":"driver",...snapshot});
  return;
 }
 const focal=state.ui.screen==="confirmed"?(getSpot(state.ui.chosenAlternativeId)||selectedSpot()):selectedSpot();
 if (!focal || state.ui.screen==="locate") return;
 const displayed=displayedSnapshot(focal);
 const signature=JSON.stringify([state.session.attemptId,state.ui.screen,displayed,state.ui.suggestionsOpen]);
 if (signature===lastViewSignature) return;
 lastViewSignature=signature;
 log("view_rendered",{screen:state.ui.screen,displayed,underlying:spotSnapshot(focal),alternatives:passengerPickupState().browsing?alternativesFor(focal).map(a=>({spot_id:a.spot.id,status:STATUS_LABEL[a.spot.status],reason:supportingVisible()?a.spot.reason:null,walk_minutes:a.walk})):[]});
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
      {group:params.get("group") || "A",driverLocation:params.get("driverLocation") || "wendys"},
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
  initStudyControls();
  initDriverControls();

  $("#back-button").addEventListener("click", goBack);
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
    snapSheet(sheetLevel);
  });

  const restored = restore();
  applyGpsParam();
  if (state.scenario.study) state.session.useGps=false;
  const loadedFromUrl = applyUrlParams();
  if (!state.session.attemptId) state.session.attemptId=state.attempt.id;
  if (restored && !loadedFromUrl) log("session_restored",{attempt_status:state.attempt.status});
  setSheet(state.session.role === "passenger" && state.ui.screen === "locate" ? (state.ui.locateExpanded ? "full" : "peek") : "half");
  if (!loadedFromUrl) {
    if (!restored) {
      resetSpotsForScenario();
      log("scenario_started", { scenario_id: state.scenario.id, role: state.session.role, entry: state.scenario.entry, suggestions: state.scenario.suggestions, variant: state.session.variant, pressure: false, reset: false });
    }
    render();
    const selected = selectedSpot();
    if (state.session.role === "driver") focusDriverMap();
    else if (selected) focusPickup();
    else if (state.ui.mapCenter) map.setView([state.ui.mapCenter[0], state.ui.mapCenter[1]], state.ui.mapCenter[2] || 16, { animate: false });
    else map.setView(CBD_CENTER, 16);
    if (state.session.role === "passenger" && state.ui.screen === "locate" && state.session.useGps && !state.ui.mapCenter) {
      requestUserPosition({ recenter: true });
    }
  }
  $("#locate-me").addEventListener("click", recenterPassengerPosition);
  if (state.session.mode === "study" || state.scenario.study || ["1", "true", "yes"].includes(String(new URLSearchParams(window.location.search).get("facilitator") || "").toLowerCase())) openFacilitator(true);
  window.setTimeout(() => map.invalidateSize(true), 200);
}

boot();
