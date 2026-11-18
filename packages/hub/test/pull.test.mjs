import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { resolveConfig } from "../src/config.mjs";
import { createCouncilServer, listen } from "../src/server.mjs";

let server;
let baseUrl;

const auth = (token) => ({ authorization: `Bearer ${token}` });

before(async () => {
  const config = resolveConfig({
    listen: { host: "127.0.0.1", port: 0 },
    agents: {
      "yui@padik": { delivery: "pull" },
    },
    clients: {
      "yui@padik": { tokenEnv: "YUI_TOKEN", allow: ["robin@padik"] },
      "robin@padik": { tokenEnv: "ROBIN_TOKEN", allow: ["yui@padik"] },
    },
  }, { YUI_TOKEN: "yui-secret", ROBIN_TOKEN: "robin-secret" });
  server = createCouncilServer(config);
  const address = await listen(server, config);
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("delivers through an outbound-only pull inbox", async () => {
  const initially = await fetch(`${baseUrl}/v1/agents`, { headers: auth("robin-secret") });
  assert.equal((await initially.json()).agents[0].online, false);

  const empty = await fetch(`${baseUrl}/v1/inbox/next`, { headers: auth("yui-secret") });
  assert.equal(empty.status, 204);

  const online = await fetch(`${baseUrl}/v1/agents`, { headers: auth("robin-secret") });
  assert.equal((await online.json()).agents[0].online, true);

  const sent = await fetch(`${baseUrl}/v1/messages`, {
    method: "POST",
    headers: { ...auth("robin-secret"), "content-type": "application/json" },
    body: JSON.stringify({ whom: "yui@padik", input: "Ahoj", conversation_id: "pull-demo" }),
  });
  assert.equal(sent.status, 202);
  const message = await sent.json();

  const deliveryResponse = await fetch(`${baseUrl}/v1/inbox/next`, { headers: auth("yui-secret") });
  assert.equal(deliveryResponse.status, 200);
  const delivery = await deliveryResponse.json();
  assert.equal(delivery.id, message.id);
  assert.equal(delivery.from, "robin@padik");
  assert.equal(delivery.to, "yui@padik");
  assert.equal(delivery.input, "Ahoj");

  const stale = await fetch(`${baseUrl}/v1/inbox/${message.id}/complete`, {
    method: "POST",
    headers: { ...auth("yui-secret"), "content-type": "application/json" },
    body: JSON.stringify({ lease_id: "wrong", status: "completed", output: "Ne" }),
  });
  assert.equal(stale.status, 409);

  const completed = await fetch(`${baseUrl}/v1/inbox/${message.id}/complete`, {
    method: "POST",
    headers: { ...auth("yui-secret"), "content-type": "application/json" },
    body: JSON.stringify({ lease_id: delivery.lease_id, status: "completed", output: "Ahoj Robine" }),
  });
  assert.equal(completed.status, 200);

  const result = await fetch(`${baseUrl}/v1/messages/${message.id}`, { headers: auth("robin-secret") });
  assert.deepEqual(await result.json(), {
    id: message.id,
    from: "yui@padik",
    to: "robin@padik",
    status: "completed",
    output: "Ahoj Robine",
  });
});
