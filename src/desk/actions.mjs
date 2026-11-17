/**
 * Sample desk state and local site actions.
 * Nothing here sends, posts, bills, or contacts anyone.
 */

/**
 * @typedef {object} DeskTicket
 * @property {string} id
 * @property {string} title
 * @property {string} place
 * @property {string} column
 * @property {string} note
 * @property {boolean} added
 */

/**
 * @typedef {object} DeskState
 * @property {number} nextId
 * @property {{ id: string, ownerSummary: string } | null} latestIntake
 * @property {DeskTicket[]} tickets
 */

/** @returns {DeskState} */
export function createDeskState() {
  return {
    nextId: 1060,
    latestIntake: null,
    tickets: [
      {
        id: "LD-1042",
        title: "Wi-Fi drops in the back room",
        place: "Maple Street Books",
        column: "waiting",
        note: "Guest network disappears after lunch. Fictional sample ticket.",
        added: false,
      },
      {
        id: "LD-1055",
        title: "Monitor flickers after a desk move",
        place: "North Dock Apartments office",
        column: "waiting",
        note: "The display cable may be loose. Fictional sample ticket.",
        added: false,
      },
      {
        id: "LD-1048",
        title: "Printer stays asleep",
        place: "Harbor Lane Studio",
        column: "in_progress",
        note: "A power cycle helped once. Fictional sample ticket.",
        added: false,
      },
      {
        id: "LD-1031",
        title: "Laptop joined the guest network",
        place: "Cedar Court Office",
        column: "done",
        note: "Fictional sample ticket, marked done.",
        added: false,
      },
      {
        id: "LD-1019",
        title: "Mail app signed in on the office computer",
        place: "Pine Desk Bookkeeping",
        column: "done",
        note: "Fictional sample ticket. No password is stored here.",
        added: false,
      },
    ],
  };
}

export const DESK_SUMMARY =
  "Lakeside Tech Desk is a fictional one-person help desk for home and small-office computer troubles.";

export const DESK_DOES = [
  "Wi-Fi that drops or will not join",
  "Printers that stall or stay asleep",
  "Setting up a new computer for everyday use",
  "A backup drive that does not show up",
  "A client-safe status draft from a job note you paste",
];

export const DESK_DOES_NOT = [
  "Email, text, or phone calls",
  "Invoices, billing, or payment",
  "Storing passwords or signing in to accounts",
  "Remote access to a computer",
  "Contacting a shop or vendor",
  "Network monitoring or break-in investigations",
];

const COLUMNS = ["waiting", "in_progress", "done"];

export function snapshotDesk(state) {
  const columns = {};
  for (const column of COLUMNS) {
    columns[column] = state.tickets
      .filter((ticket) => ticket.column === column)
      .map((ticket) => ({
        id: ticket.id,
        title: ticket.title,
        place: ticket.place,
        note: ticket.note,
      }));
  }
  return {
    ok: true,
    desk: DESK_SUMMARY,
    does: DESK_DOES.slice(),
    doesNot: DESK_DOES_NOT.slice(),
    columns,
  };
}

export function formatStatusReply(snapshot) {
  const lines = [
    snapshot.desk,
    "",
    "It can help with:",
    ...snapshot.does.map((item) => `- ${item}`),
    "",
    "It will not:",
    ...snapshot.doesNot.map((item) => `- ${item}`),
    "",
    "Sample tickets:",
  ];
  const labels = [
    ["waiting", "Waiting"],
    ["in_progress", "In progress"],
    ["done", "Done"],
  ];
  for (const [column, label] of labels) {
    lines.push("", label);
    const items = snapshot.columns[column] || [];
    if (!items.length) lines.push("- None");
    else {
      for (const ticket of items) {
        lines.push(`- ${ticket.id} — ${ticket.title} (${ticket.place})`);
      }
    }
  }
  lines.push("", "These are sample tickets. Nothing has been sent to a client.");
  return lines.join("\n");
}

