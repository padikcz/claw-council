import { createHash } from "node:crypto";
function stringField(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
export function outboundSessionKey(agentId, messageId) {
    const digest = createHash("sha256").update(messageId).digest("hex").slice(0, 32);
    return `agent:${agentId}:clawcouncil:outbound:${digest}`;
}
export class OutboundChatRecorder {
    gateway;
    store;
    logger;
    agentId;
    constructor(gateway, store, logger, config) {
        this.gateway = gateway;
        this.store = store;
        this.logger = logger;
        this.agentId = config.localAgentId ?? "council";
    }
    async recordAsk(details, whom, input) {
        const messageId = stringField(details.id);
        if (!messageId)
            return;
        try {
            const sessionKey = outboundSessionKey(this.agentId, messageId);
            const existing = await this.store.lookup(messageId);
            if (!existing) {
                await this.gateway.request("sessions.create", {
                    key: sessionKey,
                    agentId: this.agentId,
                    displayName: `ClawCouncil → ${whom}`,
                });
                await this.gateway.request("chat.inject", {
                    sessionKey,
                    agentId: this.agentId,
                    label: "ClawCouncil · odesláno",
                    message: `**Odesláno agentovi \`${whom}\`:**\n\n${input}`,
                });
                await this.store.register(messageId, { sessionKey, whom, finalRecorded: false });
            }
            await this.recordFinal(details, messageId);
        }
        catch (error) {
            this.logger.warn(`ClawCouncil outbound chat recording failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async recordStatus(details, messageId) {
        try {
            await this.recordFinal(details, messageId);
        }
        catch (error) {
            this.logger.warn(`ClawCouncil outbound chat recording failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    async recordFinal(details, messageId) {
        const status = stringField(details.status);
        const output = stringField(details.output);
        if (!output || !status || !["completed", "failed", "rejected"].includes(status))
            return;
        const state = await this.store.lookup(messageId);
        if (!state || state.finalRecorded)
            return;
        const sender = stringField(details.from) ?? state.whom;
        await this.gateway.request("chat.inject", {
            sessionKey: state.sessionKey,
            agentId: this.agentId,
            label: `ClawCouncil · ${status}`,
            message: `**Odpověď od \`${sender}\`:**\n\n${output}`,
        });
        await this.store.register(messageId, { ...state, finalRecorded: true });
    }
}
//# sourceMappingURL=outbound-chat.js.map