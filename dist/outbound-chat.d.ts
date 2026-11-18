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
export declare function outboundSessionKey(agentId: string, messageId: string): string;
export declare class OutboundChatRecorder {
    private readonly gateway;
    private readonly store;
    private readonly logger;
    private readonly agentId;
    constructor(gateway: GatewayRuntime, store: RecorderStore, logger: RecorderLogger, config: CouncilConfig);
    recordAsk(details: CouncilResponse, whom: string, input: string): Promise<void>;
    recordStatus(details: CouncilResponse, messageId: string): Promise<void>;
    private recordFinal;
}
export {};
