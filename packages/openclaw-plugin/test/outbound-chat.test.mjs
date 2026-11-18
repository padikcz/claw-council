import assert from "node:assert/strict";
import { test } from "node:test";
import { OutboundChatRecorder, outboundSessionKey } from "../dist/outbound-chat.js";

function createHarness() {
  const calls = [];
  const values = new Map();
  const warnings = [];
  return {
    calls,
    warnings,
    recorder: new OutboundChatRecorder(
      {
        async request(method, params) {
          calls.push({ method, params });
          return { ok: true };
        },
      },
      {
        async lookup(key) {
          return values.get(key);
        },
        async register(key, value) {
          values.set(key, value);
        },
      },
      { warn(message) { warnings.push(message); } },
      { baseUrl: "https://hub.test", token: "x", localAgentId: "council" },
    ),
  };
}

test("creates one visible outbound chat and records the final answer once", async () => {
  const harness = createHarness();
  await harness.recorder.recordAsk({ id: "message-1", status: "working" }, "kira@pepa", "Jak je nastavený Pepa?");
  assert.deepEqual(harness.calls.map((call) => call.method), ["sessions.create", "chat.inject"]);
  assert.equal(harness.calls[0].params.agentId, "council");
  assert.equal(harness.calls[0].params.displayName, "ClawCouncil → kira@pepa");
  assert.equal(harness.calls[0].params.key, outboundSessionKey("council", "message-1"));
  assert.match(harness.calls[1].params.message, /Jak je nastavený Pepa\?/);

  const completed = { id: "message-1", from: "kira@pepa", status: "completed", output: "Bez tajemství." };
  await harness.recorder.recordStatus(completed, "message-1");
  await harness.recorder.recordStatus(completed, "message-1");
  assert.deepEqual(harness.calls.map((call) => call.method), ["sessions.create", "chat.inject", "chat.inject"]);
  assert.match(harness.calls[2].params.message, /Bez tajemství\./);
  assert.deepEqual(harness.warnings, []);
});

test("recording failures never break the council request", async () => {
  const warnings = [];
  const recorder = new OutboundChatRecorder(
    { async request() { throw new Error("gateway unavailable"); } },
    { async lookup() { return undefined; }, async register() {} },
    { warn(message) { warnings.push(message); } },
    { baseUrl: "https://hub.test", token: "x" },
  );
  await recorder.recordAsk({ id: "message-2", status: "working" }, "robin@padik", "Test");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /gateway unavailable/);
});
