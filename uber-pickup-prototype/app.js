const brisbaneCBD = [-27.4698, 153.0251];

const pickupPoints = [
  {
    id: "queen-street",
    name: "Queen Street Mall",
    address: "Edward St entrance",
    coordinates: [-27.46924, 153.02584],
    status: "blocked",
    label: "Pickup not recommended",
    reason: "No-stopping zone on the selected kerb",
    source: "Verified by 4 drivers · 12 min ago",
    freshness: "verified",
    stepFree: false,
  },
  {
    id: "ann-street",
    name: "Ann Street loading zone",
    address: "Near Anzac Square",
    coordinates: [-27.46799, 153.02652],
    status: "suitable",
    label: "Suitable for pickup",
    reason: "Legal loading area with clear kerb access",
    source: "Council data + 2 driver confirmations · 8 min ago",
    freshness: "verified",
    walk: "3 min walk",
    driverEta: "4 min",
    detail: "Safest · step-free route",
    stepFree: true,
  },
  {
    id: "adelaide-street",
    name: "Adelaide Street",
    address: "City Hall side",
    coordinates: [-27.46961, 153.02339],
    status: "caution",
    label: "May be difficult",
    reason: "Temporary construction reduces kerb access",
    source: "Reported by 1 driver · 3 days ago",
    freshness: "temporary",
    walk: "2 min walk",
    driverEta: "6 min",
    detail: "Closest · stairs nearby",
    stepFree: false,
  },
  {
    id: "george-street",
    name: "George Street pickup bay",
    address: "Near Burnett Lane",
    coordinates: [-27.47262, 153.02422],
    status: "suitable",
    label: "Suitable for pickup",
    reason: "Marked passenger loading bay",
    source: "Verified location · updated today",
    freshness: "verified",
    walk: "5 min walk",
    driverEta: "5 min",
    detail: "Fastest for driver · level surface",
    stepFree: true,
  },
  {
    id: "elizabeth-street",
    name: "Elizabeth Street",
    address: "Albert St corner",
    coordinates: [-27.4712, 153.02718],
    status: "caution",
    label: "Report expired",
    reason: "Previous event restriction may no longer apply",
    source: "Passenger report expired · 1 hour ago",
    freshness: "expired",
    walk: "4 min walk",
    driverEta: "5 min",
    detail: "Status needs checking",
    stepFree: true,
  },
];

const alternatives = pickupPoints.filter((point) =>
  ["ann-street", "adelaide-street", "george-street"].includes(point.id),
);

const state = {
  role: "passenger",
  selectedPointId: "queen-street",
  chosenAlternativeId: null,
  passengerConfirmed: false,
  driverConfirmed: false,
  reportActor: "passenger",
  activities: [
    {
      icon: "map-pin-check",
      title: "Pickup status shared",
      detail: "Passenger and driver are viewing the same location status.",
      time: "Now",
    },
    {
      icon: "badge-check",
      title: "Restriction verified",
      detail: "Four recent driver reports confirm the no-stopping zone.",
      time: "12m",
    },
  ],
};

const map = L.map("map", {
  zoomControl: false,
  attributionControl: true,
}).setView(brisbaneCBD, 16);

L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  maxZoom: 19,
  subdomains: "abcd",
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
}).addTo(map);

L.control.zoom({ position: "bottomright" }).addTo(map);

const markers = new Map();
let routeLine = null;

function markerIcon(point, selected = false) {
  return L.divIcon({
    className: "custom-marker-shell",
    html: `<span class="pickup-marker ${point.status} ${selected ? "selected" : ""}">
      <i data-lucide="${point.status === "blocked" ? "triangle-alert" : point.status === "caution" ? "clock-alert" : "check"}"></i>
    </span>`,
    iconSize: [38, 38],
    iconAnchor: [19, 34],
    popupAnchor: [0, -31],
  });
}

