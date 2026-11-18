export class CouncilClient {
    baseUrl;
    token;
    timeoutMs;
    constructor(config) {
        this.baseUrl = config.baseUrl.replace(/\/+$/, "");
        this.token = config.token;
        this.timeoutMs = config.timeoutMs ?? 130_000;
    }
    async request(path, init, allowNoContent = false) {
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
        if (allowNoContent && response.status === 204)
            return undefined;
        const payload = (await response.json().catch(() => ({})));
        if (!response.ok) {
            const error = payload.error;
            throw new Error(error?.message ?? `Council Hub returned HTTP ${response.status}`);
        }
        return payload;
    }
    online() {
        return this.request("/v1/agents");
    }
    ask(whom, input, conversationId) {
        return this.request("/v1/messages", {
            method: "POST",
            body: JSON.stringify({
                whom,
                input,
                ...(conversationId ? { conversation_id: conversationId } : {}),
            }),
        });
    }
    status(messageId) {
        return this.request(`/v1/messages/${encodeURIComponent(messageId)}`);
    }
    async nextDelivery(signal) {
        return await this.request("/v1/inbox/next", { signal }, true);
    }
    async completeDelivery(delivery, result, signal) {
        await this.request(`/v1/inbox/${encodeURIComponent(delivery.id)}/complete`, {
            method: "POST",
            signal,
            body: JSON.stringify({ lease_id: delivery.lease_id, ...result }),
        });
    }
}
//# sourceMappingURL=client.js.map