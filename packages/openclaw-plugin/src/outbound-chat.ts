import { createHash } from "node:crypto";
import {
  appendAssistantMirrorMessageByIdentity,
  appendSessionTranscriptMessageByIdentity,
} from "openclaw/plugin-sdk/session-transcript-runtime";
import type { CouncilConfig, CouncilResponse } from "./client.js";

export const OUTBOUND_CHAT_HARNESS_ID = "claw-council-transcript";

type SessionEntry = {
  sessionId?: string;
};

type PluginRuntime = {
  config: {
    current(options: { clone: true }): unknown;
  };
  agent: {
    session: {
      getSessionEntryAsync(params: { agentId: string; sessionKey: string }): Promise<SessionEntry | undefined>;
      createSessionEntry(params: Record<string, unknown>): Promise<{ sessionId: string }>;
    };
  };
};

type TranscriptRuntime = {
  appendUser(params: Record<string, unknown>): Promise<unknown>;
  appendAssistant(params: Record<string, unknown>): Promise<{ ok: boolean; reason?: string }>;
};

export type OutboundChatSessionRuntime = {
  ensureSession(params: { agentId: string; sessionKey: string; displayName: string }): Promise<void>;
  appendUser(params: { agentId: string; sessionKey: string; text: string; idempotencyKey: string }): Promise<void>;
  appendAssistant(params: { agentId: string; sessionKey: string; text: string; idempotencyKey: string }): Promise<void>;
};

export class OpenClawOutboundChatSessionRuntime implements OutboundChatSessionRuntime {
  constructor(
    private readonly runtime: PluginRuntime,
    private readonly transcript: TranscriptRuntime = {
      appendUser: appendSessionTranscriptMessageByIdentity,
      appendAssistant: appendAssistantMirrorMessageByIdentity,
    },
  ) {}

  async ensureSession(params: { agentId: string; sessionKey: string; displayName: string }): Promise<void> {
    if (await this.getSessionId(params.agentId, params.sessionKey)) return;
    const cfg = this.runtime.config.current({ clone: true });
    try {
      await this.runtime.agent.session.createSessionEntry({
        cfg,
        key: params.sessionKey,
        agentId: params.agentId,
        displayName: params.displayName,
        initialEntry: {
          agentHarnessId: OUTBOUND_CHAT_HARNESS_ID,
          modelSelectionLocked: true,
          pluginExtensions: {
            "claw-council": { kind: "outbound-chat" },
          },
        },
      });
    } catch (error) {
      if (await this.getSessionId(params.agentId, params.sessionKey)) return;
      throw error;
    }
  }

  async appendUser(params: { agentId: string; sessionKey: string; text: string; idempotencyKey: string }): Promise<void> {
    const sessionId = await this.requireSessionId(params.agentId, params.sessionKey);
    await this.transcript.appendUser({
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      sessionId,
      config: this.runtime.config.current({ clone: true }),
      message: {
        role: "user",
        content: [{ type: "text", text: params.text }],
        timestamp: Date.now(),
        idempotencyKey: params.idempotencyKey,
      },
      idempotencyLookup: "scan",
      updateMode: "inline",
      useRawWhenLinear: true,
    });
  }

  async appendAssistant(params: { agentId: string; sessionKey: string; text: string; idempotencyKey: string }): Promise<void> {
    const sessionId = await this.requireSessionId(params.agentId, params.sessionKey);
    const result = await this.transcript.appendAssistant({
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      sessionId,
      config: this.runtime.config.current({ clone: true }),
      text: params.text,
      idempotencyKey: params.idempotencyKey,
      updateMode: "inline",
    });
    if (!result.ok) throw new Error(result.reason ?? "assistant transcript append failed");
  }

  private async getSessionId(agentId: string, sessionKey: string): Promise<string | undefined> {
    const entry = await this.runtime.agent.session.getSessionEntryAsync({ agentId, sessionKey });
    return typeof entry?.sessionId === "string" && entry.sessionId.length > 0 ? entry.sessionId : undefined;
  }

  private async requireSessionId(agentId: string, sessionKey: string): Promise<string> {
    const sessionId = await this.getSessionId(agentId, sessionKey);
    if (!sessionId) throw new Error(`missing outbound chat session: ${sessionKey}`);
    return sessionId;
  }
}

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
    private readonly sessions: OutboundChatSessionRuntime,
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
        await this.sessions.ensureSession({
          sessionKey,
          agentId: this.agentId,
          displayName: `ClawCouncil → ${whom}`,
        });
        await this.sessions.appendUser({
          sessionKey,
          agentId: this.agentId,
          text: `**Odesláno agentovi \`${whom}\`:**\n\n${input}`,
          idempotencyKey: `clawcouncil:${messageId}:ask`,
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
    await this.sessions.appendAssistant({
      sessionKey: state.sessionKey,
      agentId: this.agentId,
      text: `**ClawCouncil · ${status}**\n\n**Odpověď od \`${sender}\`:**\n\n${output}`,
      idempotencyKey: `clawcouncil:${messageId}:final`,
    });
    await this.store.register(messageId, { ...state, finalRecorded: true });
  }
}
