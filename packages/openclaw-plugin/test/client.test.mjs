import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { CouncilClient } from "../dist/client.js";

let server;
let baseUrl;
const requests = [];

before(async () => {
  server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
    requests.push({ method: request.method, url: request.url, headers: request.headers, body });
    if (request.url === "/v1/inbox/next") {
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(request.url === "/v1/agents" ? { agents: [] } : { status: "completed", output: "ok" }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("sends authenticated ask requests", async () => {
  const client = new CouncilClient({ baseUrl, token: "secret" });
  const result = await client.ask("yui@padik", "Ahoj", "demo");
  assert.equal(result.output, "ok");
  assert.equal(requests[0].headers.authorization, "Bearer secret");
  assert.deepEqual(requests[0].body, {
    whom: "yui@padik",
    input: "Ahoj",
    conversation_id: "demo",
  });
});

test("requests the online agent list", async () => {
  const client = new CouncilClient({ baseUrl, token: "secret" });
  const result = await client.online();
  assert.deepEqual(result, { agents: [] });
});

test("polls and completes pull deliveries with the same bearer token", async () => {
  const client = new CouncilClient({ baseUrl, token: "secret" });
  assert.equal(await client.nextDelivery(), undefined);
  await client.completeDelivery({ id: "123", lease_id: "lease-1" }, { status: "completed", output: "hotovo" });
  const request = requests.at(-1);
  assert.equal(request.url, "/v1/inbox/123/complete");
  assert.equal(request.headers.authorization, "Bearer secret");
  assert.deepEqual(request.body, { lease_id: "lease-1", status: "completed", output: "hotovo" });
});
