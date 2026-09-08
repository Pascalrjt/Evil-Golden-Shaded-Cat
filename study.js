/* Study controls, timing and observation markers. Loaded before app.js; called after boot. */
function newAttempt() {
 return {id:crypto.randomUUID(),status:"ready",startedAt:null,endedAt:null,pausedAt:null,pausedMs:0,assists:0,reportCount:0,reportAttemptCount:0,revealedAt:null,reportAccepted:false,arrivalMarked:false,screenRevealedAt:null,summary:null};
}
function isPreview() { return state.session.mode === "preview"; }
function sessionPrepared() { return state.session.prepared ?? Boolean(state.scenario.study); }
function timedTaskRunning() { return !isPreview() && state.scenario.study && state.attempt.status === "running"; }
function assignedSequence() { return ["P0", "P1", "P2", "P3", ...STUDY_GROUPS[state.session.group || "A"]]; }
function supportingVisible() { return state.session.role === "driver" || state.scenario.variant !== "unexplained"; }
function spotSnapshot(spot) {
 if (!spot) return null;
 return {spot_id:spot.id,label:spot.name,address:spot.address,suitability:spot.status,evidence_state:spot.state,reason:spot.reason,report_count:spot.reportCount,age:spot.ageText,source:sourceText(spot),history:structuredClone(spot.history || []),simulated:true};
}
function displayedSnapshot(spot) {
 if (!spot) return null;
 const visible=supportingVisible();
 return {spot_id:spot.id,label:spot.name,status:STATUS_LABEL[spot.status],reason:visible?spot.reason:null,freshness:visible?freshnessText(spot):null,source:visible?sourceText(spot):null,supporting_information_visible:visible};
}
function elapsedMs(now=Date.now()) {
 const a=state.attempt;
 if (!a || !a.startedAt) return 0;
 return Math.max(0,(a.endedAt || a.pausedAt || now)-a.startedAt-a.pausedMs);
}
function studyCanInteract() {
 if (!state.scenario.study) return true;
 if (isPreview()) return state.attempt.status !== "ended" && !state.attempt.pausedAt;
 checkStudyDeadline();
 if (state.attempt.status === "ready") {
  openFacilitator(true);
  const button = sessionPrepared() ? $("#fac-start-task") : $("#fac-sequence");
  button.scrollIntoView({block:"center"}); button.focus();
  showToast("Prepare to begin", sessionPrepared() ? "Read the prompt, then press Start task." : "Enter the participant and group, then press Prepare session. Use Preview for an untimed walkthrough.");
  return false;
 }
 return state.attempt.status === "running" && !state.attempt.pausedAt;
}
function startTask() {
 const a=state.attempt;
 if (isPreview() || !sessionPrepared() || !state.scenario.study || a.status!=="ready") return;
 if (state.scenario.p4 && STUDY_GROUPS[state.session.group]?.[state.session.orderPosition-1]!==state.scenario.id) { showToast("Check allocation","Load the condition and order assigned to this study group."); return; }
 a.status="running"; a.startedAt=Date.now();
 state.session.thinkAloud=state.scenario.p4?false:$("#fac-think-aloud").checked;
 log("task_started",{limit_seconds:state.scenario.limitSeconds,think_aloud:state.session.thinkAloud,simulated_start:state.ui.userPosition,fixture:state.spots.map(spotSnapshot)});
 openFacilitator(false); render();
}
/* Optional P3 script pause. Passenger controls are never gated on it; the facilitator prompts the participant before confirmation. */
function scriptPaused() { return state.scenario.id==="P3" && Boolean(state.attempt.pausedAt); }
function revealObstruction() {
 const a=state.attempt;
 if (state.scenario.id!=="P3" || a.status!=="running" || a.pausedAt) return;
 a.pausedAt=Date.now(); a.revealedAt=a.revealedAt || a.pausedAt;
 log("obstruction_reveal_started",{spot_id:state.scenario.presetSpot,selected_spot_id:state.ui.selectedSpotId,target_selected:state.ui.selectedSpotId===state.scenario.presetSpot,scene:"Temporary barriers are blocking the kerb",status_unchanged:getSpot(state.scenario.presetSpot).status});
 openFacilitator(false); render();
}
function finishReveal() {
 const a=state.attempt;
 if (!scriptPaused()) return;
 const duration=Date.now()-a.pausedAt; a.pausedMs+=duration; a.pausedAt=null;
 log("obstruction_reveal_ended",{pause_ms:duration}); openFacilitator(false); render();
}
function finishTask(reason,chosen=null,decision=null,endAt=Date.now()) {
 const a=state.attempt;
 const skipped=reason==="skipped_before_start" || reason==="skipped_after_start";
 if (!state.scenario.study || (a.status!=="running" && !(skipped && a.status==="ready"))) return;
 if (a.pausedAt) { a.pausedMs+=endAt-a.pausedAt; a.pausedAt=null; }
 a.endedAt=endAt; a.status="ended";
 if (isPreview()) {
  log("preview_ended", {reason, chosen:spotSnapshot(chosen)});
  closeReport(false); render(); return;
 }
 const confirmed=Boolean(chosen);
 const p3Requirements=state.scenario.id!=="P3" || (a.reportAccepted && chosen && chosen.id!==state.scenario.presetSpot);
 const outcome=skipped?reason:reason==="abandoned"?"abandoned":confirmed&&p3Requirements?(a.assists?"assisted":"independent"):"incomplete";
 a.summary={stop_reason:reason,task_outcome:outcome,confirmation_occurred:confirmed,chosen_pickup_suitability:chosen?chosen.status:"no_confirmed_choice",chosen:spotSnapshot(chosen),displayed:displayedSnapshot(chosen),elapsed_ms:elapsedMs(),wall_elapsed_ms:a.endedAt-a.startedAt,script_pause_ms:a.pausedMs,decision:state.scenario.p4?(decision || "no_decision"):null,abandoned:reason==="abandoned",assistance_count:a.assists,report_count:a.reportCount,report_attempt_count:a.reportAttemptCount,p4_report_flag:Boolean(state.scenario.p4&&a.reportAttemptCount),p3_report_accepted:a.reportAccepted,p3_requirements_met:Boolean(p3Requirements),practice:state.scenario.id==="P0"};
 a.summary.skipped=skipped;
 a.summary.skip_reason=skipped?a.skipReason:null;
 a.summary.skip_stage=skipped?(a.startedAt===null?"before_start":"after_start"):null;
 if (a.startedAt===null) { a.summary.elapsed_ms=null; a.summary.wall_elapsed_ms=null; }
 log("task_ended",a.summary);
 closeReport(false);
 render();
}
function checkStudyDeadline() {
 const a=state.attempt;
 if (isPreview() || !state.scenario.study || !a || a.status!=="running" || a.pausedAt) return;
 const elapsed=elapsedMs();
 if (state.scenario.p4 && elapsed>=120000 && !a.arrivalMarked) {
  a.arrivalMarked=true; log("arrival_cue_elapsed",{seconds:120,external_timer:true});
 }
 if (elapsed>=state.scenario.limitSeconds*1000) {
  // Clamp to the study deadline even when the browser throttles background timers.
  const deadline=a.startedAt+a.pausedMs+state.scenario.limitSeconds*1000;
  finishTask("timeout",null,null,deadline);
  persist();
 }
}
function recordObservation() {
 const kind=$("#fac-observation-type").value;
 const note=$("#fac-observation-note").value.trim();
 if (!note) { showToast("Add an observation","Enter the exact prompt, error, interpretation or recording reference."); return; }
 log("facilitator_observation",{kind,note,elapsed_ms:elapsedMs()});
 $("#fac-observation-note").value="";
 if (kind==="assistance" && state.attempt.status==="running") {
  state.attempt.assists++;
  if (state.attempt.assists>=2 && ["P1","P2","P3"].includes(state.scenario.id)) finishTask("assistance_limit");
 }
 if (kind==="task_outcome") log("task_outcome_review",{value:$("#fac-outcome").value,note});
 persist(); renderFacilitator();
}
function prepareSession() {
 if (timedTaskRunning()) return;
 const participant = $("#fac-pid").value.trim();
 if (!participant) { showToast("Participant ID required", "Enter the participant ID before preparing the session."); $("#fac-pid").focus(); return; }
 loadScenario("P0", participant, null, 1, {mode:"study", prepared:true, newSession:true, group:$("#fac-group").value});
 openFacilitator(true);
}
function changeMode(mode) {
 if (timedTaskRunning()) { $("#fac-mode").value=state.session.mode || "study"; showToast("End the current task first", "Use End task to record its outcome before changing mode."); return; }
 loadScenario(mode === "technical" ? "FREE" : "P0", state.session.participantId, null, 1, {mode, prepared:false, newSession:true, group:state.session.group});
 openFacilitator(true);
}
function loadNextTask(startSequence=false) {
 if (startSequence) return prepareSession();
 if (isPreview() || state.attempt.status!=="ended") return;
 const sequence=assignedSequence();
 const next=sequence.indexOf(state.scenario.id)+1;
 if (next>=sequence.length) return;
 loadScenario(sequence[next],state.session.participantId,null,next>=4?next-3:1,{group:state.session.group,prepared:true});
 openFacilitator(true);
}
function confirmTaskEnd() {
 const reason=$("#fac-end-reason").value;
 if (!["facilitator_stop","abandoned"].includes(reason)) { showToast("Choose a reason", "Select who ended the task before confirming."); return; }
 finishTask(reason); $("#fac-end-options").hidden=true;
}
function canSkipScenario() {
 return state.scenario.study && !isPreview() && state.session.mode!=="technical" && sessionPrepared()
  && ["ready","running"].includes(state.attempt.status) && assignedSequence().includes(state.scenario.id);
}
function openSkipScenario() {
 checkStudyDeadline();
 if (!canSkipScenario()) return;
 $("#fac-end-options").hidden=true;
 $("#fac-skip-options").dataset.attemptId=state.attempt.id;
 $("#fac-skip-options").hidden=false;
 $("#fac-skip-reason").value="";
 $("#fac-skip-reason").focus();
}
function confirmScenarioSkip() {
 checkStudyDeadline();
 if (!canSkipScenario() || $("#fac-skip-options").dataset.attemptId!==state.attempt.id) return;
 const reason=$("#fac-skip-reason").value.trim();
 if (!reason) { showToast("Add a reason", "Enter why this scenario is being skipped."); $("#fac-skip-reason").focus(); return; }
 const scenarioId=state.scenario.id, p4=state.scenario.p4;
 state.attempt.skipReason=reason;
 finishTask(state.attempt.startedAt===null?"skipped_before_start":"skipped_after_start");
 $("#fac-skip-options").hidden=true;
 $("#fac-skip-reason").value="";
 loadNextTask();
 openFacilitator(true);
 showToast(`${scenarioId} skipped`, p4?"Reason saved. The P4 comparison is flagged incomplete in exports.":"Reason and any existing activity saved.");
}
function renderStudyControls() {
 const a=state.attempt;
 const preview=isPreview(), technical=state.session.mode === "technical";
 const prepared=sessionPrepared(), running=timedTaskRunning();
 const ready=!preview && !technical && prepared && a.status === "ready";
 const ended=!preview && !technical && prepared && a.status === "ended";
 const last=assignedSequence().indexOf(state.scenario.id) === assignedSequence().length-1;
 $("#fac-mode").value=state.session.mode || "study";
 $("#fac-mode").disabled=running;
 $("#fac-mode-help").textContent=preview ? "Untimed walkthrough. Select a scenario and interact immediately. Preview activity is excluded from participant results." : technical ? "Use Advanced controls for driver views and fault testing." : "Prepare the session, read each prompt, then start the task.";
 $("#fac-setup").hidden=preview || technical || prepared;
 $("#fac-preview-picker").hidden=!preview;
 $("#fac-current-task").hidden=!preview && (technical || !prepared);
 $("#fac-task-heading").textContent=`${state.scenario.id} · ${state.scenario.label}`;
 $("#fac-task").textContent=state.scenario.task || "";
 $("#fac-run-status").textContent=preview ? (a.status === "ended" ? "Preview complete. Select another scenario or restart in Advanced controls." : "Preview · untimed") : `${a.status} · ${Math.floor(elapsedMs()/1000)} s · ${a.assists} assists`;
 $("#fac-start-task").hidden=!ready;
 $("#fac-start-task").disabled=!ready;
 $("#fac-next").hidden=!ended || last;
 $("#fac-sequence-complete").hidden=!ended || !last;
 $("#fac-stop-task").hidden=!running;
 $("#fac-skip-task").hidden=!canSkipScenario();
 if (!canSkipScenario() || $("#fac-skip-options").dataset.attemptId!==a.id) $("#fac-skip-options").hidden=true;
 if (!running) $("#fac-end-options").hidden=true;
 $("#fac-reveal").hidden=state.scenario.id!=="P3" || a.status!=="running" || Boolean(a.pausedAt);
 $("#fac-reveal").disabled=false;
 $("#fac-reveal-end").hidden=!scriptPaused() || a.status!=="running";
 $("#fac-reveal-end").disabled=false;
 $("#fac-think-field").hidden=!ready || Boolean(state.scenario.p4);
 $("#fac-think-aloud").disabled=!ready || Boolean(state.scenario.p4);
 if (state.scenario.p4) $("#fac-think-aloud").checked=false;
 $("#fac-study-guidance").hidden=preview && state.scenario.id!=="P3";
 $("#fac-study-guidance").textContent=state.scenario.p4?"Run the separate 2-minute arrival timer. Give the six-item form immediately after decision or timeout, before probes.":state.scenario.id==="P3"?"All pickup controls work as normal. Prompt the participant about the barriers before they confirm a pickup. Reveal obstruction pauses the timer while you read the script; Resume continues it. Use the separate P3-E card afterwards.":"Read the prompt, then press Start task. Record assistance and comprehension below.";
 if (!preview && ended) $("#fac-study-guidance").textContent=state.scenario.p4 ? "Give the six-item form before probes, then finish observations before continuing." : "Finish observations before continuing to the next scenario.";
 else if (running && state.scenario.id!=="P3" && !state.scenario.p4) $("#fac-study-guidance").textContent="The task is running. Record assistance and comprehension below.";
 $("#fac-result").hidden=preview || !a.summary;
 $("#fac-result").textContent=a.summary?`${a.summary.task_outcome} · chosen suitability: ${a.summary.chosen_pickup_suitability} · ${a.summary.decision || a.summary.stop_reason}`:"";
 $("#fac-observations").hidden=preview || technical || !prepared || a.status === "ready";
 $("#fac-technical-controls").hidden=!technical;
 $("#fac-new-session").hidden=preview || technical || !prepared;
 $("#fac-new-session").disabled=running;
 $("#fac-load").disabled=running;
 $("#fac-reset").disabled=running || (!preview && !technical && !prepared);
 $("#fac-scenario").disabled=running;
 $("#fac-allocation").hidden=!state.scenario.p4;
 $("#fac-allocation").textContent=`${state.session.variant === "unexplained" ? "NOEXP" : "EXP"} · position ${state.session.orderPosition} · group ${state.session.group}`;
}
function studyNotice() {
 const a=state.attempt;
 if (!state.scenario.study) return "";
 if (a.status==="ended" && state.ui.screen!=="confirmed") return '<header class="sheet-header"><h1>Task finished</h1><p>Please hand the device back to the facilitator.</p></header>';
 if (scriptPaused()) return '<header class="sheet-header"><p class="eyebrow">Scenario update</p><h1>Temporary barriers are blocking the kerb.</h1><p>Please listen to the facilitator.</p></header>';
 return "";
}
function initStudyControls() {
 $("#fac-start-task").addEventListener("click",startTask);
 $("#fac-stop-task").addEventListener("click",()=>{ $("#fac-skip-options").hidden=true; $("#fac-end-options").hidden=false; $("#fac-end-reason").value=""; $("#fac-end-reason").focus(); });
 $("#fac-skip-task").addEventListener("click",openSkipScenario);
 $("#fac-skip-confirm").addEventListener("click",confirmScenarioSkip);
 $("#fac-skip-cancel").addEventListener("click",()=>{ $("#fac-skip-options").hidden=true; $("#fac-skip-reason").value=""; });
 $("#fac-end-confirm").addEventListener("click",confirmTaskEnd);
 $("#fac-end-cancel").addEventListener("click",()=>{ $("#fac-end-options").hidden=true; });
 $("#fac-mode").addEventListener("change",()=>changeMode($("#fac-mode").value));
 $("#fac-new-session").addEventListener("click",()=>changeMode("study"));
 $("#fac-preview-scenario").addEventListener("change",()=>{
  loadScenario($("#fac-preview-scenario").value,state.session.participantId,null,1,{mode:"preview",prepared:false});
  openFacilitator(false);
 });
 $("#fac-reveal").addEventListener("click",revealObstruction);
 $("#fac-reveal-end").addEventListener("click",finishReveal);
 $("#fac-observation-save").addEventListener("click",recordObservation);
 $("#fac-sequence").addEventListener("click",()=>loadNextTask(true));
 $("#fac-next").addEventListener("click",()=>loadNextTask());
 window.setInterval(()=>{
  checkStudyDeadline();
  if (!$("#facilitator").hidden) renderStudyControls();
 },250);
}
