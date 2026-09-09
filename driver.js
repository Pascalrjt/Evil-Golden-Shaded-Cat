/* Driver interviews use local, scripted passenger responses. No second device is connected.
   Shared spot records describe information; acceptance separately changes the agreed pickup. */
function isDriverInterview() { return Boolean(state.scenario.driverInterview); }
function driverInterviewState() { return state.ui.driverInterview; }
function configureDriverScenario(scenario, location) {
 if (scenario.id !== "D4") return;
 const place = location === "qut" ? "qut" : "wendys";
 scenario.presetSpot = place;
 scenario.location = SPOT_FIXTURE.find(s => s.id === place).name;
 scenario.alternativeSpot = LOCAL_ALTERNATIVES[place][0];
 scenario.driverScreen = "accepted-alternative";
 scenario.alternativeIds = [...LOCAL_ALTERNATIVES[place]];
 scenario.walkOverrides = Object.fromEntries(scenario.alternativeIds.map(id => [id, 3]));
}
function resetDriverInterview() {
 if (!isDriverInterview()) return;
 const relocated = state.scenario.id === "D4";
 const originalId = state.scenario.presetSpot;
 state.ui.driverInterview = {
  originalId, activeId: relocated ? state.scenario.alternativeSpot : originalId,
  pendingId:null, lastSuggestedId:null, passengerResponse:relocated ? "accepted" : "none",
  message:relocated ? "I’ve accepted the updated pickup point." : "",
  contactPending:false, contacted:false, confirmed:false, decision:null,
  workflowStage:"dispatch", firstAction:null, reportResults:[], alternativeAgreed:relocated,
  mirror:false, continueWarning:false, otherOpen:false, lastAction:null,
  dispatch:"pending", dispatchDecision:null, declineOpen:false,
 };
 state.ui.chosenAlternativeId = relocated ? state.scenario.alternativeSpot : null;
 // Match the driver questionnaire without changing passenger fixtures.
 if (state.scenario.id === "D1") getSpot(originalId).reason = "No vehicle pickup access in the pedestrian mall";
 if (state.scenario.id === "D2") getSpot(originalId).reason = "Construction may be reducing kerb space";
}
/* Every scenario opens on a dispatch request card. Pickup actions wait for acceptance. */
function dispatchPending() { return isDriverInterview() && driverInterviewState()?.dispatch !== "accepted"; }
function driverCanAct() {
 return isDriverInterview() && !driverInterviewState().mirror && studyCanInteract() && !dispatchPending();
}
function driverAcceptRequest(afterDecline = false) {
 if (!isDriverInterview() || !studyCanInteract() || driverInterviewState().mirror) return;
 const d = driverInterviewState();
 if (d.dispatch !== (afterDecline ? "declined" : "pending")) return;
 d.dispatch = "accepted"; d.declineOpen = false;
 d.dispatchDecision = afterDecline ? {...d.dispatchDecision, continued_as_accepted:true, accepted_at_ms:elapsedMs()} : {decision:"accepted", accepted_at_ms:elapsedMs()};
 if (d.workflowStage === "dispatch") { d.workflowStage = "safely_stopped"; log("simulated_workflow_stage", {stage:"safely_stopped", recorded_by:"prototype", reason:"request_accepted"}); }
 log("driver_request_accepted", {spot_id:d.activeId, suitability:getSpot(d.activeId).status, after_decline:afterDecline, simulated:true});
 render(); setSheet("half"); focusDriverMap();
}
function driverDeclineRequest() {
 if (!isDriverInterview() || !studyCanInteract() || driverInterviewState().mirror) return;
 const d = driverInterviewState();
 if (d.dispatch !== "pending") return;
 const reason = $("#driver-decline-reason").value, note = $("#driver-decline-note").value.trim();
 if (!["pickup_spot", "distance", "other"].includes(reason)) return;
 if (reason === "other" && !note) { showToast("Describe your reason", "Enter why you would decline this request."); return; }
 d.dispatch = "declined"; d.declineOpen = false;
 d.dispatchDecision = {decision:"declined", reason, note, declined_at_ms:elapsedMs(), continued_as_accepted:false};
 log("driver_request_declined", {spot_id:d.activeId, suitability:getSpot(d.activeId).status, reason, note, simulated:true});
 render();
}
function driverDispatchTemplate() {
 const d = driverInterviewState(), active = getSpot(d.activeId), original = getSpot(d.originalId);
 const relocated = active.id !== original.id;
 if (d.dispatch === "declined") return `<header class="sheet-header"><p class="muted small">Simulated pickup · use while stationary</p><h1>Request declined</h1></header>
  <div class="notice warn"><div><strong>Your decline has been recorded.</strong><span>For this scenario, please continue as if you had accepted the request.</span></div></div>
  <div class="actions"><button class="button primary" id="driver-continue-accepted" type="button">Continue as accepted</button></div>`;
 const decline = `<div class="driver-other"><label class="field"><span>Why would you decline?</span><select id="driver-decline-reason"><option value="pickup_spot">The pickup spot</option><option value="distance">Distance or arrival time</option><option value="other">Another reason</option></select></label><label class="field"><span>Explain (optional, required for another reason)</span><textarea id="driver-decline-note" maxlength="500" rows="2"></textarea></label><button class="button secondary" id="driver-decline-save" type="button">Record my decline</button><button class="button secondary" id="driver-decline-cancel" type="button">Back to the request</button></div>`;
 return `<header class="sheet-header"><p class="muted small">Simulated pickup · use while stationary</p><p class="eyebrow">New pickup request</p><h1>${PASSENGER_NAME} · ${escapeHtml(active.name)}</h1><p class="muted">${escapeHtml(active.address)}</p></header>
  ${relocated ? `<div class="notice good"><div><strong>Passenger accepted a move to this pickup</strong><span>${escapeHtml(relocationReason(original))}</span></div></div>` : ""}
  <p class="section-label">Passenger’s pickup</p>${statusCard(active)}
  <p class="muted small">Simulated arrival: ${active.driverEta} minutes${relocated ? ` · Passenger walking, about ${walkFor(active, original)} minutes` : ""}</p>
  ${d.declineOpen ? decline : `<div class="actions"><button class="button primary" id="driver-accept-request" type="button">Accept request</button><button class="button secondary" id="driver-decline-request" type="button">Decline request</button></div>`}`;
}
function trackDriverEvent(event, payload) {
 if (!isDriverInterview() || state.attempt.status !== "running") return;
 const d = driverInterviewState();
 if (!d) return;
 const actions = ["driver_contact_requested", "driver_alternatives_opened", "driver_suggested_relocation", "driver_plan_confirmed", "driver_other_action", "driver_spot_inspected", "report_opened", "spot_add_opened"];
 if (actions.includes(event) && !d.firstAction) d.firstAction = {event, elapsed_ms:elapsedMs(), workflow_stage:d.workflowStage, ...payload};
 if (event === "report_accepted" || event === "report_rejected") {
  d.reportResults.push({result:event === "report_accepted" ? "accepted" : "rejected", elapsed_ms:elapsedMs(), workflow_stage:d.workflowStage, ...payload});
  if (event === "report_accepted") { d.confirmed = false; state.ui.driverConfirmed = false; }
 }
}
function driverSuggest(id) {
 if (!driverCanAct() || !driverAlternatives().some(item => item.spot.id === id)) return;
 const d = driverInterviewState();
 d.pendingId = id; d.lastSuggestedId = id; d.passengerResponse = "pending"; d.message = "";
 d.confirmed = false; state.ui.driverConfirmed = false;
 state.ui.driverSuggestOpen = false; state.ui.driverInspectId = null;
 log("driver_suggested_relocation", {spot_id:id, active_pickup_id:d.activeId, simulated:true});
 render(); setSheet("half"); focusDriverMap();
}
function driverAlternatives() {
 return alternativesFor(getSpot(driverInterviewState().originalId)).filter(({spot}) => spot.id !== driverInterviewState().activeId);
}
function driverContact() {
 if (!driverCanAct() || driverInterviewState().contactPending) return;
 const d = driverInterviewState();
 d.contacted = true; d.contactPending = true;
 log("driver_contact_requested", {spot_id:d.activeId, simulated:true});
 render(); showToast("Contact requested", "The facilitator will play the passenger in this simulation.");
}
function driverContinue(acknowledged = false) {
 if (!driverCanAct()) return;
 const d = driverInterviewState(), spot = getSpot(d.activeId);
 if (!spot || !validCoords(spot.coordinates) || d.confirmed) return;
 if (spot.status !== "suitable" && (!acknowledged || !d.continueWarning)) {
  d.continueWarning = true; render(); return;
 }
 d.continueWarning = false; d.confirmed = true; d.decision = "continue_to_pickup";
 d.lastAction = `Continuing to ${spot.name}`; state.ui.driverConfirmed = true;
 log("driver_plan_confirmed", {spot_id:spot.id, suitability:spot.status, pending_proposal_id:d.pendingId});
 render();
}
function driverOtherAction() {
 if (!driverCanAct()) return;
 const action = $("#driver-other-choice").value, note = $("#driver-other-note").value.trim();
 if (!["wait", "report_later", "cancel_pickup", "other"].includes(action)) return;
 if (action === "other" && !note) { showToast("Describe your action", "Enter what you would do."); return; }
 const d = driverInterviewState();
 d.decision = action; d.confirmed = false; state.ui.driverConfirmed = false; d.otherOpen = false;
 d.lastAction = {wait:"Wait and reassess", report_later:"Report later", cancel_pickup:"Cancel this pickup", other:note}[action];
 log("driver_other_action", {action, note, workflow_stage:d.workflowStage}); render();
}
function applyDriverPassengerResponse(coreResponse = null) {
 if (!isDriverInterview() || state.attempt.status !== "running" || state.attempt.pausedAt) return;
 const d = driverInterviewState();
 const response = typeof coreResponse === "string" ? coreResponse : $("#fac-driver-response").value;
 const note = typeof coreResponse === "string" ? "" : $("#fac-driver-response-note").value.trim();
 if (!["accepted", "declined", "unable", "no_response", "contact_reply"].includes(response)) return;
 if (response === "contact_reply" ? !d.contactPending : response === "no_response" ? !(d.pendingId || d.contactPending) : !d.pendingId) {
  showToast("No matching request", "Wait for a relocation suggestion or contact request before applying its response."); return;
 }
 if (["declined", "unable", "no_response"].includes(response) && !note) {
  showToast("Record the branch", "Describe why this optional response is being used."); return;
 }
 const proposedId = d.pendingId;
 const messages = {
  accepted:"I can meet you at the suggested pickup point.", declined:"I would like to keep the current pickup point.",
  unable:"I can’t reach the suggested pickup point.", no_response:"Passenger has not responded.",
  contact_reply:"I’m at the pickup point. Let me know where we should meet.",
 };
 d.message = response === "contact_reply" && note ? note : messages[response];
 if (response === "accepted") {
  d.activeId = proposedId; d.alternativeAgreed = true; d.pendingId = null;
  state.ui.chosenAlternativeId = proposedId; state.ui.driverInspectId = null;
  d.confirmed = false; state.ui.driverConfirmed = false; d.continueWarning = false;
 } else if (["declined", "unable"].includes(response)) d.pendingId = null;
 if (response !== "contact_reply") d.passengerResponse = response;
 if (response === "contact_reply" || response === "no_response") d.contactPending = false;
 log("simulated_passenger_response", {response, proposed_spot_id:proposedId, active_pickup_id:d.activeId, message:d.message, facilitator_note:note, optional_branch:["declined","unable","no_response"].includes(response) || (response === "contact_reply" && Boolean(note))});
 $("#fac-driver-response-note").value = "";
 $("#fac-driver-branches").open = false;
 render(); focusDriverMap();
}
function driverFinishSummary(reason, endAt) {
 const d = driverInterviewState(), a = state.attempt;
 const skipped = reason.startsWith("skipped_");
 const outcome = skipped ? reason : ({driver_completed:"completed",driver_assisted:"completed_with_assistance",abandoned:"abandoned",technical_fault:"technical_fault"}[reason] || "not_completed");
 const chosen = d.confirmed ? getSpot(d.activeId) : null;
 return {
  task_outcome:outcome, stop_reason:reason, decision:d.decision, confirmation_occurred:Boolean(chosen),
  chosen:spotSnapshot(chosen), displayed:displayedSnapshot(chosen), active_pickup:spotSnapshot(getSpot(d.activeId)),
  chosen_pickup_suitability:chosen?.status || "no_confirmed_choice",
  elapsed_ms:a.startedAt === null ? null : elapsedMs(endAt), wall_elapsed_ms:a.startedAt === null ? null : endAt-a.startedAt,
  script_pause_ms:a.pausedMs, assistance_count:a.assists, report_count:a.reportCount, report_attempt_count:a.reportAttemptCount,
  first_action:d.firstAction, dispatch_decision:d.dispatchDecision, request_accepted:d.dispatch === "accepted",
  report_results:d.reportResults, passenger_contacted:d.contacted,
  alternative_agreed:d.alternativeAgreed, passenger_response:d.passengerResponse, pending_pickup_id:d.pendingId,
  workflow_stage:d.workflowStage, interview_context:state.session.driverContext,
  abandoned:reason === "abandoned", skipped, skip_reason:skipped ? a.skipReason : null,
  skip_stage:skipped ? (a.startedAt === null ? "before_start" : "after_start") : null,
  simulated:true, outcome_recorded_by:"facilitator",
 };
}
function driverPassengerSnapshot() {
 const d = driverInterviewState();
 return {active_pickup:spotSnapshot(getSpot(d.activeId)), original_pickup:spotSnapshot(getSpot(d.originalId)),
  proposed_pickup:spotSnapshot(getSpot(d.pendingId)), passenger_response:d.passengerResponse, message:d.message};
}
function toggleDriverMirror() {
 if (!isDriverInterview() || state.attempt.pausedAt) return;
 closeReport(false);
 const d = driverInterviewState(); d.mirror = !d.mirror;
 log("driver_passenger_preview", {visible:d.mirror, ...driverPassengerSnapshot()});
 openFacilitator(false); render(); setSheet("study");
}
/* One-line reason for a move: the original pickup's status, reason and evidence, as the passenger saw them. */
function relocationReason(original) {
 const reason = original.reason ? original.reason.charAt(0).toLowerCase() + original.reason.slice(1) : "";
 return `Moved from ${original.name}. ${STATUS_LABEL[original.status]}: ${reason}. ${freshnessText(original)}.`;
}
function driverInterviewTemplate() {
 const d = driverInterviewState(), active = getSpot(d.activeId), original = getSpot(d.originalId);
 if (d.mirror) {
  return `<header class="sheet-header"><h1>Passenger view</h1><p class="muted">Read-only simulation of this session’s shared information.</p></header>
   <p class="section-label">Your agreed pickup</p><h2>${escapeHtml(active.name)}</h2><p class="muted">${escapeHtml(active.address)}</p>${statusCard(active)}
   ${dispatchPending() ? '<div class="notice warn"><div><strong>Waiting for a driver</strong><span>Your request has not been accepted yet.</span></div></div>' : ""}
   ${d.pendingId ? `<div class="notice warn"><div><strong>Driver suggests ${escapeHtml(getSpot(d.pendingId).name)}</strong><span>Awaiting your agreement. Your agreed pickup remains ${escapeHtml(active.name)}.</span></div></div>` : ""}
   ${d.message ? `<p class="driver-message">${escapeHtml(d.message)}</p>` : ""}
   ${active.id !== original.id ? `<p class="section-label">Original pickup: ${escapeHtml(original.name)}</p>${statusCard(original)}` : ""}
   <button class="button secondary" id="driver-mirror-back" type="button">Return to driver view</button>`;
 }
 if (state.ui.driverAddMode) return driverAddTemplate();
 if (dispatchPending()) return driverDispatchTemplate();
 const inspected = getSpot(state.ui.driverInspectId);
 const alternatives = state.ui.driverSuggestOpen ? `<div class="driver-alternatives"><h2>Suggest another pickup</h2>${driverAlternatives().map(({spot}) => `<button class="option-card ${inspected?.id === spot.id ? "is-chosen" : ""}" data-driver-propose="${spot.id}" type="button"><span class="option-main"><strong>${escapeHtml(spot.name)}</strong><span>${escapeHtml(spot.address)}</span><span class="option-tags">${statusTag(spot)}</span><span class="option-reason">${escapeHtml(spot.reason)}</span><span>${walkFor(spot, original)} min passenger walk</span></span></button>`).join("")}<button class="button secondary" id="driver-close-alternatives" type="button">Close alternatives</button></div>` : "";
 if (state.ui.driverSuggestOpen) return `<header class="sheet-header"><p class="muted">Agreed pickup: ${escapeHtml(active.name)}</p><p class="muted small">Tap a map dot to inspect a spot. Choose a card below to propose it.</p></header>${inspected && inspected.id !== active.id ? `<h2>${escapeHtml(inspected.name)}</h2>${statusCard(inspected)}` : ""}${alternatives}`;
 const other = d.otherOpen ? `<div class="driver-other"><label class="field"><span>What would you do?</span><select id="driver-other-choice"><option value="wait">Wait and reassess</option><option value="report_later">Report later</option><option value="cancel_pickup">Cancel this pickup</option><option value="other">Another action</option></select></label><label class="field"><span>Explain your action (optional, required for another action)</span><textarea id="driver-other-note" maxlength="500" rows="2"></textarea></label><button class="button secondary" id="driver-other-save" type="button">Record my action</button></div>` : "";
 if (d.otherOpen) return `${other}<button class="button secondary" id="driver-other" type="button">Back to pickup</button>`;
 return `<header class="sheet-header"><p class="muted small">Simulated pickup · use while stationary</p><h1>Pickup for ${PASSENGER_NAME}</h1></header>
  ${state.attempt.revealedAt ? '<div class="notice warn"><div><strong>Temporary barriers block the original pickup kerb.</strong><span>Respond in the order you would during a real pickup.</span></div></div>' : ""}
  ${active.id !== original.id ? `<div class="notice good"><div><strong>Passenger accepted the updated pickup</strong><span>${escapeHtml(relocationReason(original))}</span></div></div>` : ""}
  <div class="driver-pickup"><p class="eyebrow">Agreed pickup</p><h2>${escapeHtml(active.name)}</h2><p class="muted small">${escapeHtml(active.address)}</p>${statusCard(active, {compact:true})}
  <dl class="driver-stats"><div><dt>Simulated arrival</dt><dd>${active.driverEta} min</dd></div>${active.id !== original.id ? `<div><dt>Passenger walk</dt><dd>${walkFor(active, original)} min</dd></div>` : ""}</dl></div>
  ${d.pendingId ? `<div class="notice warn"><div><strong>${escapeHtml(getSpot(d.pendingId).name)} suggested</strong><span>${d.passengerResponse === "no_response" ? "Passenger has not responded." : "Waiting for passenger acceptance."} The agreed pickup stays at ${escapeHtml(active.name)}.</span></div></div>` : ""}
  ${d.message ? `<p class="driver-message"><strong>Passenger response</strong><br>${escapeHtml(d.message)}</p>` : ""}
  ${d.contactPending ? '<p class="driver-message">Contact requested. Awaiting the simulated passenger reply.</p>' : ""}
  ${d.lastAction ? `<p class="driver-message">Your decision: ${escapeHtml(d.lastAction)}</p>` : ""}
  <div class="actions">
   ${d.continueWarning ? `<div class="notice warn"><div><strong>${escapeHtml(STATUS_LABEL[active.status])}</strong><span>Confirm that continuing to this point represents what you would do.</span></div></div><button class="button primary" id="driver-continue-warning" type="button">Continue to this point</button><button class="button secondary" id="driver-cancel-warning" type="button">Go back</button>` : `<button class="button primary" id="driver-continue" type="button" ${d.confirmed || !validCoords(active.coordinates) ? "disabled" : ""}>${d.confirmed ? "Pickup plan confirmed" : "Continue to this pickup"}</button>`}
   <div class="row two"><button class="button secondary" id="driver-interview-suggest" type="button" ${!driverAlternatives().length ? "disabled" : ""}>Suggest a pickup</button>
   <button class="button secondary" id="driver-contact" type="button" ${d.contactPending ? "disabled" : ""}>Contact passenger</button></div>
   <div class="driver-quiet"><button class="button" id="driver-report-current" type="button">Report this pickup</button>
   ${active.id !== original.id ? '<button class="button" id="driver-report-original" type="button">Report original pickup</button>' : ""}
   <button class="button" id="driver-other" type="button">Another action</button></div>
  </div>${alternatives}${other}
  ${inspected && inspected.id !== active.id ? `<div class="driver-inspected"><p class="section-label">Inspecting ${escapeHtml(inspected.name)}</p><p class="muted">${escapeHtml(inspected.address)}</p>${statusCard(inspected)}<button class="button secondary" id="driver-report-inspected" type="button">Report this inspected spot</button></div>` : ""}
  <div class="driver-extra"><button class="button" id="driver-add" type="button"><i data-lucide="map-pin-plus"></i>Add a pickup spot you know</button><span class="muted small">Saved for future pickups</span></div>`;
}
function bindDriverInterviewHandlers(on) {
 if (!isDriverInterview()) return;
 $("#driver-mirror-back")?.addEventListener("click", toggleDriverMirror);
 on("#driver-accept-request", () => driverAcceptRequest());
 on("#driver-decline-request", () => { driverInterviewState().declineOpen = true; render(); });
 on("#driver-decline-cancel", () => { driverInterviewState().declineOpen = false; render(); });
 on("#driver-decline-save", driverDeclineRequest);
 on("#driver-continue-accepted", () => driverAcceptRequest(true));
 on("#driver-continue", () => driverContinue());
 on("#driver-continue-warning", () => driverContinue(true));
 on("#driver-cancel-warning", () => { driverInterviewState().continueWarning = false; render(); });
 on("#driver-interview-suggest", () => {
  state.ui.driverSuggestOpen = true; state.ui.driverInspectId = null; log("driver_alternatives_opened", {spot_id:driverPickupTarget().id}); render(); setSheet("half"); focusDriverMap();
 });
 on("#driver-close-alternatives", () => { state.ui.driverSuggestOpen = false; state.ui.driverInspectId = null; render(); setSheet("half"); focusDriverMap(); });
 $$("[data-driver-propose]").forEach(button => button.addEventListener("click", () => driverSuggest(button.dataset.driverPropose)));
 on("#driver-contact", driverContact);
 on("#driver-report-current", () => openReport({mode:"report", actor:"driver", spotId:driverPickupTarget().id}));
 on("#driver-report-original", () => openReport({mode:"report", actor:"driver", spotId:driverInterviewState().originalId}));
 on("#driver-report-inspected", () => openReport({mode:"report", actor:"driver", spotId:state.ui.driverInspectId}));
 on("#driver-other", () => { driverInterviewState().otherOpen = !driverInterviewState().otherOpen; render(); });
 on("#driver-other-save", driverOtherAction);
}
function renderDriverControls() {
 const driver = isDriverInterview(), d = driverInterviewState(), running = state.attempt.status === "running";
 $("#fac-driver-setup").hidden = state.session.mode !== "driver";
 $("#fac-passenger-group").hidden = state.session.mode === "driver";
 $("#fac-driver-controls").hidden = !driver || !sessionPrepared() || !running || !(d?.pendingId || d?.contactPending) || Boolean(state.attempt.pausedAt);
 $("#fac-driver-script-details").hidden = !driver;
 $("#fac-driver-timing").hidden = !driver;
 $("#fac-driver-preview-controls").hidden = !driver || !sessionPrepared();
 $("#fac-driver-accept").hidden = !d?.pendingId;
 $("#fac-driver-reply").hidden = !d?.contactPending;
 $("#fac-outcome-field").hidden = driver && $("#fac-observation-type").value !== "task_outcome";
 const outcomeField = $("#fac-outcome");
 const outcomeMode = driver ? "driver" : "passenger";
 if (outcomeField.dataset.mode !== outcomeMode) {
  outcomeField.dataset.mode = outcomeMode;
  outcomeField.innerHTML = (driver ? ["completed","completed_with_assistance","not_completed","abandoned","technical_fault"] : ["independent","assisted","incomplete","abandoned"]).map(value=>`<option>${value}</option>`).join("");
 }
 $("#fac-driver-stage").disabled = !running;
 $("#fac-driver-response").disabled = !running || Boolean(state.attempt.pausedAt);
 $("#fac-driver-respond").disabled = !running || Boolean(state.attempt.pausedAt) || !(d?.pendingId || d?.contactPending);
 $("#fac-driver-mirror").disabled = Boolean(state.attempt.pausedAt);
 if (!driver) { $("#fac-sequence-complete").textContent = "Sequence complete. Collect the final form and export the session."; return; }
 $("#fac-driver-stage").value = d.workflowStage;
 $("#fac-driver-coordination").textContent = d.pendingId ? `Suggested: ${getSpot(d.pendingId).name}. Acceptance updates the agreed pickup.` : "The driver requested contact. Default reply: ‘I’m at the pickup point. Let me know where we should meet.’";
 $("#fac-task").textContent = `“${state.scenario.task}”`;
 $("#fac-driver-setup-notes").textContent = state.scenario.setup;
 $("#fac-study-guidance").textContent = `${state.scenario.guideMinutes} minute guide. Let the driver act, then end the task and ask the scenario questions.`;
 if (state.scenario.id === "D3" && !state.attempt.revealedAt) $("#fac-study-guidance").textContent = "After the driver accepts the request and inspects the pickup information, reveal the obstruction.";
 if (running && dispatchPending()) $("#fac-study-guidance").textContent = "The driver is reviewing the dispatch request. Accepting opens the pickup sheet. A decline is recorded, then the scenario continues as accepted.";
 if (scriptPaused()) $("#fac-task").textContent = "“As you approach, you find temporary barriers across the pickup kerb and cannot stop there safely. While parked or in this simulation, use Pickup Pilot as you normally would to respond and continue the pickup.”";
 if (state.attempt.summary) {
  const labels={completed:"Completed",completed_with_assistance:"Completed with assistance",not_completed:"Not completed",abandoned:"Participant stopped",technical_fault:"Prototype fault",skipped_before_start:"Skipped before starting",skipped_after_start:"Skipped after starting"};
  $("#fac-result").textContent = labels[state.attempt.summary.task_outcome] || "Scenario ended";
 }
 if (state.attempt.status === "ended") $("#fac-study-guidance").textContent = "Ask this scenario’s targeted questions and ratings. Record observations before continuing.";
 $("#fac-think-field").hidden = true;
 $("#fac-session-summary").textContent = `${state.session.participantId} · Driver interview · ${state.scenario.id}`;
 renderDriverClock();
 $("#fac-mode-help").textContent = "D1–D4 · simulated passenger · stationary interaction";
 $("#fac-sequence-complete").textContent = "D1–D4 complete. Ask E1–E4, complete the driver observation summary and export the session.";
}
function initDriverControls() {
 $("#fac-driver-respond").addEventListener("click", () => applyDriverPassengerResponse());
 $("#fac-driver-accept").addEventListener("click", () => applyDriverPassengerResponse("accepted"));
 $("#fac-driver-reply").addEventListener("click", () => applyDriverPassengerResponse("contact_reply"));
 $("#fac-observation-type").addEventListener("change", renderDriverControls);
 $("#fac-driver-mirror").addEventListener("click", toggleDriverMirror);
 $("#fac-driver-stage").addEventListener("change", () => {
  if (!isDriverInterview() || state.attempt.status !== "running") return;
  const stage = $("#fac-driver-stage").value;
  if (!["dispatch","approach","safely_stopped","after_collection","after_trip"].includes(stage)) return;
  driverInterviewState().workflowStage = stage;
  log("simulated_workflow_stage", {stage, recorded_by:"facilitator"}); persist();
 });
}

