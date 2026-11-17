import { createDeskState, formatStatusReply, runAction } from "../desk/actions.mjs";
import { planDemoTurn } from "./demo.mjs";
import { completeChat, type ChatMessage, type LlmSettings } from "./llm";
import { loadPeerNetwork, safeToolName, summarizeLoadedPeer } from "./peer.mjs";

export type DeskState = ReturnType<typeof createDeskState>;

export interface PeerAsk {
  origin: string;
  url: string;
  purpose: string;
  label?: string;
}

export interface TraceLine {
  agent: string;
  detail: string;
}

export interface TurnInput {
  text: string;
  mode: "demo" | "byok";
  settings: LlmSettings;
  state: DeskState;
  network: PublishedNetwork;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  confirmPeer: (ask: PeerAsk) => Promise<"allow" | "deny">;
  fetchImpl?: typeof fetch;
  onDelta?: (text: string) => void;
}

export interface TurnResult {
  reply: string;
  trace: TraceLine[];
}

interface AgentSpec {
  name: string;
  function?: { description?: string; parameters?: unknown };
  instructions?: string;
  tools?: unknown[];
  allow?: {
    to_downstream?: { sly_data?: string[] };
    to_upstream?: { sly_data?: string[] };
  };
}

interface PublishedNetwork {
  tools?: AgentSpec[];
  link_labels?: Record<string, string>;
  llm_config?: { model_name?: string };
  max_steps?: number;
  max_execution_seconds?: number;
}

interface Budget {
  started: number;
  invocations: number;
  remote: number;
}

interface RunContext {
  input: TurnInput;
  trace: TraceLine[];
  budget: Budget;
  stack: string[];
  localActions: boolean;
  network: PublishedNetwork;
}

const LIMITS = { depth: 5, invocations: 12, remote: 2 };

function agentsOf(network: PublishedNetwork): Map<string, AgentSpec> {
  const map = new Map<string, AgentSpec>();
  for (const agent of network.tools || []) {
    if (agent?.name) map.set(agent.name, agent);
  }
  return map;
}

function peerLabel(network: PublishedNetwork, url: string): string {
  return network.link_labels?.[url] || "Published agent site";
}

