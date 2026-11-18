export type CouncilConfig = {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  localAgentId?: string;
  pollIntervalMs?: number;
  recordOutboundChats?: boolean;
};

export type CouncilResponse = Record<string, unknown>;

export type CouncilDelivery = {
  id: string;
  from: string;
  to: string;
  input: string;
  conversation_id?: string;
  lease_id: string;
};

export class CouncilClient {
  readonly baseUrl: string;
  readonly token: string;
  readonly timeoutMs: number;

  constructor(config: CouncilConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token;
    this.timeoutMs = config.timeoutMs ?? 130_000;
  }

  private async request(path: string, init?: RequestInit, allowNoContent = false): Promise<CouncilResponse | undefined> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(this.timeoutMs)])
        : AbortSignal.timeout(this.timeoutMs),
      redirect: "error",
    });
    if (allowNoContent && response.status === 204) return undefined;
    const payload = (await response.json().catch(() => ({}))) as CouncilResponse;
    if (!response.ok) {
      const error = payload.error as { code?: string; message?: string } | undefined;
      throw new Error(error?.message ?? `Council Hub returned HTTP ${response.status}`);
    }
    return payload;
  }

  online(): Promise<CouncilResponse> {
    return this.request("/v1/agents") as Promise<CouncilResponse>;
  }

  ask(whom: string, input: string, conversationId?: string): Promise<CouncilResponse> {
    return this.request("/v1/messages", {
      method: "POST",
      body: JSON.stringify({
        whom,
        input,
        ...(conversationId ? { conversation_id: conversationId } : {}),
      }),
    }) as Promise<CouncilResponse>;
  }

  status(messageId: string): Promise<CouncilResponse> {
    return this.request(`/v1/messages/${encodeURIComponent(messageId)}`) as Promise<CouncilResponse>;
  }

  async nextDelivery(signal?: AbortSignal): Promise<CouncilDelivery | undefined> {
    return await this.request("/v1/inbox/next", { signal }, true) as CouncilDelivery | undefined;
  }

  async completeDelivery(
    delivery: Pick<CouncilDelivery, "id" | "lease_id">,
    result: { status: "completed" | "failed" | "rejected"; output?: string },
    signal?: AbortSignal,
  ): Promise<void> {
    await this.request(`/v1/inbox/${encodeURIComponent(delivery.id)}/complete`, {
      method: "POST",
      signal,
      body: JSON.stringify({ lease_id: delivery.lease_id, ...result }),
    });
  }
}
