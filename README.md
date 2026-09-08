# Pickup Pilot passenger study

Local static prototype updated for the passenger protocol discussed on 8 September 2026.
Run from this directory with `python3 -m http.server 4173`, then open
`http://localhost:4173/?facilitator=1` in Helium. A phone-sized layout is shown on desktop.
Map tiles and the existing Leaflet/Lucide dependencies require a network connection.

## Run a participant

1. Open the facilitator panel with Ctrl+Shift+F, three taps on the Pickup Pilot badge,
   or `?facilitator=1`. Enter the participant ID and assigned group A–D.
2. Choose **Participant study**, enter the participant and group, then press **Prepare session**. This loads P0, followed by P1, P2, P3 and the
   group's two P4 situations through **Next scenario**. Use the separate P3-E expiry card
   between P3 and P4. All study tasks use a fixed simulated passenger position and GPS is disabled.
3. Close the panel to reveal the screen and read the task. Open the panel again and
   press **Start task**. Loading and screen reveal are recorded separately
   from task start. The participant can interact once the task starts.
4. For P3, all pickup controls work as normal. Watch the participant and, before they confirm
   a pickup, tell them temporary barriers are blocking the kerb. **Reveal obstruction** is optional:
   it shows a barrier notice, pauses the timer while you read the script and records the pause.
   Use **Resume after reveal** afterwards. The pickup information stays suitable
   until a report is accepted. Limited access and Construction or event are supported
   obstruction categories. Report receipt changes the information to temporary caution,
   with one passenger report awaiting verification and the old evidence retained in history.
   Reporting alone does not complete the task. Final confirmation ends the attempt, with
   unmet report/relocation requirements recorded as incomplete. A participant who confirms
   before the prompt ends the attempt as incomplete; record why on the sheet.
5. P0 has a two-minute familiarisation limit. P1–P3 have a three-minute task limit;
   only the P3 reveal script is paused. Two recorded assists stop P1–P3. Practice is flagged.
   Use **End task**, choose whether the facilitator or participant ended it, then confirm.
   **Continue task** cancels that choice and leaves the timer running.
6. For P4, run the separate two-minute arrival timer after the prompt. The prototype has
   a hidden continuous three-minute decision limit and no conflicting driver countdown or ETA.
   No decision is forced at two minutes. Think-aloud is disabled. If a neutral prompt is
   needed after 20 seconds, record its exact words. Final confirmation or the deadline ends
   the task; further participant changes are frozen for the questionnaire.
7. Immediately after each P4 decision or timeout, give the separate six-item questionnaire
   before probing. Record form administration and missing responses. Ask the agreed neutral
   probes afterwards. The prototype does not administer or score UTAUT2 items.
8. Record assistance, E1/E2/E3 observations, comprehension checks (check ID plus C/P/I/NR),
   faults, recording references and participant context on the sheets or in the facilitator panel.
   Task outcome reviews preserve the automatic outcome and add a separate reviewed value.
9. Open **Exports and event log**. Export task summaries and the event trace before clearing the device log. Exports contain
   all stored attempts, with participant/session IDs in every current-format row.

## Preview and advanced controls

Choose **Preview** in the Mode selector for an untimed walkthrough. Selecting a preview
scenario loads it immediately; close the panel to interact. Preview supports map confirmation,
alternatives and reporting, including the P3 reveal stages. It has no task deadline or start
button. Preview events carry `mode: preview` in raw exports and are excluded from participant
task summaries, including planned P4 rows.

Switch back to **Participant study** and press **Prepare session** to begin a fresh participant
session at P0. Fixtures, reports and selections reset; previous logs remain available. During
participant tasks, mode changes and manual restarts are locked until the task ends.

The main study panel shows **Prepare session** during setup, **Start task** when ready, and
**Next scenario** after completion. Condition and P4 order are assigned by the group and shown
as read-only information. **End task** opens the early-ending reason choices.

**Skip scenario** appears beside **Start task** when ready and beside **End task** while
running. Enter a reason, then confirm to advance to the next assigned scenario. Cancel keeps
the current attempt. Skipping the final scenario completes the sequence. Opening the skip
form does not pause the task timer; an elapsed deadline retains its timeout outcome.

