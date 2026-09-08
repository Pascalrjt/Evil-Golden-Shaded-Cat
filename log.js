/* Browser-side event log. Entries live in memory, mirrored to localStorage so a reload
   does not lose them, and leave the device only when the facilitator exports a file.
   Nothing here talks to a network. */

const EventLog = (() => {
  const KEY = "pp:log";
  let storageWarning=false;
  let entries = load();

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || [];
    } catch (error) {
      return [];
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(entries));
    } catch (error) {
      storageWarning=true;
    }
  }

  function record(session, event, payload = {}) {
    const entry = {
      mode: session.mode || "study",
      study_prepared: session.prepared,
      prototype_version: PROTOTYPE_VERSION,
      session_id: session.id,
      attempt_id: session.attemptId,
      attempt_kind: session.attemptKind,
      group: session.group,
      location: session.location,
      think_aloud: Boolean(session.thinkAloud),
      device: session.device,
      participant_id: session.participantId,
      session_role: session.role,
      scenario_id: session.scenarioId,
      variant: session.variant,
      order_position: session.orderPosition,
      timestamp: new Date().toISOString(),
      event,
      payload,
    };
    entries.push(entry);
    save();
    document.dispatchEvent(new CustomEvent("pp:log", { detail: entry }));
    return entry;
  }

  function all() {
    return entries.slice();
  }

  function count() {
    return entries.length;
  }

  function clear() {
    entries = [];
    save();
    document.dispatchEvent(new CustomEvent("pp:log", { detail: null }));
  }

  function csvCell(value) {
    const text = value === undefined || value === null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function csv(rows,header) {
    return [header.join(","), ...rows.map(row=>header.map(key=>csvCell(typeof row[key]==="object"?JSON.stringify(row[key]):row[key])).join(","))].join("\n");
  }
  function toCSV() {
    return csv(entries,["mode","study_prepared","prototype_version","session_id","attempt_id","attempt_kind","participant_id","session_role","scenario_id","location","group","variant","order_position","think_aloud","device","timestamp","event","payload"]);
  }
  function summaries() {
    const attempts=new Map();
    for (const e of entries) {
      if (!e.attempt_id || e.mode === "preview" || e.study_prepared === false) continue;
      if (!attempts.has(e.attempt_id)) attempts.set(e.attempt_id,{prototype_version:e.prototype_version,session_id:e.session_id,attempt_id:e.attempt_id,attempt_kind:e.attempt_kind,participant_id:e.participant_id,scenario_id:e.scenario_id,location:e.location,group:e.group,variant:e.variant,order_position:e.order_position,think_aloud:e.think_aloud,started:false,task_outcome:"unstarted",confirmation_occurred:false,chosen_pickup_suitability:"no_confirmed_choice",observations:[]});
      const row=attempts.get(e.attempt_id);
      if (e.event==="task_started") Object.assign(row,{started:true,started_at:e.timestamp,task_outcome:"in_progress",think_aloud:e.payload.think_aloud});
      if (e.event==="task_ended") Object.assign(row,e.payload,{ended_at:e.timestamp,chosen_spot_id:e.payload.chosen?.spot_id,chosen_label:e.payload.chosen?.label});
      if (e.event==="deadline_reconciled") Object.assign(row,e.payload);
      if (e.event==="facilitator_observation") row.observations.push(e.payload);
      if (e.event==="task_outcome_review") { row.reviewed_task_outcome=e.payload.value; row.outcome_review_note=e.payload.note; }
    }
    const rows=[...attempts.values()];
    const sessions=new Map();
    for (const row of rows) if (SCENARIOS[row.scenario_id]?.study) sessions.set(row.session_id,row);
    for (const row of sessions.values()) {
      (STUDY_GROUPS[row.group] || []).forEach((scenario_id,index)=>{
        if (rows.some(r=>r.session_id===row.session_id && r.scenario_id===scenario_id)) return;
        const scenario=getScenario(scenario_id);
        rows.push({prototype_version:row.prototype_version,session_id:row.session_id,attempt_id:null,attempt_kind:"planned",participant_id:row.participant_id,scenario_id,location:scenario.location,group:row.group,variant:scenario.variant,order_position:index+1,think_aloud:false,started:false,task_outcome:"unstarted",confirmation_occurred:false,chosen_pickup_suitability:"no_confirmed_choice",observations:[]});
      });
    }
    for (const session of sessions.values()) {
      const assigned=STUDY_GROUPS[session.group] || [];
      const incomplete=rows.some(row=>row.session_id===session.session_id && row.skipped && assigned.includes(row.scenario_id));
      for (const row of rows) if (row.session_id===session.session_id) row.p4_comparison_incomplete=incomplete;
    }
    return rows;
  }
  function summaryCSV() {
    return csv(summaries(),["prototype_version","session_id","attempt_id","attempt_kind","participant_id","scenario_id","location","group","variant","order_position","think_aloud","started","started_at","ended_at","task_outcome","reviewed_task_outcome","outcome_review_note","confirmation_occurred","chosen_spot_id","chosen_label","chosen_pickup_suitability","decision","stop_reason","abandoned","skipped","skip_stage","skip_reason","p4_comparison_incomplete","elapsed_ms","wall_elapsed_ms","script_pause_ms","assistance_count","report_count","report_attempt_count","p4_report_flag","p3_report_accepted","p3_requirements_met","practice","chosen","displayed","observations"]);
  }

  function filename(session, extension) {
    const date = new Date().toISOString().slice(0, 10);
    const safe = (text) => String(text || "unknown").replace(/[^A-Za-z0-9_-]+/g, "-");
    return `${safe(session.participantId)}_${date}_${safe(session.scenarioId)}.${extension}`;
  }

  function buildFile(session, format) {
    const isCsv = format === "csv" || format === "summary";
    const content = format === "summary" ? summaryCSV() : isCsv ? toCSV() : JSON.stringify(entries, null, 2);
    const type = isCsv ? "text/csv" : "application/json";
    return new File([content], filename(session, format === "summary" ? "summary.csv" : isCsv ? "csv" : "json"), { type });
  }

  function download(file) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* On phones the share sheet lets the facilitator send the file straight to OneDrive.
     Everywhere else the file downloads. */
  async function exportAs(session, format, preferShare) {
    const file = buildFile(session, format);
    if (preferShare && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: file.name });
        return "shared";
      } catch (error) {
        if (error && error.name === "AbortError") return "cancelled";
      }
    }
    download(file);
    return "downloaded";
  }

  return { record, all, count, clear, toCSV, summaries, summaryCSV, filename, exportAs, storageWarning:()=>storageWarning };
})();
