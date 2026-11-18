import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OpenClawOutboundChatSessionRuntime,
  OUTBOUND_CHAT_HARNESS_ID,
  OutboundChatRecorder,
  outboundSessionKey,
} from "../dist/outbound-chat.js";

function createHarness() {
  const calls = [];
  const values = new Map();
  const warnings = [];
  return {
    calls,
    warnings,
    recorder: new OutboundChatRecorder(
      {
        async ensureSession(params) { calls.push({ method: "ensureSession", params }); },
        async appendUser(params) { calls.push({ method: "appendUser", params }); },
        async appendAssistant(params) { calls.push({ method: "appendAssistant", params }); },
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
  assert.deepEqual(harness.calls.map((call) => call.method), ["ensureSession", "appendUser"]);
  assert.equal(harness.calls[0].params.agentId, "council");
  assert.equal(harness.calls[0].params.displayName, "ClawCouncil → kira@pepa");
  assert.equal(harness.calls[0].params.sessionKey, outboundSessionKey("council", "message-1"));
  assert.match(harness.calls[1].params.text, /Jak je nastavený Pepa\?/);

  const completed = { id: "message-1", from: "kira@pepa", status: "completed", output: "Bez tajemství." };
  await harness.recorder.recordStatus(completed, "message-1");
  await harness.recorder.recordStatus(completed, "message-1");
  assert.deepEqual(harness.calls.map((call) => call.method), ["ensureSession", "appendUser", "appendAssistant"]);
  assert.match(harness.calls[2].params.text, /Bez tajemství\./);
  assert.deepEqual(harness.warnings, []);
});

test("recording failures never break the council request", async () => {
  const warnings = [];
  const recorder = new OutboundChatRecorder(
    {
      async ensureSession() { throw new Error("session unavailable"); },
      async appendUser() {},
      async appendAssistant() {},
    },
    { async lookup() { return undefined; }, async register() {} },
    { warn(message) { warnings.push(message); } },
    { baseUrl: "https://hub.test", token: "x" },
  );
  await recorder.recordAsk({ id: "message-2", status: "working" }, "robin@padik", "Test");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /session unavailable/);
});

test("uses the public session and transcript SDK without Gateway requests", async () => {
  const entries = new Map();
  const created = [];
  const userAppends = [];
  const assistantAppends = [];
  const runtime = {
    config: { current() { return { marker: "cfg" }; } },
    agent: {
      session: {
        async getSessionEntryAsync({ sessionKey }) { return entries.get(sessionKey); },
        async createSessionEntry(params) {
          created.push(params);
          entries.set(params.key, { sessionId: "session-1" });
          return { sessionId: "session-1" };
        },
      },
    },
  };
  const sessions = new OpenClawOutboundChatSessionRuntime(runtime, {
    async appendUser(params) { userAppends.push(params); return { ok: true }; },
    async appendAssistant(params) { assistantAppends.push(params); return { ok: true }; },
  });

  await sessions.ensureSession({ agentId: "council", sessionKey: "agent:council:test", displayName: "Council test" });
  await sessions.appendUser({ agentId: "council", sessionKey: "agent:council:test", text: "question", idempotencyKey: "ask-1" });
  await sessions.appendAssistant({ agentId: "council", sessionKey: "agent:council:test", text: "answer", idempotencyKey: "answer-1" });

  assert.equal(created[0].initialEntry.agentHarnessId, OUTBOUND_CHAT_HARNESS_ID);
  assert.equal(created[0].displayName, "Council test");
  assert.equal(userAppends[0].sessionId, "session-1");
  assert.equal(userAppends[0].message.role, "user");
  assert.equal(userAppends[0].updateMode, "inline");
  assert.equal(assistantAppends[0].sessionId, "session-1");
  assert.equal(assistantAppends[0].updateMode, "inline");
});
