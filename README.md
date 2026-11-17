# Open Dispatch Desk

Open Dispatch Desk is a small public demo for the [Open Agentic Web Challenge](https://cognizant-agenticweb.devpost.com/). It publishes a fictional one-person home and office computer help desk called **Lakeside Tech Desk**. A visitor, or another agentic site, can ask the front desk what the desk does, see which sample tickets are waiting, leave a sample work request, and turn a pasted job note into a client-safe status draft.

The tickets, shops, and notes are sample data. Nothing on this site sends, posts, bills, or contacts anyone. It is not a hosted service, and this repository was not deployed as part of the demo.

## What was built for the submission

All of this site is new as of November 2026. The page, the sample desk, the published agent network, and the browser runtime were written for the challenge during the submission period (through 11 January 2027). Nothing here was carried over from an older product.

## How to run

Node.js 22 or newer.

```shell
npm install
npm test
npm run dev
```

Open http://127.0.0.1:5173/.

A production build is static files in `dist/`:

```shell
npm run build
npm run preview
```

`npm run build` typechecks, then writes the static site. The preview serves it with CORS headers on the public agent files.

## Demo mode

Demo mode is the default. It needs no API key.

1. Leave **Demo mode** selected. The header reads “Demo mode · no key”.
2. Choose a sample prompt, or ask what is waiting. The reply is a fixed answer from the sample board.
3. Send “Wi-Fi is down at a small office.” A new Waiting card appears, with an intake summary for the owner. Nothing is sent.
4. Use the job-note prompt. The reply is a client-safe draft of that note.
5. Use the Little Oven prompt. A consent dialog names the origin before any request. Decline and nothing is fetched. Allow once and the desk loads that example’s published manifest and network, then quotes the published description. Demo mode does not run the other site’s model.

**Reset sample board** restores the original five tickets. **Remove this sample request** drops an intake added in this session.

## Bring your own key

Open **Model settings**. Choose a provider, or paste any OpenAI-compatible URL and model, then paste a key and choose **Save in this browser**. The key is stored in `localStorage` under this origin. It is attached only to requests to the provider URL you saved. It is not written into the repo, the manifest, the network file, prompts shown in the trace, or peer-site requests.

**Clear saved setup** deletes the saved provider and the key. Demo mode keeps working after that.

The provider must allow this page to call it from the browser. If it does not, the desk shows that error and demo mode is still available.

## How this conforms to the spec

The site follows the [Worldwide Agentic Web MVP spec](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md) (profile 0.2, 6 November 2026) and the shape of the official pizza example and the agentify-website skill.

| Spec piece | What this demo publishes or does |
| --- | --- |
| Agent manifest | `agent-manifest.json` with network name `lakeside_tech_desk`, front agent `front_desk_coordinator`, a relative `hocon` path, router metadata, and a closed peer policy |
| Resolved network | `lakeside_tech_desk.network.json` with the front desk, `status_agent`, and `job_note_agent`. No includes, environment substitutions, or private paths |
| Browser runtime | `src/runtime/` parses the published files, checks them, runs the front agent, delegates to the two specialists, and calls local site actions. There is no server-side agent runtime |
| Local grounded action | `get_desk_state`, `record_sample_intake`, and `prepare_status_draft` run in the page. Reads and the local intake update do not leave the browser |
| Peer load | The front desk’s tool list names the official Little Oven network on `raw.githubusercontent.com`. Contact waits for a visible consent step. The fetch sends no `Authorization` header and no cookie credentials |
| Private context | Each agent publishes empty `allow.to_downstream.sly_data` and `allow.to_upstream.sly_data` lists. The runtime does not attach private context to a peer call |
| BYOK | Model settings take a router URL, model, and key. A loaded peer uses that same router. The peer origin does not receive the key |
| Limits | Depth, invocation count, peer-call count, step count, and a time budget stop a run with a visible error |
| CORS | Dev and preview servers send `Access-Control-Allow-Origin: *`. `firebase.json`, `public/_headers`, and `public/.htaccess` record the same header for static hosts |

`npm test` checks that the manifest and network parse, that the required fields agree, and that a broken front agent or an environment substitution is rejected.

### Points the minimum profile asks for that this demo does not fully meet

- There is no publisher-funded default router. A keyless visit uses canned demo replies instead of calling the Otari URL in the manifest. Putting a real publisher key in the repo would break the “no secrets” rule.
- Demo mode loads and validates a peer network after consent, then quotes its published description. It does not run that network’s model. Bring-your-own-key mode does run the peer front agent in this browser, on the visitor’s provider, with website tools withheld.
- The runtime is a small TypeScript client, not the nsDeploy reference runtime. It does not render CRUSE, execute coded-tool bundles, or discover MCP servers. This desk has no MCP server; the grounded capability is the local site actions, which the spec allows in place of MCP.
- The action bridge answers with an empty catalog, so another origin cannot run this page’s intake or draft actions. Callers can still fetch the published network and run its instructions.
- JSON Schema checks on tool arguments are the small subset these three actions need (object shape and required strings), not a full validator.

## Fictional data

Lakeside Tech Desk, the five sample tickets, and the shop names on the board are invented for this contest demo. Do not treat a reply as a real visit, a real client, or a bill.

## License

Apache License 2.0. Copyright 2026 Dylan Green. See [LICENSE](LICENSE).