export function draftFromNote(note) {
  const original = String(note || "").trim();
  if (!original) return { ok: false, reason: "Paste a job note first." };
  if (original.length > 2000) {
    return { ok: false, reason: "That note is too long for this sample desk." };
  }
  const sentences = original.split(/(?<=[.!?])\s+/);
  const kept = [];
  let removed = 0;
  for (const sentence of sentences) {
    const secret =
      /\b(password|passcode|api key|secret)\b/i.test(sentence) &&
      /\b(is|was|:|=)\b/i.test(sentence) &&
      !/\bno passwords?\b/i.test(sentence);
    if (secret || /\bsk-[A-Za-z0-9]/.test(sentence)) {
      removed += 1;
      continue;
    }
    const trimmed = sentence.trim();
    if (trimmed) kept.push(trimmed);
  }
  const body = kept.join(" ").replace(/\s+/g, " ").trim();
  if (!body) return { ok: false, reason: "Nothing client-safe was left in that note." };
  const draft = [
    "Client-safe status draft",
    "",
    "For the owner to review. Nothing was sent.",
    "",
    body,
    "",
    removed
      ? `Removed ${removed} sentence${removed === 1 ? "" : "s"} that looked like a secret.`
      : "Only wording from the pasted note is included above.",
  ].join("\n");
  return { ok: true, draft, removed };
}

function clean(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function recordSampleIntake(state, input) {
  const summary = clean(input?.summary, 400);
  if (!summary) return { ok: false, reason: "Say what is wrong, in a sentence or two." };
  if (/\b(password|passcode)\s*(is|=|:)\s*\S+/i.test(summary)) {
    return { ok: false, reason: "Do not put a password in a sample request." };
  }
  const place = clean(input?.place, 80);
  const when = clean(input?.when, 80);
  const id = `LD-${state.nextId}`;
  state.nextId += 1;
  const title = summary.length > 72 ? `${summary.slice(0, 69)}...` : summary;
  const ticket = {
    id,
    title,
    place: place || "Place not specified",
    column: "waiting",
    note: "Sample intake added in this browser. For the owner to review. Nothing was sent.",
    added: true,
  };
  state.tickets.unshift(ticket);
  const ownerSummary = [
    "Intake summary for the owner",
    "",
    "For review on this page only. Nothing was sent, posted, or billed.",
    "",
    `Request: ${summary}`,
    `Place: ${place || "not specified"}`,
    `When: ${when || "not specified"}`,
    `Sample ticket: ${id} · Waiting`,
    "",
    "The owner can read this on the board. This desk did not contact anyone.",
  ].join("\n");
  state.latestIntake = { id, ownerSummary };
  return { ok: true, ticket: { id, title, place: ticket.place, column: "waiting" }, ownerSummary };
}

export function removeAddedTicket(state, id) {
  const ticket = state.tickets.find((item) => item.id === id);
  if (!ticket || !ticket.added) {
    return { ok: false, reason: "Only sample requests added in this session can be removed." };
  }
  state.tickets = state.tickets.filter((item) => item.id !== id);
  if (state.latestIntake?.id === id) state.latestIntake = null;
  return { ok: true };
}

export const ACTION_CATALOG = [
  {
    name: "get_desk_state",
    effect: "read",
    description:
      "Read what Lakeside Tech Desk does, what it will not do, and the sample tickets on the board.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "record_sample_intake",
    effect: "write",
    description:
      "Add a sample work request to the Waiting column and return an intake summary for the owner. Nothing is sent.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "What the visitor needs, in their words.",
        },
        place: {
          type: "string",
          description: "Home or office, if they said.",
        },
        when: {
          type: "string",
          description: "When they hope for help, if they said.",
        },
      },
      required: ["summary"],
      additionalProperties: false,
    },
  },
  {
    name: "prepare_status_draft",
    effect: "read",
    description:
      "Turn a pasted job note into a client-safe status draft. Uses only the note. Nothing is sent.",
    parameters: {
      type: "object",
      properties: {
        note: {
          type: "string",
          description: "The job note the visitor pasted.",
        },
      },
      required: ["note"],
      additionalProperties: false,
    },
  },
];

/**
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @param {DeskState} state
 * @returns {{ status: string, result?: any, message?: string }}
 */
export function runAction(name, args, state) {
  if (name === "get_desk_state") {
    return { status: "succeeded", result: snapshotDesk(state) };
  }
  if (name === "record_sample_intake") {
    return { status: "succeeded", result: recordSampleIntake(state, args || {}) };
  }
  if (name === "prepare_status_draft") {
    return { status: "succeeded", result: draftFromNote(args?.note) };
  }
  return { status: "error", message: `Error from tool: unknown action ${name}.` };
}

export function registerActions(actions) {
  for (const spec of ACTION_CATALOG) {
    actions.register({
      name: spec.name,
      description: spec.description,
      inputSchema: spec.parameters,
      effect: spec.effect,
      availability: "local-only",
      callerOrigins: [],
      execute(args) {
        const outcome = runAction(spec.name, args, sharedState);
        if (outcome.status !== "succeeded") {
          throw new Error(outcome.message || "Action failed.");
        }
        return outcome.result;
      },
    });
  }
}

const sharedState = createDeskState();
