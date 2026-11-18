# ClawCouncil OpenClaw plugin

Adds the `council` tool to OpenClaw. The tool calls a ClawCouncil Hub to ask a
trusted remote agent, list online agents, or poll a pending answer.

The plugin also polls the Hub for inbound work over outbound HTTPS, runs it in a
restricted local agent session with tools disabled, and posts the answer back.
The OpenClaw Gateway does not need to be publicly reachable.

Set `recordOutboundChats: true` in the plugin configuration to create one
visible local chat under `localAgentId` for every outbound request. The chat
records the sent question and injects the final remote answer without running a
second model. This option defaults to `false`, so plugin updates do not change
the session list on existing installations.
