/**
 * Peer-network URL resolution and public fetches.
 * Artifact requests never carry a visitor key.
 */

export function publicArtifactInit() {
  return {
    method: "GET",
    credentials: "omit",
    redirect: "manual",
    cache: "no-store",
    headers: { Accept: "application/json" },
  };
}

export function safeToolName(value) {
  return String(value).replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "").slice(0, 60) || "tool";
}

export function resolvePublishedNetwork(networkUrl) {
  let url;
  try {
    url = new URL(networkUrl);
  } catch {
    throw new Error("Peer network URL is not a URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Peer network URL must use http or https.");
  }
  if (url.username || url.password) {
    throw new Error("Peer network URL must not include credentials.");
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (!parts.length) throw new Error("Peer network URL needs a network name.");
  const name = decodeURIComponent(parts[parts.length - 1]);
  const basePath = parts.slice(0, -1).join("/");
  const base = `${url.origin}/${basePath}${basePath ? "/" : ""}`;
  return {
    name,
    origin: url.origin,
    base,
    manifestUrl: new URL("agent-manifest.json", base).href,
    linksUrl: new URL("links.json", base).href,
  };
}

export function selectManifestNetwork(manifest, name) {
  const networks = Array.isArray(manifest?.networks) ? manifest.networks : [];
  const matches = networks.filter((entry) => entry && entry.name === name);
  if (matches.length !== 1) {
    throw new Error(`Peer manifest has no exact network named ${name}.`);
  }
  return matches[0];
}

export function networkUrlFromEntry(entry, base) {
  if (!entry || typeof entry.hocon !== "string" || !entry.hocon.trim()) {
    throw new Error("Peer manifest entry has no network file.");
  }
  if (entry.hocon.includes("${") || entry.hocon.includes("include ")) {
    throw new Error("Peer network location is not fully resolved.");
  }
  const resolved = new URL(entry.hocon, base);
  if (resolved.username || resolved.password) {
    throw new Error("Peer network file URL must not include credentials.");
  }
  return resolved.href;
}

function redirected(response) {
  return [301, 302, 303, 307, 308].includes(response.status);
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, publicArtifactInit());
  if (response.type === "opaqueredirect") {
    throw new Error("The peer redirected and the browser hid the destination. Stopped before reading a body.");
  }
  if (redirected(response)) {
    const location = response.headers.get("Location");
    if (!location) throw new Error("Peer redirect had no destination.");
    return { redirect: new URL(location, url).href };
  }
  if (!response.ok) {
    throw new Error(`Peer file returned HTTP ${response.status} for ${url}.`);
  }
  try {
    const json = await response.json();
    return { json, finalUrl: response.url || url };
  } catch {
    throw new Error(`Peer file was not JSON: ${url}`);
  }
}

/**
 * Fetch a peer manifest and network. `confirm` runs before each new origin.
 * It receives { origin, url, purpose } and resolves true to continue.
 */
export async function loadPeerNetwork(networkUrl, fetchImpl, confirm) {
  const located = resolvePublishedNetwork(networkUrl);
  const trace = [];
  const allowed = new Set();

  async function read(url, purpose) {
    let current = url;
    for (let hop = 0; hop < 3; hop += 1) {
      const origin = new URL(current).origin;
      if (!allowed.has(origin)) {
        const ok = await confirm({ origin, url: current, purpose });
        if (!ok) {
          return { declined: true, origin, trace };
        }
        allowed.add(origin);
      }
      trace.push(`Fetched ${current} with credentials omitted and no Authorization header.`);
      const outcome = await fetchJson(current, fetchImpl);
      if (outcome.redirect) {
        const nextOrigin = new URL(outcome.redirect).origin;
        if (nextOrigin !== origin) allowed.delete(nextOrigin);
        current = outcome.redirect;
        continue;
      }
      return { json: outcome.json, url: outcome.finalUrl };
    }
    throw new Error("Peer redirect limit reached.");
  }

  const manifestRead = await read(located.manifestUrl, "Fetch the peer site manifest.");
  if (manifestRead.declined) return manifestRead;
  const entry = selectManifestNetwork(manifestRead.json, located.name);
  const definitionUrl = networkUrlFromEntry(entry, located.base);
  const networkRead = await read(definitionUrl, "Fetch the peer network definition.");
  if (networkRead.declined) return networkRead;
  const names = new Set((networkRead.json?.tools || []).map((tool) => tool?.name));
  if (!names.has(entry.front_man)) {
    throw new Error("Peer front agent is missing from its network file.");
  }
  let links = null;
  try {
    const linksRead = await read(located.linksUrl, "Fetch the peer link map.");
    if (!linksRead.declined) links = linksRead.json;
  } catch {
    trace.push("Peer links.json was not loaded. Named links on that site will not resolve.");
  }
  return {
    declined: false,
    name: located.name,
    origin: located.origin,
    entry,
    manifest: manifestRead.json,
    network: networkRead.json,
    links,
    trace,
  };
}

export function summarizeLoadedPeer(entry, label) {
  const queries = Array.isArray(entry.sample_queries) ? entry.sample_queries.slice(0, 3) : [];
  const lines = [
    `Loaded the published ${label} after you allowed it.`,
    "",
    `Network: ${entry.name}`,
    `Front agent: ${entry.front_man}`,
    `Published description: ${entry.description || "No description was published."}`,
  ];
  if (queries.length) {
    lines.push(`Sample questions it publishes: ${queries.join(" | ")}`);
  }
  lines.push(
    "",
    "Demo mode did not run that site's model. No API key was sent to that site. Nothing was ordered or emailed.",
  );
  return lines.join("\n");
}