Exports distinguish `skipped_before_start` from `skipped_after_start`, with `skipped`,
`skip_stage` and `skip_reason` columns. Skips before start have no start timestamp or duration
and are excluded from started-attempt denominators. Skips after start retain elapsed time,
script pauses and existing activity, and remain identifiable among started attempts. They
are separate from abandonment, failure and timeout. Any skipped assigned P4 situation sets
`p4_comparison_incomplete` for that session in task summaries. Group and P4 order remain fixed.


**Advanced controls** contains manual scenario loading, **Restart scenario** and **Set up
another participant**. Driver views and fault controls are available in **Technical testing**.
**Exports and event log** keeps downloads and log inspection out of the main task flow.

## Scenario fixtures

All suitability, reasons, verification, source ages and walking times are simulated.
The six task landmarks are Pancake Manor (18 Charlotte Street), Hungry Jack's (Queen Street
Mall near Albert), Maru (157 Elizabeth Street), Central Station (Ann Street entrance),
Wendy's (Albert/Adelaide) and QUT Gardens Point (George/Alice entrance).

| ID | Original information | Local alternatives |
| --- | --- | --- |
| P0 | Pancake Manor; suitable, 4 drivers, 12 minutes | Restaurant cluster |
| P1 | Hungry Jack's; restricted pedestrian mall, verified, 4 drivers, 12 minutes | Restaurant cluster |
| P2 | Maru; construction caution, 1 driver, 3 days, awaiting verification | Restaurant cluster |
| P3 | Central; suitable, 4 drivers, 12 minutes; staged obstruction | Central cluster |
| P4-WENDYS-EXP / NOEXP | Wendy's; amber caution | Wendy's cluster |
| P4-QUT-EXP / NOEXP | QUT; amber caution | QUT cluster |

| Cluster | Pickup point | Simulated suitability / evidence |
| --- | --- | --- |
| Restaurants | Charlotte Street, George–Albert | Suitable, verified |
| Restaurants | Uptown, Elizabeth Street | Suitable, verified |
| Restaurants | George Street, Elizabeth–Charlotte | Caution, unverified delivery obstruction |
| Restaurants | Mary Street, George–Albert | Caution, expired evidence |
| Wendy's | Adelaide Street, City Hall | Suitable, verified |
| Wendy's | Ann Street, Albert end | Suitable, verified |
| Wendy's | George Street, Adelaide–Ann | Caution, verified passing traffic |
| Central | Edward Street, Ann–Adelaide | Suitable, verified |
| Central | Turbot Street, Sofitel area | Suitable, verified |
| Central | Ann Street, Creek end | Caution, unverified traffic |
| QUT | George Street, Margaret–Alice | Suitable, verified |
| QUT | Alice Street, George–Albert | Suitable, verified |
| QUT | William Street, Alice end | Caution, verified passing traffic |

The map contains 20 unique fixtures: six task points, thirteen candidate alternatives and the
legacy Eagle Street driver-demo location. The study shows the local cluster, and P4's three
alternatives remain fixed in their declared order. Search aliases resolve to explicit pickup
points; duplicate search results for the same point are consolidated. Manual pins snap within
25 metres, with the destination label shown before the pickup-information screen.
Unmatched dropped pins have no report data and retain local alternatives and reporting.

