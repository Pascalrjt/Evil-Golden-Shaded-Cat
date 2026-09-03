# Pickup Pilot prototype

Static passenger and driver prototype for DECO6500. It is a research instrument: the parts a
participant interacts with are real, everything else is hardcoded or triggered by the facilitator.
No backend, no accounts, no network calls beyond map tiles and icon fonts.

## Run locally

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173`. The app renders in a phone-sized frame on a laptop and full screen on a phone.

## Facilitator controls

The facilitator panel is hidden from participants. Open it with any of:

- `Ctrl+Shift+F`
- the URL parameter `?facilitator=1`
- five quick taps on the small "Pickup Pilot" badge at the top right

Sessions can also be started from the URL, which is the quickest way on a phone:

```
?pid=P07&scenario=R4-EXP&order=1
?pid=D03&scenario=R3-2
?pid=RUN-2026-09-04&scenario=R2-T1&facilitator=1
```

Scenario IDs: `FREE`, `R1-A`, `R1-B`, `R1-C`, `R4-EXP`, `R4-NOEXP`, `R2-T1` to `R2-T4`, `R3-1` to `R3-3`.
Each one sets the role, the entry mode (search or preset pin), the suggestion mode, the explanation
variant and the pressure cue. See `data.js`.

## Event log and data handling

Every interaction is logged in the browser and mirrored to `localStorage`. Nothing leaves the device
until the facilitator exports it from the panel as JSON or CSV. The file is named
`<participant>_<date>_<scenario>.json`. On a phone the Share button opens the share sheet so the file
can go straight to the team OneDrive folder. Clear the log after every export, since sessions share devices.

The export folder is ignored by git. Never commit a log.

## What is real and what is simulated

Real: the bounded CBD map (Leaflet and OpenStreetMap, no key), six pickup spots with status, reason,
source and freshness, the report action on both sides, the alternatives flow with walking time and a
step-free filter, the override path with a repeated warning, the explained and unexplained relocation
variants, the countdown and running-late cue, three driver screens, driver pin placement and spot
suggestion, the four-transition state machine, the event log and the facilitator session setup.

Simulated: verification and aggregation of reports (facilitator buttons), expiry (facilitator button),
driver position and arrival times (fixed), the other party's responses (scripted), and the search
gazetteer (a written list of CBD landmarks, each mapped to a known spot).

Not built: citywide coverage, legality data, live sync, accounts, moderation, ratings and cold start.

## Files

- `index.html` shell, search screen, facilitator panel, report dialog
- `styles.css` dark ride-hail styling and the phone frame
- `data.js` spots, gazetteer, report reasons and the scenario table
- `log.js` event log with localStorage mirror and export
- `app.js` state, state machine, map, rendering and handlers
