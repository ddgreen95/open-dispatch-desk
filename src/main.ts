import "@fontsource/fraunces/latin-600.css";
import "@fontsource/source-sans-3/latin-400.css";
import "@fontsource/source-sans-3/latin-600.css";
import "./style.css";
import { createDeskState, removeAddedTicket } from "./desk/actions.mjs";
import { runTurn, type PeerAsk } from "./runtime/engine";
import { validatePublished } from "./runtime/validate.mjs";

const SETTINGS_KEY = "open-dispatch-desk.settings";
const KEY_KEY = "open-dispatch-desk.apiKey";
const CONSENT_KEY = "open-dispatch-desk.consent";

const PRESETS: Record<string, { baseUrl: string; model: string }> = {
  otari: { baseUrl: "https://api.otari.ai/api/v1", model: "alibaba/qwen3.8-flash" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  custom: { baseUrl: "", model: "" },
};

interface Settings {
  mode: "demo" | "byok";
  provider: string;
  baseUrl: string;
  model: string;
}

const state = createDeskState();
let network: Record<string, unknown> = { tools: [] };
let manifestOk = false;
let busy = false;
const history: Array<{ role: "user" | "assistant"; content: string }> = [];

const log = document.querySelector<HTMLElement>("#chat-log")!;
const prompts = document.querySelector<HTMLElement>("#prompts")!;
const form = document.querySelector<HTMLFormElement>("#composer")!;
const message = document.querySelector<HTMLTextAreaElement>("#message")!;
const send = document.querySelector<HTMLButtonElement>("#send")!;
const working = document.querySelector<HTMLElement>("#working")!;
const trace = document.querySelector<HTMLOListElement>("#trace")!;
const modeChip = document.querySelector<HTMLElement>("#mode-chip")!;
const bootError = document.querySelector<HTMLElement>("#boot-error")!;
const settingsDialog = document.querySelector<HTMLDialogElement>("#settings")!;
const consentDialog = document.querySelector<HTMLDialogElement>("#consent")!;
const intakeBanner = document.querySelector<HTMLElement>("#intake-banner")!;
const detail = document.querySelector<HTMLElement>("#ticket-detail")!;

function defaults(): Settings {
  return { mode: "demo", provider: "otari", ...PRESETS.otari };
}

function loadSettings(): Settings {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "");
    if (parsed && (parsed.mode === "demo" || parsed.mode === "byok")) {
      return {
        mode: parsed.mode,
        provider: typeof parsed.provider === "string" ? parsed.provider : "custom",
        baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
        model: typeof parsed.model === "string" ? parsed.model : "",
      };
    }
  } catch {
    // Ignore a damaged settings blob and start from demo mode.
  }
  return defaults();
}

let settings = loadSettings();

function savedKey(): string {
  return localStorage.getItem(KEY_KEY) || "";
}

function paintMode() {
  const key = savedKey();
  if (settings.mode === "demo") {
    modeChip.textContent = key ? "Demo mode · saved key unused" : "Demo mode · no key";
  } else if (!key) {
    modeChip.textContent = "Key needed";
  } else {
    modeChip.textContent = `Your key · ${settings.provider}`;
  }
}

function publishedUrl(file: string): string {
  return new URL(file, new URL(import.meta.env.BASE_URL, window.location.href)).href;
}

function addBubble(role: "user" | "desk", text: string) {
  const item = document.createElement("p");
  item.className = `bubble ${role}`;
  item.textContent = text;
  log.append(item);
  log.scrollTop = log.scrollHeight;
}

function paintTrace(lines: Array<{ agent: string; detail: string }>) {
  trace.replaceChildren();
  for (const line of lines) {
    const item = document.createElement("li");
    item.textContent = `${line.agent}: ${line.detail}`;
    trace.append(item);
  }
}

