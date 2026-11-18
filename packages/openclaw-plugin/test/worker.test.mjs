import assert from "node:assert/strict";
import { test } from "node:test";
import { executeDelivery } from "../dist/worker.js";

test("executes a pull delivery in a persistent tool-free council session", async () => {
  let runParams;
  const runtime = {
    subagent: {
      async run(params) {
        runParams = params;
        return { runId: "run-1", sessionKey: params.sessionKey };
      },
      async waitForRun() {
        return { status: "ok", terminalReply: { disposition: "visible", text: "Bezpečná odpověď" } };
      },
    },
  };
  const result = await executeDelivery(runtime, { baseUrl: "https://hub.test", token: "x", localAgentId: "council" }, {
    id: "message-1",
    from: "robin@padik",
    to: "yui@padik",
    input: "Ahoj",
    conversation_id: "demo",
    lease_id: "lease-1",
  }, new AbortController().signal);
  assert.deepEqual(result, { status: "completed", output: "Bezpečná odpověď" });
  assert.equal(runParams.disableTools, true);
  assert.equal(runParams.deliver, false);
  assert.match(runParams.sessionKey, /^agent:council:subagent:clawcouncil:[a-f0-9]{32}$/);
});
