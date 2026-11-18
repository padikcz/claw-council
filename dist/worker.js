import { createHash } from "node:crypto";
function sessionKeyFor(agentId, delivery) {
    const conversation = delivery.conversation_id ?? delivery.id;
    const digest = createHash("sha256").update(`${delivery.from}\0${conversation}`).digest("hex").slice(0, 32);
    return `agent:${agentId}:subagent:clawcouncil:${digest}`;
}
async function delay(ms, signal) {
    if (signal.aborted)
        return;
    await new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve();
        }, { once: true });
    });
}
export async function executeDelivery(runtime, config, delivery, signal) {
    const localAgentId = config.localAgentId ?? "council";
    const run = await runtime.subagent.run({
        sessionKey: sessionKeyFor(localAgentId, delivery),
        message: delivery.input,
        disableTools: true,
        promptMode: "minimal",
        deliver: false,
        idempotencyKey: `clawcouncil:${delivery.id}`,
    });
    const deadline = Date.now() + (config.timeoutMs ?? 130_000);
    while (!signal.aborted && Date.now() < deadline) {
        const remaining = Math.max(1, deadline - Date.now());
        const result = await runtime.subagent.waitForRun({ runId: run.runId, timeoutMs: Math.min(10_000, remaining) });
        if (result.status === "pending" || result.status === "timeout")
            continue;
        if (result.status === "ok" && result.terminalReply?.disposition === "visible") {
            return { status: "completed", output: result.terminalReply.text };
        }
        return { status: "failed", output: "Local Council agent did not produce a visible answer." };
    }
    return { status: "failed", output: signal.aborted ? "Council delivery was interrupted." : "Local Council agent timed out." };
}
export class CouncilPullService {
    client;
    runtime;
    config;
    logger;
    controller;
    running;
    constructor(client, runtime, config, logger) {
        this.client = client;
        this.runtime = runtime;
        this.config = config;
        this.logger = logger;
    }
    start() {
        if (this.running)
            return;
        this.controller = new AbortController();
        this.running = this.loop(this.controller.signal).finally(() => {
            this.running = undefined;
        });
    }
    async stop() {
        this.controller?.abort();
        await this.running;
        this.controller = undefined;
    }
    async loop(signal) {
        const pollIntervalMs = this.config.pollIntervalMs ?? 2_000;
        this.logger.info("ClawCouncil pull receiver started");
        while (!signal.aborted) {
            try {
                const delivery = await this.client.nextDelivery(signal);
                if (!delivery) {
                    await delay(pollIntervalMs, signal);
                    continue;
                }
                const result = await executeDelivery(this.runtime, this.config, delivery, signal);
                if (!signal.aborted)
                    await this.client.completeDelivery(delivery, result, signal);
            }
            catch (error) {
                if (signal.aborted)
                    break;
                this.logger.warn(`ClawCouncil pull receiver error: ${error instanceof Error ? error.message : String(error)}`);
                await delay(Math.max(2_000, pollIntervalMs), signal);
            }
        }
    }
}
//# sourceMappingURL=worker.js.map