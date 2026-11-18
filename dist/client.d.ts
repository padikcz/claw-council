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
export declare class CouncilClient {
    readonly baseUrl: string;
    readonly token: string;
    readonly timeoutMs: number;
    constructor(config: CouncilConfig);
    private request;
    online(): Promise<CouncilResponse>;
    ask(whom: string, input: string, conversationId?: string): Promise<CouncilResponse>;
    status(messageId: string): Promise<CouncilResponse>;
    nextDelivery(signal?: AbortSignal): Promise<CouncilDelivery | undefined>;
    completeDelivery(delivery: Pick<CouncilDelivery, "id" | "lease_id">, result: {
        status: "completed" | "failed" | "rejected";
        output?: string;
    }, signal?: AbortSignal): Promise<void>;
}
