import { Type } from "typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { CouncilClient, type CouncilConfig } from "./client.js";

type Params = {
  action: "ask" | "online" | "status";
  whom?: string;
  input?: string;
  conversationId?: string;
  messageId?: string;
};

export default definePluginEntry({
  id: "claw-council",
  name: "ClawCouncil",
  description: "Ask trusted OpenClaw agents and inspect their availability.",
  register(api) {
    const config = api.pluginConfig as CouncilConfig;
    const client = new CouncilClient(config);

    api.registerTool({
      name: "council",
      label: "ClawCouncil",
      description:
        "Communicate with trusted remote OpenClaw agents. Use action=ask to ask one agent, action=online to list availability, or action=status to poll a pending answer.",
      parameters: Type.Object(
        {
          action: Type.Union([Type.Literal("ask"), Type.Literal("online"), Type.Literal("status")]),
          whom: Type.Optional(Type.String({ description: "Target identity, for example yui@padik" })),
          input: Type.Optional(Type.String({ description: "Question or task for the target agent" })),
          conversationId: Type.Optional(Type.String({ description: "Stable ID for a continuing conversation" })),
          messageId: Type.Optional(Type.String({ description: "Pending message ID returned by action=ask" })),
        },
        { additionalProperties: false },
      ),
      async execute(_id, rawParams) {
        const params = rawParams as Params;
        let details: CouncilResponse;
        if (params.action === "online") {
          details = await client.online();
        } else if (params.action === "status") {
          if (!params.messageId) throw new Error("messageId is required for action=status");
          details = await client.status(params.messageId);
        } else {
          if (!params.whom) throw new Error("whom is required for action=ask");
          if (!params.input?.trim()) throw new Error("input is required for action=ask");
          details = await client.ask(params.whom, params.input, params.conversationId);
        }
        return {
          content: [{ type: "text", text: JSON.stringify(details) }],
          details,
        };
      },
    });
  },
});

type CouncilResponse = Record<string, unknown>;
