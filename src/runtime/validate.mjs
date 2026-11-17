/**
 * Checks a published agent manifest and resolved network against the MVP profile.
 */

const PLACEHOLDER = /\{[a-z_]{2,}\}/;
const ENV_SUB = /\$\{[^}]+\}/;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(errors, message) {
  errors.push(message);
}

export function validatePublished(manifest, network, file) {
  const errors = [];
  const raw = typeof file?.rawNetwork === "string" ? file.rawNetwork : "";
  const rawManifest = typeof file?.rawManifest === "string" ? file.rawManifest : "";
  if (ENV_SUB.test(raw) || ENV_SUB.test(rawManifest)) {
    fail(errors, "Published files contain an environment substitution.");
  }
  if (/\binclude\s+"/.test(raw) || /"include"\s*:/.test(raw)) {
    fail(errors, "Published network still has an include.");
  }
  if (/file:\/\//.test(raw) || /\/Users\//.test(raw) || /\/home\//.test(raw)) {
    fail(errors, "Published network contains a private filesystem path.");
  }

  if (!isObject(manifest)) fail(errors, "Manifest is not an object.");
  else {
    if (typeof manifest.brand !== "string" || !manifest.brand.trim()) {
      fail(errors, "Manifest brand is missing.");
    }
    if (!Array.isArray(manifest.networks) || manifest.networks.length < 1) {
      fail(errors, "Manifest networks must list at least one network.");
    } else {
      const entry = manifest.networks[0];
      for (const key of ["name", "front_man", "hocon", "description"]) {
        if (typeof entry?.[key] !== "string" || !entry[key].trim()) {
          fail(errors, `Manifest networks[0].${key} is missing.`);
        }
      }
      if (typeof entry?.hocon === "string") {
        if (!entry.hocon.startsWith("./") || entry.hocon.includes("..") || entry.hocon.includes("${")) {
          fail(errors, "Manifest hocon must be a relative resolved path.");
        }
      }
      if (!Array.isArray(entry?.sample_queries) || entry.sample_queries.length < 4) {
        fail(errors, "Manifest sample_queries needs at least four queries.");
      }
    }
    const router = manifest.llm_router;
    if (!isObject(router) || typeof router.base_url !== "string" || typeof router.byok_router !== "string") {
      fail(errors, "Manifest llm_router needs base_url and byok_router.");
    } else if (!router.base_url.startsWith("https://") || !router.byok_router.startsWith("https://")) {
      fail(errors, "Manifest llm_router URLs must be https.");
    }
    if (!isObject(manifest.peer_policy) || !["open", "closed"].includes(manifest.peer_policy.mode)) {
      fail(errors, "Manifest peer_policy.mode must be open or closed.");
    }
    if (!Array.isArray(manifest.allowed_peers)) {
      fail(errors, "Manifest allowed_peers must be an array.");
    }
    const tools = manifest.actions?.agentTools;
    if (!Array.isArray(tools) || tools.length < 1) {
      fail(errors, "Manifest actions.agentTools must list the local site actions.");
    }
  }

  if (!isObject(network)) fail(errors, "Network is not an object.");
  else {
    if (typeof network.metadata?.description !== "string" || !network.metadata.description.trim()) {
      fail(errors, "Network metadata.description is missing.");
    }
    const manifestQueries = manifest?.networks?.[0]?.sample_queries;
    const networkQueries = network.metadata?.sample_queries;
    if (JSON.stringify(manifestQueries || []) !== JSON.stringify(networkQueries || [])) {
      fail(errors, "Manifest sample_queries and network metadata.sample_queries differ.");
    }
    if (!Array.isArray(network.tools) || network.tools.length < 1) {
      fail(errors, "Network tools must list the agents.");
    }
    const names = new Set();
    for (const agent of network.tools || []) {
      if (!isObject(agent) || typeof agent.name !== "string" || !agent.name.trim()) {
        fail(errors, "An agent is missing a name.");
        continue;
      }
      if (names.has(agent.name)) fail(errors, `Duplicate agent name ${agent.name}.`);
      names.add(agent.name);
      if (typeof agent.function?.description !== "string" || !agent.function.description.trim()) {
        fail(errors, `${agent.name} is missing function.description.`);
      }
      if (!isObject(agent.function?.parameters)) {
        fail(errors, `${agent.name} is missing function.parameters.`);
      }
      if (typeof agent.instructions !== "string" || agent.instructions.trim().length < 40) {
        fail(errors, `${agent.name} is missing instructions.`);
      } else if (PLACEHOLDER.test(agent.instructions)) {
        fail(errors, `${agent.name} instructions still contain a placeholder.`);
      }
      const down = agent.allow?.to_downstream?.sly_data;
      const up = agent.allow?.to_upstream?.sly_data;
      if (!Array.isArray(down) || !Array.isArray(up)) {
        fail(errors, `${agent.name} must name downstream and upstream sly_data allow lists.`);
      }
      for (const ref of agent.tools || []) {
        if (typeof ref === "string") {
          const external = /^https?:\/\//.test(ref);
          if (!external && !names.has(ref) && !(network.tools || []).some((item) => item?.name === ref)) {
            fail(errors, `${agent.name} references missing agent ${ref}.`);
          }
          if (external) {
            let origin = "";
            try {
              origin = new URL(ref).origin;
            } catch {
              fail(errors, `${agent.name} has an invalid peer URL.`);
            }
            if (
              origin &&
              manifest?.peer_policy?.mode === "closed" &&
              !(manifest.allowed_peers || []).includes(origin)
            ) {
              fail(errors, `${origin} is not listed in allowed_peers.`);
            }
          }
        } else if (isObject(ref) && typeof ref.url === "string") {
          fail(errors, `${agent.name} references MCP (${ref.url}), which this demo does not publish.`);
        } else {
          fail(errors, `${agent.name} has a tool reference that is not a name or URL.`);
        }
      }
    }
    const front = manifest?.networks?.[0]?.front_man;
    if (front && !names.has(front)) {
      fail(errors, `front_man ${front} is not an agent in the network.`);
    }
    if (typeof network.llm_config?.model_name !== "string" || !network.llm_config.model_name) {
      fail(errors, "Network llm_config.model_name is missing.");
    }
  }

  return { ok: errors.length === 0, errors };
}
