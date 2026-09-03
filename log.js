/* Browser-side event log. Entries live in memory, mirrored to localStorage so a reload
   does not lose them, and leave the device only when the facilitator exports a file.
   Nothing here talks to a network. */

const EventLog = (() => {
  const KEY = "pp:log";
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
      /* Storage full or unavailable. The in-memory log still works for the session. */
    }
  }

  function record(session, event, payload = {}) {
    const entry = {
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

  function toCSV() {
    const header = [
      "participant_id",
      "session_role",
      "scenario_id",
      "variant",
      "order_position",
      "timestamp",
      "event",
      "payload_json",
    ];
    const rows = entries.map((entry) =>
      [
        entry.participant_id,
        entry.session_role,
        entry.scenario_id,
        entry.variant,
        entry.order_position,
        entry.timestamp,
        entry.event,
        JSON.stringify(entry.payload),
      ]
        .map(csvCell)
        .join(","),
    );
    return [header.join(","), ...rows].join("\n");
  }

  function filename(session, extension) {
    const date = new Date().toISOString().slice(0, 10);
    const safe = (text) => String(text || "unknown").replace(/[^A-Za-z0-9_-]+/g, "-");
    return `${safe(session.participantId)}_${date}_${safe(session.scenarioId)}.${extension}`;
  }

  function buildFile(session, format) {
    const isCsv = format === "csv";
    const content = isCsv ? toCSV() : JSON.stringify(entries, null, 2);
    const type = isCsv ? "text/csv" : "application/json";
    return new File([content], filename(session, isCsv ? "csv" : "json"), { type });
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

  return { record, all, count, clear, toCSV, filename, exportAs };
})();
