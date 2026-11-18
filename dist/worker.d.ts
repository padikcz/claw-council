import { CouncilClient, type CouncilConfig, type CouncilDelivery } from "./client.js";
type WaitResult = {
    status: "ok" | "timeout" | "error" | "pending";
    error?: string;
    terminalReply?: {
        disposition: "visible";
        text: string;
    } | {
        disposition: "silent";
    } | {
        disposition: "empty";
        code?: string;
    };
};
type CouncilRuntime = {
    subagent: {
        run(params: {
            sessionKey: string;
            message: string;
            disableTools: true;
            promptMode: "minimal";
            deliver: false;
            idempotencyKey: string;
        }): Promise<{
            runId: string;
            sessionKey?: string;
        }>;
        waitForRun(params: {
            runId: string;
            timeoutMs: number;
        }): Promise<WaitResult>;
    };
};
type Logger = {
    info(message: string): void;
    warn(message: string): void;
};
export declare function executeDelivery(runtime: CouncilRuntime, config: CouncilConfig, delivery: CouncilDelivery, signal: AbortSignal): Promise<{
    status: "completed" | "failed";
    output: string;
}>;
export declare class CouncilPullService {
    private readonly client;
    private readonly runtime;
    private readonly config;
    private readonly logger;
    private controller?;
    private running?;
    constructor(client: CouncilClient, runtime: CouncilRuntime, config: CouncilConfig, logger: Logger);
    start(): void;
    stop(): Promise<void>;
    private loop;
}
export {};