function frontPeer(network: PublishedNetwork): { url: string; label: string } | null {
  const front = (network.tools || []).find((agent) => agent.name === "front_desk_coordinator");
  const url = (front?.tools || []).find((ref) => typeof ref === "string" && /^https?:\/\//.test(ref));
  if (typeof url !== "string") return null;
  return { url, label: peerLabel(network, url) };
}

function toolResult(payload: unknown): string {
  return JSON.stringify(payload);
}

function actionPayload(name: string, args: Record<string, unknown>, state: DeskState): string {
  const outcome = runAction(name, args, state);
  if (outcome.status !== "succeeded") return outcome.message || "Error from tool.";
  return toolResult({ status: outcome.status, result: outcome.result });
}

function checkBudget(ctx: RunContext) {
  const seconds = ctx.input.network.max_execution_seconds || 45;
  if (Date.now() - ctx.budget.started > seconds * 1000) {
    throw new Error("Stopped: time budget reached.");
  }
  if (ctx.budget.invocations >= LIMITS.invocations) {
    throw new Error("Stopped: agent invocation budget reached.");
  }
}

async function runPeer(ctx: RunContext, url: string, request: string): Promise<string> {
  if (!url) return "Error from tool: that peer link has no URL.";
  if (ctx.budget.remote >= LIMITS.remote) return "Error from tool: peer call budget reached.";
  ctx.budget.remote += 1;
  const loaded = await loadPeerNetwork(url, ctx.input.fetchImpl || fetch, async (ask: { origin: string; url: string; purpose: string }) => {
    const answer = await ctx.input.confirmPeer({
      ...ask,
      label: peerLabel(ctx.network, url),
    });
    return answer === "allow";
  });
  for (const line of loaded.trace) ctx.trace.push({ agent: "runtime", detail: line });
  if (loaded.declined || !("entry" in loaded)) {
    return "The user declined to contact that site. Nothing was fetched.";
  }
  const label = peerLabel(ctx.network, url);
  if (ctx.input.mode === "demo") {
    ctx.trace.push({ agent: "runtime", detail: "Demo mode stopped before any model call on the peer network." });
    return summarizeLoadedPeer(loaded.entry, label);
  }
  ctx.trace.push({
    agent: "runtime",
    detail: `Running ${loaded.entry.front_man} in this browser. The peer origin does not receive the provider key.`,
  });
  const nested: RunContext = {
    input: ctx.input,
    trace: ctx.trace,
    budget: ctx.budget,
    localActions: false,
    network: loaded.network as PublishedNetwork,
    stack: ctx.stack.slice(),
  };
  return runAgent(nested, loaded.entry.front_man, request);
}

function functionTools(ctx: RunContext, agent: AgentSpec): Array<Record<string, unknown>> {
  const catalog = agentsOf(ctx.network);
  const tools: Array<Record<string, unknown>> = [];
  for (const ref of agent.tools || []) {
    if (typeof ref === "string" && catalog.has(ref)) {
      const child = catalog.get(ref)!;
      tools.push({
        type: "function",
        function: {
          name: child.name,
          description: child.function?.description || child.name,
          parameters: child.function?.parameters || { type: "object", properties: {} },
        },
      });
    } else if (typeof ref === "string" && /^https?:\/\//.test(ref)) {
      const pathName = safeToolName(new URL(ref).pathname);
      tools.push({
        type: "function",
        function: {
          name: pathName,
          description: `${peerLabel(ctx.network, ref)}. Published network URL: ${ref}. Ask only what that public example can describe. Do not include names, emails, phone numbers, or ticket notes.`,
          parameters: {
            type: "object",
            properties: {
              request: { type: "string", description: "A short question for that published network." },
            },
            required: ["request"],
          },
        },
      });
    }
  }
  if (ctx.localActions) {
    tools.push(
      {
        type: "function",
        function: {
          name: "website_get_desk_state",
          description: "Read the fictional desk summary and the sample ticket board.",
          parameters: { type: "object", properties: {}, additionalProperties: false },
        },
      },
      {
        type: "function",
        function: {
          name: "website_record_sample_intake",
          description: "Add a sample work request to Waiting and return an owner summary. Nothing is sent.",
          parameters: {
            type: "object",
            properties: {
              summary: { type: "string" },
              place: { type: "string" },
              when: { type: "string" },
            },
            required: ["summary"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "website_prepare_status_draft",
          description: "Draft a client-safe status from a pasted job note. Nothing is sent.",
          parameters: {
            type: "object",
            properties: { note: { type: "string" } },
            required: ["note"],
          },
        },
      },
    );
  }
  return tools;
}

function peerUrlForTool(agent: AgentSpec, toolName: string): string | null {
  for (const ref of agent.tools || []) {
    if (typeof ref === "string" && /^https?:\/\//.test(ref) && safeToolName(new URL(ref).pathname) === toolName) {
      return ref;
    }
  }
  return null;
}

async function dispatchTool(ctx: RunContext, agent: AgentSpec, name: string, args: Record<string, unknown>): Promise<string> {
  const catalog = agentsOf(ctx.network);
  if (catalog.has(name)) {
    const request = typeof args.request === "string" ? args.request : JSON.stringify(args);
    ctx.trace.push({ agent: agent.name, detail: `Called ${name}.` });
    return runAgent(ctx, name, request);
  }
  const peerUrl = peerUrlForTool(agent, name);
  if (peerUrl) {
    const request = typeof args.request === "string" ? args.request : JSON.stringify(args);
    ctx.trace.push({ agent: agent.name, detail: `Asked to contact ${new URL(peerUrl).origin}.` });
    return runPeer(ctx, peerUrl, request.slice(0, 500));
  }
  if (!ctx.localActions && name.startsWith("website_")) {
    return "Error from tool: website tools are not available when another site runs this network.";
  }
  if (name === "website_get_desk_state") {
    ctx.trace.push({ agent: agent.name, detail: "Read the sample board." });
    return actionPayload("get_desk_state", {}, ctx.input.state);
  }
  if (name === "website_record_sample_intake") {
    ctx.trace.push({ agent: agent.name, detail: "Recorded a sample intake locally." });
    return actionPayload("record_sample_intake", args, ctx.input.state);
  }
  if (name === "website_prepare_status_draft") {
    ctx.trace.push({ agent: agent.name, detail: "Prepared a client-safe draft." });
    return actionPayload("prepare_status_draft", args, ctx.input.state);
  }
  return `Error from tool: ${name} is not available.`;
}

async function runAgent(ctx: RunContext, name: string, request: string): Promise<string> {
  checkBudget(ctx);
  if (ctx.stack.includes(name)) throw new Error(`Stopped: composition cycle at ${name}.`);
  if (ctx.stack.length >= LIMITS.depth) throw new Error("Stopped: composition depth reached.");
  const agent = agentsOf(ctx.network).get(name);
  if (!agent) return `Error from tool: missing agent ${name}.`;
  ctx.budget.invocations += 1;
  ctx.stack.push(name);
  try {
    const down = agent.allow?.to_downstream?.sly_data ?? [];
    if (down.length) {
      ctx.trace.push({ agent: name, detail: "Downstream private fields were filtered to the published allow list." });
    }
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `${agent.instructions}\n\nRuntime notes: private context is not included. Call only the tools you were given. A missing website_* tool means you are answering for another site: describe this desk and point to its page. Do not invent tickets or claim that anyone was contacted.`,
      },
      { role: "user", content: request },
    ];
    const steps = Math.min(ctx.input.network.max_steps || 8, 8);
    for (let step = 0; step < steps; step += 1) {
      checkBudget(ctx);
      const turn = await completeChat({
        settings: ctx.input.settings,
        messages,
        tools: functionTools(ctx, agent),
        signal: AbortSignal.timeout((ctx.input.network.max_execution_seconds || 45) * 1000),
        onDelta: name === "front_desk_coordinator" ? ctx.input.onDelta : undefined,
      });
      if (!turn.toolCalls.length) return turn.content.trim() || "The agent returned an empty answer.";
      messages.push({
        role: "assistant",
        content: turn.content,
        tool_calls: turn.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.arguments },
        })),
      });
      for (const call of turn.toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(call.arguments || "{}");
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("arguments were not an object");
          }
          args = parsed as Record<string, unknown>;
        } catch {
          messages.push({ role: "tool", tool_call_id: call.id, content: "Error from tool: arguments were not valid JSON." });
          continue;
        }
        const result = await dispatchTool(ctx, agent, call.name, args);
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
    }
    return "Stopped: the agent used its step budget before it answered.";
  } finally {
    ctx.stack.pop();
  }
}