Candidate coordinates and Council sign IDs are stored in `data.js`. The source is
[Brisbane City Council's passenger-loading dataset](https://data.brisbane.qld.gov.au/explore/dataset/two-minute-passenger-loading-zones/table/).
P3's starting position and Central Station marker use the station-side
[Ann Street entrance mapped in OpenStreetMap](https://www.openstreetmap.org/node/13114522481)
(-27.4663249, 153.0258786), checked 8 September 2026.
The scenario landmark positions are indicative. Exact kerbs, current sign restrictions and
walking routes need a site check before any real-world use. Map lines illustrate connections;
they are not routed walking directions. Non-P4 walk times use a simple distance estimate.
All P4 alternative times are explicitly configured to a simulated three minutes.

## P4 controls

| Group | First situation | Second situation |
| --- | --- | --- |
| A | Wendy's EXP | QUT NOEXP |
| B | Wendy's NOEXP | QUT EXP |
| C | QUT EXP | Wendy's NOEXP |
| D | QUT NOEXP | Wendy's EXP |

The group and order are audited against the active P4 scenario before task start.
Example: `?pid=P07&scenario=P4-QUT-NOEXP&group=A&order=2`.

Each location has two suitable alternatives and one cautionary alternative. Corresponding
options share reason, evidence age/count and walk-time profiles. Both conditions preserve
controls and layout dimensions. EXP shows the original reason "Driver cannot legally stop
here", "Verified by 3 drivers, 8 minutes ago" and "Source: driver reports". NOEXP removes
supporting information from rendered content, including override, confirmation, history and
report-result messages. The status and option names remain visible. No accessibility filter
or step-free/stairs badges are included in this study version.

Reporting stays available during P4. Each attempt is recorded and flagged in the summary;
accepted reports update the information while retaining the condition's visibility rules.
Review these flagged attempts alongside the participant's explanation.

## Pickup controls by state

Suitable pickups show confirmation and reporting. Relocation suggestions appear for caution,
restriction or unknown pickup information when the scenario permits them and candidates exist.
Selecting a suitable alternative while comparing a cautionary original keeps the comparison
list and enables confirmation of that alternative, including P4's matched choices.

The keep-pin prompt shows only its cancel and confirm actions. Unknown pickups use neutral
unconfirmed-availability wording. When alternatives are unavailable, the passenger can return
to the map or explicitly retain the pin. Invalid locations cannot be confirmed or reported.
P3 has no staged locks. Its controls follow the same rules as P1 and P2; only the optional
facilitator script pause freezes the screen. Finished study attempts freeze passenger actions.

These rules also govern map shortcuts and displayed-event records. State changes clear stale
alternatives and override prompts. Driver relocation suggestions require a current warning
and available candidates. Map chevrons appear only on actionable markers.

## Measurement and interpretation

- `task_outcome`: independent, assisted, incomplete or abandoned. A facilitator review
  can be recorded separately; software cannot establish intent or comprehension.
- `confirmation_occurred` and `chosen_pickup_suitability` are separate. A deliberate
  original-pin override can be a completed interaction while its chosen location is cautionary
  or not recommended. P3 additionally requires an accepted obstruction report on the target
  pin and a confirmed pickup other than that pin. Inspection is not recorded as an event.
- P4 `decision`: accept (final alternative confirmation), override (final original-pin
  confirmation) or no_decision. Abandonment has its own flag. Alternative selection is an
  intermediate event, not the final decision.
- A final snapshot stores the chosen ID/label, suitability and underlying evidence, separately
  from the information actually displayed. P3 evidence history is preserved. A rendered
  view is not proof that the participant read or understood it.
- Time starts at prompt completion. Summaries include active task time, wall time and
  the P3 script pause. Timeouts use the exact task limit even after browser timer throttling.
- IDs distinguish session, attempt, initial attempt and retry. Reset restores all fixtures,
  selections, reports, fault flags and timers while retaining the previous attempt's events.
  Reload restores the current attempt. A running task retains its original deadline.
- Summary exports include loaded-but-unstarted attempts and planned P4 situations never
  loaded for the session. Planned rows have no attempt ID and must be excluded from
  started-attempt denominators. Retry and practice rows are separately marked.
- E1 (wrong report target), E2 (missing category) and E3 (participant-identified unintended
  confirmation) are facilitator observations. Count distinct erroneous attempts; browsing,
  deliberate overrides and changes of mind remain separate. System rejection codes are
  technical outcomes and do not automatically become participant errors.
- Summarise success over started initial attempts, suitable choices over confirmed choices,
  and completion times separately from timeouts/abandonment. Keep think-aloud timings
  identifiable. Compare the six P4 questionnaire items individually using the separate forms.

## Technical checks and regression tests

R2-T1–T4 retain technical reporting/lifecycle checks; R3-1–3 retain driver views. Fault
controls are disabled in participant-study scenarios. Technical mode supports missing-category
validation, interruption, an unknown report target (toggle), a one-shot submission failure
with retry, replay of the last accepted ID as a duplicate, a conflicting driver report,
reload and unusable coordinates. All categories begin unselected. Free-text details can
supplement a supported category; unsupported categories are rejected.

Run `node --test tests/study.test.cjs` from this directory. These are dependency-free
behavioural tests for fixtures, counterbalancing, visibility, final outcomes, timed stops,
the P3 script pause, validation, exports and resets. Native Helium checks cover the participant UI.

Files: `data.js` fixtures; `study.js` timing/observations; `app.js` map and interaction;
`log.js` event and summary exports; `index.html` controls; `styles.css` layout.
