import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { resolveConfig } from "../src/config.mjs";
import { createInvite, RegistryStore } from "../src/registry.mjs";
import { createCouncilServer, listen } from "../src/server.mjs";

let temporaryDirectory;
let registryPath;
let inviteKey;
let a2aServer;
let councilServer;
let baseUrl;
let a2aBaseUrl;
let issuedA2aToken;

function json(response, value) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

before(async () => {
  temporaryDirectory = await mkdtemp(join(tmpdir(), "claw-council-join-"));
  registryPath = join(temporaryDirectory, "registry.json");
  const invite = await createInvite(new RegistryStore(registryPath), { ttlSeconds: 600, allow: ["*"] });
  inviteKey = invite.inviteKey;

  a2aServer = createServer(async (request, response) => {
    if (request.method === "GET") {
      json(response, { name: "Kira Council", skills: [{ id: "council" }] });
      return;
    }
    assert.equal(request.headers.authorization, `Bearer ${issuedA2aToken}`);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    json(response, {
      jsonrpc: "2.0",
      id: body.id,
      result: {
        task: {
          id: "dynamic-task",
          contextId: body.params.message.contextId,
          status: { state: "TASK_STATE_COMPLETED" },
          artifacts: [{ parts: [{ text: "Dynamická odpověď" }] }],
        },
      },
    });
  });
  const a2aAddress = await listen(a2aServer, { host: "127.0.0.1", port: 0 });
  a2aBaseUrl = `http://127.0.0.1:${a2aAddress.port}`;

  const config = resolveConfig({
    listen: { host: "127.0.0.1", port: 0 },
    publicBaseUrl: "https://council.example.test",
    registryPath,
    allowInsecureJoinUrls: true,
    agents: {},
    clients: {},
  });
  councilServer = createCouncilServer(config);
  const address = await listen(councilServer, config);
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await Promise.all([
    new Promise((resolve) => councilServer.close(resolve)),
    new Promise((resolve) => a2aServer.close(resolve)),
  ]);
  await rm(temporaryDirectory, { recursive: true });
});

test("redeems an invite once and activates the new identity", async () => {
  const joinResponse = await fetch(`${baseUrl}/v1/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      invite_key: inviteKey,
      identity: "kira@friend",
      a2a_url: `${a2aBaseUrl}/a2a/v1`,
    }),
  });
  assert.equal(joinResponse.status, 201);
  const joined = await joinResponse.json();
  assert.match(joined.api_token, /^cca_[a-f0-9]{64}$/);
  assert.match(joined.a2a_token, /^cca2a_[a-f0-9]{64}$/);
  assert.equal(joined.peer_name, "claw-council");
  issuedA2aToken = joined.a2a_token;

  const replay = await fetch(`${baseUrl}/v1/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      invite_key: inviteKey,
      identity: "other@friend",
      a2a_url: `${a2aBaseUrl}/a2a/v1`,
    }),
  });
  assert.equal(replay.status, 401);

  const agents = await fetch(`${baseUrl}/v1/agents`, {
    headers: { authorization: `Bearer ${joined.api_token}` },
  });
  assert.equal(agents.status, 200);
  const agentBody = await agents.json();
  assert.equal(agentBody.agents[0].id, "kira@friend");
  assert.equal(agentBody.agents[0].online, true);

  const message = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${joined.api_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ whom: "kira@friend", input: "Ahoj" }),
  });
  assert.equal(message.status, 200);
  assert.equal((await message.json()).output, "Dynamická odpověď");
});