function paintBoard() {
  const columns = ["waiting", "in_progress", "done"] as const;
  for (const column of columns) {
    const list = document.querySelector<HTMLOListElement>(`#list-${column}`)!;
    const count = document.querySelector<HTMLElement>(`#count-${column}`)!;
    const tickets = state.tickets.filter((ticket) => ticket.column === column);
    count.textContent = String(tickets.length);
    list.replaceChildren();
    if (!tickets.length) {
      const empty = document.createElement("li");
      empty.textContent = "None";
      list.append(empty);
      continue;
    }
    for (const ticket of tickets) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = `card${ticket.added ? " fresh" : ""}`;
      const id = document.createElement("strong");
      id.textContent = ticket.id;
      const title = document.createElement("span");
      title.textContent = ticket.title;
      const place = document.createElement("em");
      place.textContent = ticket.place;
      button.append(id, title, place);
      button.addEventListener("click", () => showTicket(ticket.id));
      item.append(button);
      list.append(item);
    }
  }
  if (state.latestIntake) {
    intakeBanner.hidden = false;
    intakeBanner.textContent = state.latestIntake.ownerSummary;
  } else {
    intakeBanner.hidden = true;
    intakeBanner.textContent = "";
  }
}

function showTicket(id: string) {
  const ticket = state.tickets.find((item) => item.id === id);
  if (!ticket) {
    detail.hidden = true;
    return;
  }
  detail.hidden = false;
  detail.replaceChildren();
  const title = document.createElement("h3");
  title.textContent = `${ticket.id} · ${ticket.title}`;
  const place = document.createElement("p");
  place.textContent = ticket.place;
  const note = document.createElement("p");
  note.textContent = ticket.note;
  detail.append(title, place, note);
  if (ticket.added) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ghost";
    remove.textContent = "Remove this sample request";
    remove.addEventListener("click", () => {
      removeAddedTicket(state, ticket.id);
      detail.hidden = true;
      paintBoard();
    });
    detail.append(remove);
  }
}

function resetBoard() {
  const fresh = createDeskState();
  state.tickets = fresh.tickets;
  state.nextId = fresh.nextId;
  state.latestIntake = null;
  detail.hidden = true;
  paintBoard();
}

function remembered(origin: string): boolean {
  try {
    const map = JSON.parse(sessionStorage.getItem(CONSENT_KEY) || "{}") as Record<string, string>;
    return map[origin] === "allow";
  } catch {
    return false;
  }
}

function remember(origin: string) {
  const map = JSON.parse(sessionStorage.getItem(CONSENT_KEY) || "{}") as Record<string, string>;
  map[origin] = "allow";
  sessionStorage.setItem(CONSENT_KEY, JSON.stringify(map));
}

function confirmPeer(ask: PeerAsk): Promise<"allow" | "deny"> {
  if (remembered(ask.origin)) return Promise.resolve("allow");
  document.querySelector("#consent-purpose")!.textContent = ask.purpose;
  document.querySelector("#consent-label")!.textContent = ask.label || "Published agent site";
  document.querySelector("#consent-origin")!.textContent = ask.origin;
  document.querySelector("#consent-url")!.textContent = ask.url;
  consentDialog.showModal();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer: "allow" | "deny", persist = false) => {
      if (settled) return;
      settled = true;
      if (persist) remember(ask.origin);
      if (consentDialog.open) consentDialog.close();
      resolve(answer);
    };
    (document.querySelector("#consent-allow") as HTMLButtonElement).onclick = () => finish("allow");
    (document.querySelector("#consent-tab") as HTMLButtonElement).onclick = () => finish("allow", true);
    (document.querySelector("#consent-deny") as HTMLButtonElement).onclick = () => finish("deny");
    consentDialog.addEventListener("close", () => finish("deny"), { once: true });
  });
}

async function ask(text: string) {
  const trimmed = text.trim();
  if (!trimmed || busy) return;
  busy = true;
  send.disabled = true;
  working.hidden = false;
  addBubble("user", trimmed);
  message.value = "";
  let reply = "";
  try {
    const result = await runTurn({
      text: trimmed,
      mode: settings.mode,
      settings: {
        baseUrl: settings.baseUrl,
        model: settings.model || "alibaba/qwen3.8-flash",
        apiKey: savedKey(),
      },
      state,
      network,
      history,
      confirmPeer,
      onDelta: (partial) => {
        reply = partial;
      },
    });
    reply = result.reply;
    paintTrace(result.trace);
  } catch (error) {
    reply = error instanceof Error ? error.message : "The desk stopped.";
    paintTrace([{ agent: "runtime", detail: reply }]);
  }
  addBubble("desk", reply);
  history.push({ role: "user", content: trimmed }, { role: "assistant", content: reply });
  if (history.length > 12) history.splice(0, history.length - 12);
  paintBoard();
  busy = false;
  send.disabled = false;
  working.hidden = true;
}