function renderDriverClock() {
 const text = `${state.attempt.status} · ${Math.floor(elapsedMs()/1000)} s elapsed · no deadline`;
 if ($("#fac-run-status").textContent !== text) $("#fac-run-status").textContent = text;
}

/* Driver map content follows the current interaction, independently of passenger fixtures. */
function driverMapPresentation() {
 const ui = state.ui, original = selectedSpot(), active = driverPickupTarget();
 if (!active) return [];
 const pending = getSpot(isDriverInterview() ? driverInterviewState().pendingId : ui.driverSuggested);
 const browsing = ui.driverSuggestOpen || ui.driverAddMode;
 const candidates = browsing ? (isDriverInterview() ? driverAlternatives() : alternativesFor(active)).map(item => item.spot) : [];
 const visible = new Map([active, original, pending, ...candidates].filter(Boolean).map(spot => [spot.id, spot]));
 const inspected = browsing && visible.has(ui.driverInspectId) ? getSpot(ui.driverInspectId) : null;
 const highlighted = inspected || pending || active;
 const frozen = Boolean(state.scenario.study && (state.attempt.status !== "running" || state.attempt.pausedAt));
 const mirror = isDriverInterview() && driverInterviewState().mirror;
 return [...visible.values()].filter(spot => validCoords(spot.coordinates)).map(spot => {
  const kind = spot.id === active.id ? "agreed" : spot.id === pending?.id ? "proposed" : spot.id === original?.id ? "original" : "candidate";
  const labelled = spot.id === highlighted.id || (Boolean(pending) && spot.id === active.id);
  return {spot, kind, labelled, accepted:kind === "agreed" && active.id !== original?.id,
   // Split the two labels above/below their pins, ordered by latitude, to avoid overlap.
   below:Boolean(pending && labelled && validCoords(active.coordinates) && validCoords(pending.coordinates) &&
    (spot.id === active.id ? active.coordinates[0] < pending.coordinates[0] : pending.coordinates[0] <= active.coordinates[0])),
   interactive:!frozen && !mirror && !dispatchPending() && (browsing || kind === "agreed" || kind === "proposed"),
  };
 });
}
function driverMapCaption({kind, accepted}) {
 const agreed = dispatchPending() ? "Requested pickup" : "Agreed pickup";
 return {agreed:accepted ? `${agreed} · updated` : agreed, proposed:"Proposed pickup", original:"Original pickup", candidate:"Alternative pickup"}[kind];
}
function driverMapIcon(item) {
 const {spot, kind, labelled, accepted, below} = item;
 const caption = driverMapCaption(item);
 return L.divIcon({className:"pin-shell",iconSize:[0,0],iconAnchor:[0,0],html:
  `<div class="driver-map-pin ${kind} ${spot.status}${accepted ? " accepted" : ""}${below ? " label-below" : ""}"><span class="driver-map-dot"></span>${labelled ? `<span class="driver-map-label"><small>${caption}</small><strong>${escapeHtml(spot.name)}</strong></span>` : ""}</div>`});
}
function renderDriverMap() {
 const presentation = driverMapPresentation();
 for (const item of presentation) {
  L.marker(item.spot.coordinates, {icon:driverMapIcon(item),interactive:item.interactive,keyboard:item.interactive,
   title:`${item.kind === "original" ? "Original pickup" : STATUS_LABEL[item.spot.status]}: ${item.spot.name}`,
   zIndexOffset:item.labelled ? 1000 : item.kind === "original" ? 100 : 500})
   .on("click", () => onPinTap(item.spot.id)).addTo(markerLayer);
 }
 L.marker(DRIVER_POSITION, {icon:carIcon(),interactive:false,keyboard:false}).addTo(markerLayer);
 const active = driverPickupTarget();
 if (validCoords(active?.coordinates)) L.polyline([DRIVER_POSITION,active.coordinates], {color:"#ffffff",weight:2,opacity:0.35}).addTo(routeLayer);
 const pending = presentation.find(item => item.kind === "proposed")?.spot;
 if (pending && validCoords(active?.coordinates)) L.polyline([active.coordinates,pending.coordinates], {color:"#ffb340",weight:2,opacity:0.7,dashArray:"5 7"}).addTo(routeLayer);
 const added = state.ui.driverPending;
 if (added && validCoords(added.coordinates)) L.marker(added.coordinates, {
  icon:driverMapIcon({spot:{...added,status:"unknown"},kind:"proposed",labelled:true,below:true}),interactive:false,keyboard:false,
 }).addTo(markerLayer);
}
function focusDriverMap() {
 const presentation = driverMapPresentation();
 const points = presentation.map(item => item.spot);
 if (!state.ui.driverSuggestOpen && !state.ui.driverAddMode) points.unshift({coordinates:DRIVER_POSITION});
 focusPoints(points);
}
