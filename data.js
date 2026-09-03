/* Static study data: pickup spots, search gazetteer and facilitator scenarios.
   Everything here is hardcoded on purpose. The prototype is a research instrument,
   and every value below stands in for data the study does not need to be real. */

const CBD_CENTER = [-27.4698, 153.0251];
/* South-west and north-east corners of the bounded study area. */
const CBD_BOUNDS = [
  [-27.479, 153.013],
  [-27.461, 153.036],
];
const WALK_METRES_PER_MINUTE = 60;
/* Fixed simulated driver position (Charlotte Street). Driver position awareness is out of scope. */
const DRIVER_POSITION = [-27.4738, 153.0265];
const DRIVER_NAME = "Jordan";
const PASSENGER_NAME = "Mia";

/* Display status keys: suitable, caution, blocked (shown as "not recommended"). */
const STATUS_LABEL = {
  suitable: "Suitable for pickup",
  caution: "Pickup may be difficult",
  blocked: "Pickup not recommended",
};

/* Lifecycle states handled by the state machine in app.js. */
const LIFECYCLE = ["reported", "temporary", "verified", "corrected", "expired"];

const SPOT_FIXTURE = [
  {
    id: "queen-street",
    name: "Queen Street Mall",
    address: "Edward St entrance",
    coordinates: [-27.46924, 153.02584],
    status: "blocked",
    state: "verified",
    reason: "No-stopping zone on this kerb",
    reportCount: 4,
    ageText: "12 minutes ago",
    driverEta: 4,
    stepFree: false,
  },
  {
    id: "ann-street",
    name: "Ann Street loading zone",
    address: "Outside Anzac Square",
    coordinates: [-27.46799, 153.02652],
    status: "suitable",
    state: "verified",
    reason: "Marked loading zone with clear kerb access",
    reportCount: 3,
    ageText: "8 minutes ago",
    driverEta: 4,
    stepFree: true,
  },
  {
    id: "adelaide-street",
    name: "Adelaide Street",
    address: "City Hall side",
    coordinates: [-27.46961, 153.02339],
    status: "caution",
    state: "temporary",
    reason: "Construction work is reducing kerb space",
    reportCount: 1,
    ageText: "3 days ago",
    driverEta: 6,
    stepFree: false,
  },
  {
    id: "george-street",
    name: "George Street pickup bay",
    address: "Near Burnett Lane",
    coordinates: [-27.47262, 153.02422],
    status: "suitable",
    state: "verified",
    reason: "Marked passenger pickup bay",
    reportCount: 6,
    ageText: "earlier today",
    driverEta: 5,
    stepFree: true,
  },
  {
    id: "elizabeth-street",
    name: "Elizabeth Street",
    address: "Albert St corner",
    coordinates: [-27.4712, 153.02718],
    status: "caution",
    state: "expired",
    reason: "An earlier event restriction may no longer apply",
    reportCount: 1,
    ageText: "1 hour ago",
    driverEta: 5,
    stepFree: true,
  },
  {
    id: "eagle-street",
    name: "Eagle Street Pier",
    address: "Riverside, near the ferry terminal",
    coordinates: [-27.46807, 153.03018],
    status: "blocked",
    state: "verified",
    reason: "Road closed for the Riverside festival",
    validity: "Closure in place until 10 pm today",
    temporaryEvent: true,
    reportCount: 3,
    ageText: "25 minutes ago",
    driverEta: 7,
    stepFree: true,
  },
];

/* Offline gazetteer. Each landmark resolves to a known pickup spot so every
   search result carries a real status from the start. No query leaves the device. */
const GAZETTEER = [
  { name: "Myer Centre", address: "91 Queen St, Brisbane City", spotId: "queen-street" },
  { name: "Wintergarden", address: "171 Queen St, Brisbane City", spotId: "queen-street" },
  { name: "Queen Street Mall", address: "Queen St, Brisbane City", spotId: "queen-street" },
  { name: "Central Station", address: "Ann St, Brisbane City", spotId: "ann-street" },
  { name: "Anzac Square", address: "Adelaide St, Brisbane City", spotId: "ann-street" },
  { name: "Brisbane City Hall", address: "64 Adelaide St, Brisbane City", spotId: "adelaide-street" },
  { name: "King George Square", address: "Adelaide St, Brisbane City", spotId: "adelaide-street" },
  { name: "Treasury Brisbane", address: "130 William St, Brisbane City", spotId: "george-street" },
  { name: "Brisbane Square Library", address: "266 George St, Brisbane City", spotId: "george-street" },
  { name: "Elizabeth Arcade", address: "Elizabeth St, Brisbane City", spotId: "elizabeth-street" },
  { name: "QueensPlaza", address: "226 Queen St, Brisbane City", spotId: "elizabeth-street" },
  { name: "Riverside Centre", address: "123 Eagle St, Brisbane City", spotId: "eagle-street" },
  { name: "Eagle Street Pier", address: "45 Eagle St, Brisbane City", spotId: "eagle-street" },
];