async function runDemo(input: TurnInput, trace: TraceLine[]): Promise<string> {
  const peer = frontPeer(input.network);
  const plan = planDemoTurn(input.text, peer || undefined) as {
    kind: string;
    reply?: string;
    trace: TraceLine[];
    intake?: { summary: string; place: string; when: string };
    note?: string;
  };
  trace.push(...plan.trace);
  if (plan.reply) return plan.reply;
  if (plan.kind === "status") {
    const outcome = runAction("get_desk_state", {}, input.state);
    return formatStatusReply(outcome.result);
  }
  if (plan.kind === "intake" && plan.intake) {
    const outcome = runAction("record_sample_intake", plan.intake, input.state);
    if (!outcome.result.ok) return `Nothing was added. ${outcome.result.reason}`;
    return String(outcome.result.ownerSummary);
  }
  if (plan.kind === "job_note") {
    const outcome = runAction("prepare_status_draft", { note: plan.note }, input.state);
    if (!outcome.result.ok) return String(outcome.result.reason);
    return String(outcome.result.draft);
  }
  if (plan.kind === "peer") {
    if (!peer?.url) return "This desk has no published peer link to call.";
    return runPeer(
      {
        input,
        trace,
        budget: { started: Date.now(), invocations: 1, remote: 0 },
        stack: ["front_desk_coordinator"],
        localActions: true,
        network: input.network,
      },
      peer.url,
      "What does this published example help with?",
    );
  }
  return "The front desk has nothing to add.";
}

export async function runTurn(input: TurnInput): Promise<TurnResult> {
  const trace: TraceLine[] = [];
  const text = input.text.trim();
  if (!text) return { reply: "Type a message for the front desk.", trace };
  if (input.mode === "demo") {
    return { reply: await runDemo(input, trace), trace };
  }
  if (!input.settings.apiKey.trim()) {
    return {
      reply: "Add a provider key in Model settings, or switch back to demo mode. Demo mode answers without a key.",
      trace,
    };
  }
  trace.push({
    agent: "runtime",
    detail: `Model requests go to ${new URL(input.settings.baseUrl).origin} only.`,
  });
  const history = input.history.slice(-6).map((message) => `${message.role}: ${message.content}`).join("\n\n");
  const request = history ? `${history}\n\nuser: ${text}` : text;
  const ctx: RunContext = {
    input,
    trace,
    budget: { started: Date.now(), invocations: 0, remote: 0 },
    stack: [],
    localActions: true,
    network: input.network,
  };
  const reply = await runAgent(ctx, "front_desk_coordinator", request);
  return { reply, trace };
}