pickupPoints.forEach((point) => {
  const marker = L.marker(point.coordinates, {
    icon: markerIcon(point, point.id === state.selectedPointId),
    title: point.name,
  }).addTo(map);

  marker.bindPopup(
    `<div class="marker-popup"><strong>${point.name}</strong><span>${point.label}</span></div>`,
  );
  marker.on("click", () => selectPoint(point.id, true));
  markers.set(point.id, marker);
});

function getPoint(id = state.selectedPointId) {
  return pickupPoints.find((point) => point.id === id);
}

function statusIconName(status) {
  if (status === "blocked") return "circle-alert";
  if (status === "caution") return "clock-alert";
  return "circle-check-big";
}

function selectPoint(id, openPopup = false) {
  state.selectedPointId = id;
  state.chosenAlternativeId = null;
  state.passengerConfirmed = false;
  state.driverConfirmed = false;

  pickupPoints.forEach((point) => {
    markers.get(point.id).setIcon(markerIcon(point, point.id === id));
  });

  const point = getPoint(id);
  map.panTo(point.coordinates, { animate: true, duration: 0.35 });
  if (openPopup) markers.get(id).openPopup();

  updateSharedLocation(point);
  renderAlternatives();
  refreshIcons();
}

function updateSharedLocation(point) {
  document.querySelector("#passenger-location-title").textContent = point.name;
  document.querySelector("#passenger-status-reason").textContent = point.reason;
  document.querySelector("#passenger-status-source").textContent = point.source;
  document.querySelector("#report-location").textContent = `${point.name}, ${point.address}`;
  document.querySelector("#driver-pickup-name").textContent = point.name;
  document.querySelector("#driver-status-label").textContent = point.label;
  document.querySelector("#driver-status-reason").textContent = point.reason;
  document.querySelector("#driver-status-source").textContent = "Synced with passenger · just now";

  const passengerBanner = document.querySelector("#passenger-status");
  const driverBanner = document.querySelector("#driver-status");
  [passengerBanner, driverBanner].forEach((banner) => {
    banner.className = `status-banner ${point.status}`;
    banner.querySelector(".status-icon").innerHTML = `<i data-lucide="${statusIconName(point.status)}"></i>`;
  });

  passengerBanner.querySelector(".status-label").textContent = point.label;
  document.querySelector("#passenger-confirmation").hidden = true;
  document.querySelector("#override-warning").hidden = true;

  const showAlternativesButton = document.querySelector("#show-alternatives");
  showAlternativesButton.innerHTML = point.status === "suitable"
    ? '<i data-lucide="circle-check-big"></i> Use this pickup point'
    : '<i data-lucide="waypoints"></i> Choose another point';
}

function renderAlternatives() {
  const list = document.querySelector("#alternative-list");
  const stepFreeOnly = document.querySelector("#step-free-filter").checked;
  const visibleAlternatives = alternatives.filter((point) => !stepFreeOnly || point.stepFree);

  list.innerHTML = visibleAlternatives
    .map(
      (point, index) => `
        <button class="alternative-card ${state.chosenAlternativeId === point.id ? "selected" : ""}" type="button" data-alternative="${point.id}">
          <span class="alternative-number">${index + 1}</span>
          <span class="alternative-copy">
            <strong>${point.name}</strong>
            <span>${point.detail}<br>${point.reason}</span>
          </span>
          <span class="alternative-meta">
            <strong>${point.walk}</strong>
            <span>Driver ${point.driverEta}</span>
          </span>
        </button>
      `,
    )
    .join("");

  if (state.chosenAlternativeId) {
    list.insertAdjacentHTML(
      "beforeend",
      `<button class="primary-button confirm-alternative" id="confirm-alternative" type="button">
        <i data-lucide="check"></i> Confirm selected pickup
      </button>`,
    );
  }

  list.querySelectorAll("[data-alternative]").forEach((button) => {
    button.addEventListener("click", () => chooseAlternative(button.dataset.alternative));
  });

  document.querySelector("#confirm-alternative")?.addEventListener("click", confirmAlternative);
  refreshIcons();
}

