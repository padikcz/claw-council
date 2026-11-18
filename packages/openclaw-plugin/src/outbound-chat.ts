import { createHash } from "node:crypto";
import type { CouncilConfig, CouncilResponse } from "./client.js";

type GatewayRuntime = {
  request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
};

type RecorderState = {
  sessionKey: string;
  whom: string;
  finalRecorded: boolean;
};

type RecorderStore = {
  lookup(key: string): Promise<RecorderState | undefined>;
  register(key: string, value: RecorderState): Promise<void>;
};

type RecorderLogger = {
  warn(message: string): void;
};

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function outboundSessionKey(agentId: string, messageId: string): string {
  const digest = createHash("sha256").update(messageId).digest("hex").slice(0, 32);
  return `agent:${agentId}:clawcouncil:outbound:${digest}`;
}

export class OutboundChatRecorder {
  private readonly agentId: string;

  constructor(
    private readonly gateway: GatewayRuntime,
    private readonly store: RecorderStore,
    private readonly logger: RecorderLogger,
    config: CouncilConfig,
  ) {
    this.agentId = config.localAgentId ?? "council";
  }

  async recordAsk(details: CouncilResponse, whom: string, input: string): Promise<void> {
    const messageId = stringField(details.id);
    if (!messageId) return;
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
    } catch (error) {
      this.logger.warn(`ClawCouncil outbound chat recording failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async recordStatus(details: CouncilResponse, messageId: string): Promise<void> {
    try {
      await this.recordFinal(details, messageId);
    } catch (error) {
      this.logger.warn(`ClawCouncil outbound chat recording failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async recordFinal(details: CouncilResponse, messageId: string): Promise<void> {
    const status = stringField(details.status);
    const output = stringField(details.output);
    if (!output || !status || !["completed", "failed", "rejected"].includes(status)) return;
    const state = await this.store.lookup(messageId);
    if (!state || state.finalRecorded) return;
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
