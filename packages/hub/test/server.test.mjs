import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { resolveConfig } from "../src/config.mjs";
import { createCouncilServer, listen } from "../src/server.mjs";

let a2aServer;
let councilServer;
let baseUrl;
let a2aBaseUrl;

function json(response, value) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

before(async () => {
  a2aServer = createServer(async (request, response) => {
    if (request.method === "GET") {
      json(response, { name: "Test Yui", skills: [{ id: "council" }] });
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    assert.equal(request.headers.authorization, "Bearer inbound-secret");
    if (body.method === "GetTask") {
      json(response, {
        jsonrpc: "2.0",
        id: body.id,
        result: {
          id: body.params.id,
          contextId: "ctx-test",
          status: { state: "TASK_STATE_COMPLETED" },
          artifacts: [{ parts: [{ text: "Hotovo později" }] }],
        },
      });
      return;
    }
    json(response, {
      jsonrpc: "2.0",
      id: body.id,
      result: {
        task: {
          id: "task-1",
          contextId: body.params.message.contextId,
          status: { state: "TASK_STATE_COMPLETED" },
          artifacts: [{ parts: [{ text: `Odpověď: ${body.params.message.parts[0].text}` }] }],
        },
      },
    });
  });
  const a2aAddress = await listen(a2aServer, { host: "127.0.0.1", port: 0 });
  a2aBaseUrl = `http://127.0.0.1:${a2aAddress.port}`;

  const config = resolveConfig(
    {
      listen: { host: "127.0.0.1", port: 0 },
      agents: {
        "yui@padik": {
          a2aUrl: `${a2aBaseUrl}/a2a/v1`,
          tokenEnv: "YUI_A2A_TOKEN",
        },
      },
      clients: {
        "kira@test": { tokenEnv: "KIRA_API_TOKEN", allow: ["yui@padik"] },
      },
    },
    { YUI_A2A_TOKEN: "inbound-secret", KIRA_API_TOKEN: "client-secret" },
  );
  councilServer = createCouncilServer(config);
  const address = await listen(councilServer, config);
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await Promise.all([
    new Promise((resolve) => councilServer.close(resolve)),
    new Promise((resolve) => a2aServer.close(resolve)),
  ]);
});

test("rejects missing authentication", async () => {
  const response = await fetch(`${baseUrl}/v1/agents`);
  assert.equal(response.status, 401);
});

test("lists online agents", async () => {
  const response = await fetch(`${baseUrl}/v1/agents`, {
    headers: { authorization: "Bearer client-secret" },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.agents[0].id, "yui@padik");
  assert.equal(body.agents[0].online, true);
  assert.equal(body.agents[0].name, "Test Yui");
});

test("routes a message and normalizes the response", async () => {
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      authorization: "Bearer client-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({ whom: "yui@padik", input: "Ahoj", conversation_id: "demo" }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.from, "yui@padik");
  assert.equal(body.to, "kira@test");
  assert.equal(body.status, "completed");
  assert.equal(body.output, "Odpověď: Ahoj");
});

test("enforces the target allowlist", async () => {
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      authorization: "Bearer client-secret",
      "content-type": "application/json",
    },
    body: JSON.stringify({ whom: "unknown@test", input: "Ahoj" }),
  });
  assert.equal(response.status, 403);
});
