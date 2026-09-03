# Pickup Pilot prototype

Static passenger and driver prototype for DECO6500. It is a research instrument: the parts a
participant interacts with are real, everything else is hardcoded or triggered by the facilitator.
No backend, no accounts, no network calls beyond map tiles and icon fonts.

## Run locally

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173`. The app renders in a phone-sized frame on a laptop and full screen on a phone.

## Passenger flow

1. **Set your pickup spot.** The map is live under a fixed centre pin. Dragging the map moves the pin.
   Tapping the search field or expanding the sheet reveals Plan your ride inside the pickup sheet. Tapping "Confirm pickup spot" places the pin:
   within 150 m of a known spot it snaps to that spot, further away it becomes a dropped pin with
   "No pickup data for this spot", which still offers suggestions, the keep-my-pin path and reporting.
2. **Plan your ride.** Offline search over the gazetteer. Choosing a result places the pin.
3. **Confirm your pickup spot.** Status, reason, freshness, suggestions, override and report.
4. **Pickup confirmed.** Scripted driver acknowledgement.

Scenarios with a preset pin (Row 4, Row 2) skip straight to step 3.

On the first screen the app asks for the device location and, if it is inside the study area, starts the map
there with a blue dot. Outside the area it falls back to Hungry Jack's on Queen Street. The round locate button re-centres on demand.
Coordinates are never written to the event log; only whether location was granted and whether it was inside
the area. Turn it off with the facilitator checkbox or `?gps=0`. Browsers only allow location over HTTPS or localhost.

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

- `index.html` shell, facilitator panel, report dialog
- `styles.css` dark ride-hail styling and the phone frame
- `data.js` spots, gazetteer, report reasons and the scenario table
- `log.js` event log with localStorage mirror and export
- `app.js` state, state machine, map, rendering and handlers
