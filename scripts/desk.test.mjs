import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createDeskState, draftFromNote, recordSampleIntake, runAction } from "../src/desk/actions.mjs";
import { classify } from "../src/runtime/demo.mjs";
import { loadPeerNetwork, publicArtifactInit, resolvePublishedNetwork } from "../src/runtime/peer.mjs";

const root = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(path.join(root, "public/agent-manifest.json"), "utf8"));
const queries = manifest.networks[0].sample_queries;

test("sample prompts route to the three desk jobs, a refusal, and the peer", () => {
  assert.equal(classify(queries[0]), "status");
  assert.equal(classify(queries[1]), "intake");
  assert.equal(classify(queries[2]), "job_note");
  assert.equal(classify(queries[3]), "decline");
  assert.equal(classify(queries[4]), "peer");
});

test("a sample intake lands on the board and says nothing was sent", () => {
  const state = createDeskState();
  const before = state.tickets.length;
  const outcome = recordSampleIntake(state, {
    summary: "Wi-Fi is down at a small office",
    place: "small office",
    when: "",
  });
  assert.equal(outcome.ok, true);
  assert.equal(state.tickets.length, before + 1);
  assert.equal(state.tickets[0].column, "waiting");
  assert.match(outcome.ownerSummary, /Nothing was sent, posted, or billed/);
  assert.match(outcome.ownerSummary, /LD-1060/);
  assert.doesNotMatch(outcome.ownerSummary, /invoice number|we emailed/i);
});

test("a job note draft keeps the visit facts and drops a revealed password", () => {
  const clean = draftFromNote(
    "On site at Maple Street Books. Router power light was amber. Reseated the cable. No passwords were changed.",
  );
  assert.equal(clean.ok, true);
  assert.match(clean.draft, /Maple Street Books/);
  assert.match(clean.draft, /Nothing was sent/);
  assert.match(clean.draft, /No passwords were changed/);
  const leaked = draftFromNote("The router was dark. The password is hunter2. Cable reseated.");
  assert.equal(leaked.ok, true);
  assert.doesNotMatch(leaked.draft, /hunter2/);
  assert.match(leaked.draft, /Cable reseated/);
});

test("status action lists the fictional waiting ticket", () => {
  const outcome = runAction("get_desk_state", {}, createDeskState());
  assert.equal(outcome.status, "succeeded");
  const waiting = outcome.result.columns.waiting.map((ticket) => ticket.id);
  assert.ok(waiting.includes("LD-1042"));
});

test("peer artifact requests carry no key", () => {
  const init = publicArtifactInit();
  assert.equal(init.credentials, "omit");
  assert.deepEqual(Object.keys(init.headers), ["Accept"]);
  assert.equal("Authorization" in init.headers, false);
});

test("the Little Oven URL resolves to the official example network name", () => {
  const network = JSON.parse(readFileSync(path.join(root, "public/lakeside_tech_desk.network.json"), "utf8"));
  const url = network.tools[0].tools.find((ref) => String(ref).startsWith("https://"));
  const located = resolvePublishedNetwork(url);
  assert.equal(located.name, "pizza_restaurant_website_assistant");
  assert.equal(located.origin, "https://raw.githubusercontent.com");
  assert.match(located.manifestUrl, /agent-manifest\.json$/);
});

test("a declined peer is not fetched", async () => {
  let fetches = 0;
  const result = await loadPeerNetwork(
    "https://raw.githubusercontent.com/cognizant-ai-labs/agentic-web/main/examples/pizza_restaurant_agentified/pizza_restaurant_website_assistant",
    async () => {
      fetches += 1;
      throw new Error("fetch should not run");
    },
    async () => false,
  );
  assert.equal(result.declined, true);
  assert.equal(fetches, 0);
});
