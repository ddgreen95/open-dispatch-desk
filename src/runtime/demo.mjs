/**
 * Deterministic demo replies. No model call and no network I/O.
 */

const ABOUT_REPLY = [
  "Hello. I am the front desk at Lakeside Tech Desk.",
  "",
  "This is a fictional sample desk. I can tell you what it does and which sample tickets are waiting, leave a work request for the owner to review, or turn a pasted job note into a client-safe status draft.",
  "",
  "Nothing is emailed, billed, or sent. Try a sample prompt, or ask what is on the board.",
].join("\n");

const DECLINE_REPLY = [
  "I can't do that from this page.",
  "",
  "Lakeside Tech Desk does not email, text, call, invoice, bill, store passwords, sign in to accounts, or open a remote session. It does not contact a shop or investigate a break-in.",
  "",
  "I can leave a sample work request on the board, or draft a client-safe status from a job note you paste. Nothing is sent.",
].join("\n");

function isJobNote(text) {
  return /job note|client-safe|status draft|paste this/i.test(text);
}

function isPeer(text) {
  return /little oven|pizza example|official example|pizza restaurant/i.test(text);
}

function isStatus(text) {
  return /what does|what do you do|which sample tickets|what is currently|on the board|\btickets?\b/i.test(text);
}

function isIntake(text) {
  return /wi-?fi|printer|monitor|backup|laptop|work request|is down|not working|flicker/i.test(text);
}

function isSending(text) {
  return /\b(send|e-?mail|invoice|bill|charge)\b/i.test(text);
}

function isForbidden(text) {
  if (/\b(e-?mail|invoice|billing|payment|charge)\b/i.test(text)) return true;
  if (/\bremote (in|access|session)\b/i.test(text)) return true;
  if (/\b(text|call|phone) (the )?(client|customer|them)\b/i.test(text)) return true;
  if (/\b(hack|ransomware|virus|malware)\b/i.test(text)) return true;
  if (/\bpassword\b/i.test(text) && !/\bno passwords?\b/i.test(text)) return true;
  return false;
}

export function classify(text) {
  const q = String(text || "").trim();
  if (!q) return "empty";
  if (isSending(q) && isForbidden(q)) return "decline";
  if (isJobNote(q)) return "job_note";
  if (isForbidden(q)) return "decline";
  if (isPeer(q)) return "peer";
  const status = isStatus(q);
  const intake = isIntake(q);
  if (intake && /work request|is down|not working/i.test(q)) return "intake";
  if (status && !intake) return "status";
  if (intake) return "intake";
  if (status) return "status";
  return "about";
}

export function intakeFields(text) {
  const summary = String(text || "").replace(/\s+/g, " ").trim().slice(0, 400);
  let place = "";
  if (/small office/i.test(text)) place = "small office";
  else if (/\bhome\b/i.test(text)) place = "home";
  else if (/\boffice\b/i.test(text)) place = "office";
  let when = "";
  const whenMatch = String(text).match(/\b(today|tomorrow|this morning|this afternoon|this week)\b/i);
  if (whenMatch) when = whenMatch[1].toLowerCase();
  return { summary, place, when };
}

export function extractNote(text) {
  const source = String(text || "").trim();
  const marker = source.match(/job note:\s*|client-safe status:\s*|status draft:\s*/i);
  if (marker && marker.index !== undefined) {
    return source.slice(marker.index + marker[0].length).trim();
  }
  return source;
}

export function planDemoTurn(text, peer) {
  const kind = classify(text);
  const trace = [{ agent: "front_desk_coordinator", detail: "Read the visitor's message." }];
  if (kind === "empty") {
    return { kind, reply: "Type a message for the front desk.", trace };
  }
  if (kind === "decline") {
    trace.push({ agent: "front_desk_coordinator", detail: "Declined a request this desk does not do." });
    return { kind, reply: DECLINE_REPLY, trace };
  }
  if (kind === "peer") {
    trace.push({
      agent: "front_desk_coordinator",
      detail: "This needs the official pizza example. Ask before any contact.",
    });
    return {
      kind,
      trace,
      peer: {
        url: peer?.url || "",
        label: peer?.label || "Official example",
        purpose: "Read what the published pizza-restaurant example says it can do.",
      },
    };
  }
  if (kind === "job_note") {
    trace.push({ agent: "front_desk_coordinator", detail: "Handed the note to the job-note agent." });
    trace.push({ agent: "job_note_agent", detail: "Called website_prepare_status_draft." });
    return { kind, trace, note: extractNote(text) };
  }
  if (kind === "intake") {
    trace.push({ agent: "front_desk_coordinator", detail: "Called website_record_sample_intake." });
    return { kind, trace, intake: intakeFields(text) };
  }
  if (kind === "status") {
    trace.push({ agent: "front_desk_coordinator", detail: "Asked the status agent." });
    trace.push({ agent: "status_agent", detail: "Called website_get_desk_state." });
    return { kind, trace };
  }
  trace.push({ agent: "front_desk_coordinator", detail: "Answered from the desk introduction." });
  return { kind, reply: ABOUT_REPLY, trace };
}

export { ABOUT_REPLY, DECLINE_REPLY };
