export type CouncilConfig = {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
};

export type CouncilResponse = Record<string, unknown>;

export class CouncilClient {
  readonly baseUrl: string;
  readonly token: string;
  readonly timeoutMs: number;

  constructor(config: CouncilConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token;
    this.timeoutMs = config.timeoutMs ?? 130_000;
  }

  private async request(path: string, init?: RequestInit): Promise<CouncilResponse> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
      signal: AbortSignal.timeout(this.timeoutMs),
      redirect: "error",
    });
    const payload = (await response.json().catch(() => ({}))) as CouncilResponse;
    if (!response.ok) {
      const error = payload.error as { code?: string; message?: string } | undefined;
      throw new Error(error?.message ?? `Council Hub returned HTTP ${response.status}`);
    }
    return payload;
  }

  online(): Promise<CouncilResponse> {
    return this.request("/v1/agents");
  }

  ask(whom: string, input: string, conversationId?: string): Promise<CouncilResponse> {
    return this.request("/v1/messages", {
      method: "POST",
      body: JSON.stringify({
        whom,
        input,
        ...(conversationId ? { conversation_id: conversationId } : {}),
      }),
    });
  }

  status(messageId: string): Promise<CouncilResponse> {
    return this.request(`/v1/messages/${encodeURIComponent(messageId)}`);
  }
}
