import { Type } from "typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { CouncilClient } from "./client.js";
import { OutboundChatRecorder } from "./outbound-chat.js";
import { CouncilPullService } from "./worker.js";
export default definePluginEntry({
    id: "claw-council",
    name: "ClawCouncil",
    description: "Ask trusted OpenClaw agents and inspect their availability.",
    register(api) {
        const config = api.pluginConfig;
        const client = new CouncilClient(config);
        const outboundRecorder = config.recordOutboundChats
            ? new OutboundChatRecorder(api.runtime.gateway, api.runtime.state.openKeyedStoreV2({
                namespace: "outbound-chats",
                maxEntries: 2_000,
            }), api.logger, config)
            : undefined;
        api.registerTool({
            name: "council",
            label: "ClawCouncil",
            description: "Communicate with trusted remote OpenClaw agents. Use action=ask to ask one agent, action=online to list availability, or action=status to poll a pending answer.",
            parameters: Type.Object({
                action: Type.Union([Type.Literal("ask"), Type.Literal("online"), Type.Literal("status")]),
                whom: Type.Optional(Type.String({ description: "Target identity, for example yui@padik" })),
                input: Type.Optional(Type.String({ description: "Question or task for the target agent" })),
                conversationId: Type.Optional(Type.String({ description: "Stable ID for a continuing conversation" })),
                messageId: Type.Optional(Type.String({ description: "Pending message ID returned by action=ask" })),
            }, { additionalProperties: false }),
            async execute(_id, rawParams) {
                const params = rawParams;
                let details;
                if (params.action === "online") {
                    details = await client.online();
                }
                else if (params.action === "status") {
                    if (!params.messageId)
                        throw new Error("messageId is required for action=status");
                    details = await client.status(params.messageId);
                    await outboundRecorder?.recordStatus(details, params.messageId);
                }
                else {
                    if (!params.whom)
                        throw new Error("whom is required for action=ask");
                    if (!params.input?.trim())
                        throw new Error("input is required for action=ask");
                    details = await client.ask(params.whom, params.input, params.conversationId);
                    await outboundRecorder?.recordAsk(details, params.whom, params.input);
                }
                return {
                    content: [{ type: "text", text: JSON.stringify(details) }],
                    details,
                };
            },
        });
        if (api.registrationMode === "full") {
            const receiver = new CouncilPullService(client, api.runtime, config, api.logger);
            api.registerService({
                id: "claw-council-pull-receiver",
                start() {
                    receiver.start();
                },
                stop() {
                    return receiver.stop();
                },
            });
        }
    },
});
//# sourceMappingURL=index.js.map