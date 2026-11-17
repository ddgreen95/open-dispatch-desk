import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { validatePublished } from "../src/runtime/validate.mjs";

const root = path.resolve(import.meta.dirname, "..");

function read(rel) {
  return readFileSync(path.join(root, rel), "utf8");
}

test("published site actions match the module the page runs", () => {
  assert.equal(read("public/site-actions.js"), read("src/desk/actions.mjs"));
});

test("published manifest and network match the MVP fields", () => {
  const rawManifest = read("public/agent-manifest.json");
  const rawNetwork = read("public/lakeside_tech_desk.network.json");
  const manifest = JSON.parse(rawManifest);
  const network = JSON.parse(rawNetwork);
  const result = validatePublished(manifest, network, { rawManifest, rawNetwork });
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.equal(manifest.networks[0].name, "lakeside_tech_desk");
  assert.equal(manifest.networks[0].front_man, "front_desk_coordinator");
  assert.equal(manifest.networks[0].hocon, "./lakeside_tech_desk.network.json");
  assert.equal(manifest.peer_policy.mode, "closed");
  assert.ok(manifest.llm_router.base_url.startsWith("https://"));
  const names = network.tools.map((agent) => agent.name);
  assert.deepEqual(names, ["front_desk_coordinator", "status_agent", "job_note_agent"]);
  assert.deepEqual(network.tools[0].allow.to_downstream.sly_data, []);
  assert.deepEqual(network.tools[0].allow.to_upstream.sly_data, []);
  assert.equal(manifest.actions.agentTools.includes("record_sample_intake"), true);
});

test("a network with no front agent fails closed", () => {
  const manifest = JSON.parse(read("public/agent-manifest.json"));
  const network = JSON.parse(read("public/lakeside_tech_desk.network.json"));
  manifest.networks[0].front_man = "missing_agent";
  const result = validatePublished(manifest, network, {});
  assert.equal(result.ok, false);
  assert.match(result.errors.join(" "), /front_man/);
});

test("environment substitutions are rejected", () => {
  const manifest = JSON.parse(read("public/agent-manifest.json"));
  const network = JSON.parse(read("public/lakeside_tech_desk.network.json"));
  const result = validatePublished(manifest, network, { rawNetwork: '{"tools": "${HOME}"}' });
  assert.equal(result.ok, false);
});

test("published files do not name forbidden subjects or look like secrets", () => {
  const banned = [/cloudnet/i, /stormy/i, /agent center/i, /cybersecurity/i, /\bsk-[A-Za-z0-9]{8,}/, /AKIA[0-9A-Z]{8,}/];
  const files = walk(path.join(root, "public")).concat(walk(path.join(root, "src")));
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const pattern of banned) {
      assert.equal(pattern.test(text), false, `${file} matched ${pattern}`);
    }
  }
});

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