function fillSettingsForm() {
  const formEl = document.querySelector<HTMLFormElement>("#settings-form")!;
  const mode = formEl.querySelector<HTMLInputElement>(`input[value="${settings.mode}"]`);
  if (mode) mode.checked = true;
  const provider = formEl.querySelector<HTMLSelectElement>("#provider")!;
  provider.value = PRESETS[settings.provider] ? settings.provider : "custom";
  formEl.querySelector<HTMLInputElement>("#base-url")!.value = settings.baseUrl;
  formEl.querySelector<HTMLInputElement>("#model")!.value = settings.model;
  formEl.querySelector<HTMLInputElement>("#api-key")!.value = "";
}

function openSettings() {
  fillSettingsForm();
  settingsDialog.showModal();
}

function saveSettings(event: Event) {
  event.preventDefault();
  const data = new FormData(document.querySelector<HTMLFormElement>("#settings-form")!);
  const mode = data.get("mode") === "byok" ? "byok" : "demo";
  const provider = String(data.get("provider") || "custom");
  settings = {
    mode,
    provider,
    baseUrl: String(data.get("baseUrl") || "").trim(),
    model: String(data.get("model") || "").trim(),
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  const typed = String(data.get("apiKey") || "");
  if (typed.trim()) localStorage.setItem(KEY_KEY, typed.trim());
  paintMode();
  settingsDialog.close();
}

function clearSettings() {
  localStorage.removeItem(SETTINGS_KEY);
  localStorage.removeItem(KEY_KEY);
  settings = defaults();
  paintMode();
  fillSettingsForm();
}

async function boot() {
  paintBoard();
  paintMode();
  addBubble(
    "desk",
    "Hello. I am the front desk at Lakeside Tech Desk. This is a fictional sample desk: I can read the sample board, leave a work request for the owner to review, or draft a client-safe status from a job note. Nothing is sent. Demo mode needs no key.",
  );
  try {
    const [manifestRes, networkRes] = await Promise.all([
      fetch(publishedUrl("agent-manifest.json")),
      fetch(publishedUrl("lakeside_tech_desk.network.json")),
    ]);
    const rawManifest = await manifestRes.text();
    const rawNetwork = await networkRes.text();
    const loadedManifest = JSON.parse(rawManifest);
    network = JSON.parse(rawNetwork);
    const check = validatePublished(loadedManifest, network, { rawManifest, rawNetwork });
    if (!check.ok) throw new Error(check.errors.join(" "));
    manifestOk = true;
    const queries = loadedManifest.networks[0].sample_queries as string[];
    for (const query of queries) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = query;
      button.addEventListener("click", () => {
        message.value = query;
        void ask(query);
      });
      prompts.append(button);
    }
  } catch (error) {
    manifestOk = false;
    bootError.hidden = false;
    bootError.textContent = error instanceof Error ? error.message : "The published network could not be loaded.";
  }
  if (!manifestOk) {
    addBubble("desk", "The published network did not load, so I will not pretend to run it. The sample board is still here.");
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void ask(message.value);
});
document.querySelector("#reset-board")!.addEventListener("click", resetBoard);
document.querySelector("#open-settings")!.addEventListener("click", openSettings);
document.querySelector("#close-settings")!.addEventListener("click", () => settingsDialog.close());
document.querySelector("#settings-form")!.addEventListener("submit", saveSettings);
document.querySelector("#clear-settings")!.addEventListener("click", clearSettings);
document.querySelector("#provider")!.addEventListener("change", (event) => {
  const value = (event.target as HTMLSelectElement).value;
  const preset = PRESETS[value];
  if (!preset || value === "custom") return;
  document.querySelector<HTMLInputElement>("#base-url")!.value = preset.baseUrl;
  document.querySelector<HTMLInputElement>("#model")!.value = preset.model;
});

void boot();