/* Reason options offered in the report dialog and the display status each one produces. */
const REPORT_REASONS = [
  { value: "Good pickup spot", status: "suitable", icon: "circle-check-big", driverOnly: true },
  { value: "No-stopping zone", status: "blocked", icon: "circle-slash-2" },
  { value: "Road closure", status: "blocked", icon: "construction" },
  { value: "Heavy traffic", status: "caution", icon: "traffic-cone" },
  { value: "Limited access", status: "caution", icon: "accessibility" },
  { value: "Unsafe roadside", status: "blocked", icon: "shield-alert" },
  { value: "Construction or event", status: "caution", icon: "calendar-clock" },
];

const BREAK_CONDITIONS = [
  "interrupt_mid_report",
  "conflicting_reports",
  "duplicate_report",
  "reload",
  "bad_location_data",
];

/* Scenario table. entry: "search" or "preset". suggestions: "full" (suggestions plus override),
   "only" (suggestions, no override) or "none". Row 4 must keep suggestions "full". */
const SCENARIO_DEFAULTS = {
  role: "passenger",
  entry: "search",
  suggestions: "full",
  suggestionsExpanded: false,
  variant: "explained",
  pressure: false,
  countdownSeconds: 240,
  presetSpot: "queen-street",
  walkOverrides: {},
  driverScreen: "request",
  alternativeSpot: "ann-street",
};

const SCENARIOS = {
  FREE: {
    label: "Free exploration",
    task: "No script. Use for demos and heuristic evaluation.",
  },
  "R1-A": {
    label: "Row 1 · A · suitable spot",
    task: "Ask the participant to set their pickup at Central Station, then read the status and confirm.",
  },
  "R1-B": {
    label: "Row 1 · B · not recommended",
    task: "Ask the participant to set their pickup at the Myer Centre, then choose what to do.",
  },
  "R1-C": {
    label: "Row 1 · C · report",
    task: "Ask the participant to set their pickup at City Hall and report the construction there.",
  },
  "R4-EXP": {
    label: "Row 4 · explained",
    entry: "preset",
    suggestionsExpanded: true,
    variant: "explained",
    pressure: true,
    walkOverrides: { "ann-street": 3 },
    task: "Pin is preset at Queen Street Mall. Countdown and running-late cue are on. Reason text shown.",
  },
  "R4-NOEXP": {
    label: "Row 4 · unexplained",
    entry: "preset",
    suggestionsExpanded: true,
    variant: "unexplained",
    pressure: true,
    walkOverrides: { "ann-street": 3 },
    task: "Identical to R4-EXP with the reason text hidden.",
  },
  "R2-T1": {
    label: "Row 2 · T1 · report to temporary",
    entry: "preset",
    suggestionsExpanded: true,
    task: "Submit a report on the preset pin and audit the transition in the log.",
  },
  "R2-T2": {
    label: "Row 2 · T2 · temporary to verified",
    entry: "preset",
    suggestionsExpanded: true,
    task: "Use the Verify control on a temporary spot and check both views.",
  },
  "R2-T3": {
    label: "Row 2 · T3 · verified to corrected",
    entry: "preset",
    suggestionsExpanded: true,
    task: "Use the Correct control on a verified spot and check both views.",
  },
  "R2-T4": {
    label: "Row 2 · T4 · any to expired",
    entry: "preset",
    suggestionsExpanded: true,
    task: "Use the Expire control on any spot and check both views.",
  },
  "R3-1": {
    label: "Row 3 · request with confirmed spot",
    role: "driver",
    driverScreen: "request",
    task: "Walk the driver through the request, the status and the reason.",
  },
  "R3-2": {
    label: "Row 3 · passenger accepted alternative",
    role: "driver",
    driverScreen: "accepted-alternative",
    task: "Show the driver the passenger moving to Ann Street.",
  },
  "R3-3": {
    label: "Row 3 · passenger kept their pin",
    role: "driver",
    driverScreen: "kept-pin",
    task: "Show the driver the passenger keeping Queen Street Mall despite the warning.",
  },
};

function getScenario(id) {
  const base = SCENARIOS[id] ? { ...SCENARIO_DEFAULTS, ...SCENARIOS[id] } : { ...SCENARIO_DEFAULTS, ...SCENARIOS.FREE };
  base.id = SCENARIOS[id] ? id : "FREE";
  return base;
}
