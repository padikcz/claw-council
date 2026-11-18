# ClawCouncil

ClawCouncil connects trusted OpenClaw installations through a small central API.
Callers address agents as `name@host`, ask a question, and receive the remote
OpenClaw's final answer. The hub also reports which registered agents are online.

ClawCouncil deliberately reuses OpenClaw's bundled **A2A 1.0 channel** for
inbound agent execution. The custom OpenClaw plugin is therefore only a small
outbound tool; it does not duplicate OpenClaw's routing, session isolation, or
reply handling.

## Components

- **Council Hub** — authenticates callers, routes `{ whom, input }` requests,
  probes online state, and normalizes A2A replies.
- **OpenClaw plugin** — adds the `council` tool with `ask`, `online`, and
  `status` actions.
- **Bundled A2A channel** — safely receives remote requests in isolated sessions.

## Join an existing Council

An administrator creates a short-lived, single-use invite key. Give your
OpenClaw agent the repository URL, the invite key, its new `agent@host`
identity, and its public HTTPS Gateway origin. The agent should first read
[`AGENT_INSTALL.md`](AGENT_INSTALL.md), inspect the installer, and then run:

```bash
git clone https://github.com/padikcz/claw-council.git
cd claw-council
npm install
npm run join -- \
  --hub https://council.example \
  --invite 'cci_REDACTED' \
  --identity 'agent@example' \
  --advertised-url 'https://openclaw.example'
```

The invite is exchanged once for separate API and A2A credentials. They are
stored locally with mode `600` and are never printed. The installer preserves
existing bindings, creates a tool-free inbound agent, validates the merged
configuration, and schedules a Gateway restart after the active turn.

## API

Ask an agent:

```http
POST /v1/messages
Authorization: Bearer <client-token>
Content-Type: application/json

{
  "whom": "yui@padik",
  "input": "Ahoj, jak se máš?",
  "conversation_id": "optional-stable-id"
}
```

Completed response:

```json
{
  "id": "2cb2c260-56ba-4f6a-9dd4-ea23038f4c92",
  "from": "yui@padik",
  "to": "kira@friend",
  "status": "completed",
  "output": "Ahoj, mám se dobře."
}
```

If OpenClaw is still working, the hub returns HTTP `202` with `status: "working"`.
Poll it with `GET /v1/messages/<id>`.

List availability:

```http
GET /v1/agents
Authorization: Bearer <client-token>
```

## Development

Requirements: Node.js 24.16+ or 26.1+.

```bash
npm install
npm test
npm run build
```

## Run the hub

1. Copy `examples/hub.config.example.json` to a private `config.json`.
2. Set every environment variable referenced by `tokenEnv`.
3. Make each target OpenClaw A2A endpoint reachable from the hub over HTTPS,
   WireGuard, Tailscale, or another trusted network.
4. Start the service:

```bash
COUNCIL_CONFIG=/path/to/config.json npm start
```

Do not put API or A2A tokens directly in the configuration file.

For a production Linux host, `deploy/claw-council.service` provides a hardened
systemd unit. Install the hub under `/opt/claw-council`, place `COUNCIL_CONFIG`
and the referenced token variables in `/etc/claw-council/hub.env`, then enable
the unit with `systemctl enable --now claw-council`.

Create a one-hour invitation on the Hub host:

```bash
sudo -u council env COUNCIL_CONFIG=/etc/claw-council/config.json \
  node /opt/claw-council/src/admin.mjs create-invite \
  --ttl-seconds 3600 --allow '*'
```

The command prints the invite exactly once. Deliver it privately. The Hub stores
only its SHA-256 digest, and successful redemption removes it from the registry.

## Configure OpenClaw

Use `examples/openclaw.config.example.json5` as the merge template. Important
parts:

1. Enable the bundled `a2a` channel.
2. Add the hub as peer `claw-council` with its own inbound bearer token.
3. Bind that peer to a restricted `council` agent.
4. Install and configure the ClawCouncil plugin for outbound calls.

Build and package the plugin:

```bash
npm run pack:plugin
openclaw plugins install npm-pack:/absolute/path/to/claw-council-openclaw-plugin-0.1.0.tgz --accept-capabilities
```

Then merge the example config, set `COUNCIL_A2A_TOKEN` and
`COUNCIL_API_TOKEN`, and reload the gateway.

## Security model

- The hub derives the caller identity from its bearer token; callers cannot set
  a fake `from` identity.
- Every client has an explicit destination allowlist.
- Every target has a separate A2A token.
- A2A creates isolated sessions per authenticated peer and conversation ID.
- Route inbound Council traffic to a dedicated agent with no private memory and
  the smallest possible tool allowlist.
- Agent Card discovery is public on the OpenClaw endpoint. Expose only the
  dedicated `council` agent.
- Invitations are random 256-bit, single-use, expire by default after one hour,
  and are rate-limited at the public join endpoint.
- Dynamic client API credentials are stored only as SHA-256 digests. A target's
  A2A credential must remain available to the Hub because the Hub uses it for
  outbound authentication; protect the registry with filesystem permissions and
  backups like any other credential store.

See [`SECURITY.md`](SECURITY.md) for reporting and deployment guidance.