function chooseAlternative(id) {
  state.chosenAlternativeId = id;
  const point = getPoint(id);
  map.panTo(point.coordinates, { animate: true, duration: 0.35 });
  markers.get(id).openPopup();
  drawSharedRoute(point);
  renderAlternatives();
}

function drawSharedRoute(destination) {
  if (routeLine) routeLine.remove();
  const origin = getPoint(state.selectedPointId);
  routeLine = L.polyline([origin.coordinates, destination.coordinates], {
    color: "#145bdb",
    weight: 4,
    opacity: 0.85,
    dashArray: "7 8",
  }).addTo(map);
  map.fitBounds(routeLine.getBounds(), { padding: [70, 70], maxZoom: 17 });
}

function confirmAlternative() {
  const chosen = getPoint(state.chosenAlternativeId);
  if (!chosen) return;

  state.passengerConfirmed = true;
  document.querySelector("#confirmed-location-name").textContent = chosen.name;
  document.querySelector("#confirmed-location-meta").textContent = `${chosen.walk} · ${chosen.detail.toLowerCase()}`;
  document.querySelector("#passenger-driver-eta").textContent = chosen.driverEta;
  document.querySelector("#driver-pickup-name").textContent = chosen.name;
  document.querySelector("#driver-eta-value").textContent = chosen.driverEta;
  document.querySelector("#driver-status-label").textContent = chosen.label;
  document.querySelector("#driver-status-reason").textContent = chosen.reason;
  document.querySelector("#driver-status-source").textContent = "Confirmed with passenger · just now";
  const driverBanner = document.querySelector("#driver-status");
  driverBanner.className = `status-banner ${chosen.status}`;
  driverBanner.querySelector(".status-icon").innerHTML = `<i data-lucide="${statusIconName(chosen.status)}"></i>`;
  document.querySelector("#passenger-confirmation").hidden = false;
  document.querySelector("#passenger-confirmation").scrollIntoView({ behavior: "smooth", block: "nearest" });

  addActivity(
    "route",
    "Passenger selected a safer point",
    `${chosen.name} · ${chosen.walk} from the original pin.`,
  );
  showToast("Pickup updated", `Jordan can now see ${chosen.name}.`);
  renderActivities();
}

function confirmOriginalPoint() {
  const original = getPoint();
  state.passengerConfirmed = true;
  state.chosenAlternativeId = original.id;
  document.querySelector("#confirmed-location-name").textContent = original.name;
  document.querySelector("#confirmed-location-meta").textContent =
    "Original point retained · driver may request a relocation";
  document.querySelector("#passenger-driver-eta").textContent = "6 min";
  document.querySelector("#driver-pickup-name").textContent = original.name;
  document.querySelector("#passenger-confirmation").hidden = false;
  document.querySelector("#override-warning").hidden = true;
  addActivity(
    "shield-alert",
    "Passenger kept the restricted pickup point",
    "The driver may need to request a safer alternative before arrival.",
  );
  renderActivities();
  showToast("Original point retained", "The driver has been notified of the pickup risk.");
}

function addActivity(icon, title, detail) {
  state.activities.unshift({ icon, title, detail, time: "Now" });
  state.activities = state.activities.slice(0, 5);
}

function renderActivities() {
  const list = document.querySelector("#activity-list");
  list.innerHTML = state.activities
    .map(
      (item) => `
        <li class="activity-item">
          <span class="activity-icon"><i data-lucide="${item.icon}"></i></span>
          <span><strong>${item.title}</strong><span>${item.detail}</span></span>
          <time>${item.time}</time>
        </li>
      `,
    )
    .join("");
  refreshIcons();
}

function showToast(title, message) {
  const region = document.querySelector("#toast-region");
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `
    <i data-lucide="radio-tower"></i>
    <span><strong>${title}</strong><span>${message}</span></span>
  `;
  region.append(toast);
  refreshIcons();
  window.setTimeout(() => toast.remove(), 3800);
}

function switchRole(role) {
  state.role = role;
  document.querySelectorAll(".role-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.role === role);
  });
  document.querySelectorAll(".role-panel").forEach((panel) => panel.classList.remove("active"));
  document.querySelector(`#${role}-panel`).classList.add("active");
  document.querySelector(".control-panel").scrollTo({ top: 0, behavior: "auto" });
  window.setTimeout(() => map.invalidateSize(), 50);
}

function openReport(actor) {
  state.reportActor = actor;
  document.querySelector("#report-note").value = "";
  document.querySelector("#report-dialog").showModal();
}

function handleReportSubmit(event) {
  event.preventDefault();
  const reason = new FormData(event.currentTarget).get("report-reason");
  const note = document.querySelector("#report-note").value.trim();
  const point = getPoint();

  point.status = "caution";
  point.label = "Temporary report · needs verification";
  point.reason = reason;
  point.source = `Reported by ${state.reportActor} · just now`;
  point.freshness = "temporary";

  markers.get(point.id).setIcon(markerIcon(point, true));
  updateSharedLocation(point);
  addActivity(
    "message-square-warning",
    `${state.reportActor === "driver" ? "Driver" : "Passenger"} reported ${reason.toLowerCase()}`,
    note || "The location status is now temporary until another report verifies it.",
  );
  renderActivities();
  document.querySelector("#report-dialog").close();
  showToast("Report shared", "Both passenger and driver views have been updated.");
  refreshIcons();
}

function handleDriverAccept() {
  state.driverConfirmed = true;
  const button = document.querySelector("#driver-accept");
  button.innerHTML = '<i data-lucide="circle-check-big"></i> Pickup plan confirmed';
  button.disabled = true;
  button.style.opacity = "0.72";
  addActivity("circle-check-big", "Driver confirmed the shared plan", "Mia will be notified before Jordan arrives.");
  renderActivities();
  showToast("Driver confirmed", "Both sides now have the same pickup plan.");
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

document.querySelectorAll(".role-button").forEach((button) => {
  button.addEventListener("click", () => switchRole(button.dataset.role));
});

document.querySelectorAll("[data-open-report]").forEach((button) => {
  button.addEventListener("click", () => openReport(button.dataset.openReport));
});

document.querySelector("#report-form").addEventListener("submit", handleReportSubmit);
document.querySelector("#step-free-filter").addEventListener("change", renderAlternatives);
document.querySelector("#driver-accept").addEventListener("click", handleDriverAccept);
document.querySelector("#keep-original").addEventListener("click", () => {
  document.querySelector("#override-warning").hidden = false;
  document.querySelector("#override-warning").scrollIntoView({ behavior: "smooth", block: "nearest" });
});
document.querySelector("#cancel-override").addEventListener("click", () => {
  document.querySelector("#override-warning").hidden = true;
});
document.querySelector("#confirm-override").addEventListener("click", confirmOriginalPoint);

document.querySelector("#show-alternatives").addEventListener("click", () => {
  const point = getPoint();
  if (point.status === "suitable") {
    state.chosenAlternativeId = point.id;
    confirmAlternative();
    return;
  }
  document.querySelector("#alternative-section").scrollIntoView({ behavior: "smooth", block: "start" });
});

document.querySelector("#recenter-button").addEventListener("click", () => {
  map.setView(brisbaneCBD, 16, { animate: true });
});

document.querySelector("#clear-search").addEventListener("click", () => {
  const input = document.querySelector("#place-search");
  input.value = "";
  input.focus();
});

document.querySelector("#place-search").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  map.setView(brisbaneCBD, 16, { animate: true });
  showToast("Area loaded", "Showing reported pickup conditions in Brisbane CBD.");
});

renderAlternatives();
renderActivities();
updateSharedLocation(getPoint());
refreshIcons();

window.addEventListener("resize", () => map.invalidateSize());
window.setTimeout(() => {
  map.invalidateSize(true);
  map.setView(brisbaneCBD, 16, { animate: false });
}, 150);

window.setTimeout(() => {
  showToast("Live status available", "Pickup conditions are shared across passenger and driver views.");
}, 900);
