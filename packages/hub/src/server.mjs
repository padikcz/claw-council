import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { getTask, probeAgent, sendMessage } from "./a2a.mjs";
import { hashToken, redeemInvite, RegistryStore } from "./registry.mjs";

const MAX_BODY_BYTES = 70 * 1024;
const IDENTITY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}@[a-z0-9][a-z0-9._-]{0,63}$/i;
const CONVERSATION_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/;

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function sendError(response, statusCode, code, message) {
  sendJson(response, statusCode, { error: { code, message } });
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("invalid_json");
  }
}

async function directory(config, store) {
  const registry = await store.read();
  const agents = new Map(config.agents);
  for (const [identity, agent] of Object.entries(registry.agents)) {
    agents.set(identity, { identity, ...agent });
  }
  return { registry, agents };
}

async function authenticate(request, config, store) {
  const token = request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return undefined;
  const configured = config.clientsByToken.get(token);
  if (configured) return configured;
  const registry = await store.read();
  const digest = hashToken(token);
  for (const [identity, client] of Object.entries(registry.clients)) {
    if (client.tokenHash === digest) {
      return { identity, allow: new Set(client.allow) };
    }
  }
  return undefined;
}

function mayContact(client, target) {
  return client.allow.has("*") || client.allow.has(target);
}

function contextIdFor(clientIdentity, conversationId) {
  const caller = createHash("sha256").update(clientIdentity).digest("hex").slice(0, 16);
  return `cc:${caller}:${conversationId ?? randomUUID()}`;
}

export function createCouncilServer(config) {
  const pending = new Map();
  const registry = new RegistryStore(config.registryPath);
  const joinAttempts = new Map();

  function joinRateLimited(address) {
    const now = Date.now();
    const attempts = (joinAttempts.get(address) ?? []).filter((time) => now - time < 60_000);
    if (attempts.length >= 10) return true;
    attempts.push(now);
    joinAttempts.set(address, attempts);
    return false;
  }

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/healthz") {
        sendJson(response, 200, { status: "ok" });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/join") {
        if (!config.registryPath || !config.publicBaseUrl) {
          sendError(response, 503, "join_unavailable", "Agent onboarding is not enabled");
          return;
        }
        const address = request.socket.remoteAddress ?? "unknown";
        if (joinRateLimited(address)) {
          sendError(response, 429, "rate_limited", "Too many onboarding attempts");
          return;
        }
        let body;
        try {
          body = await readJson(request);
        } catch (error) {
          const tooLarge = error instanceof Error && error.message === "request_too_large";
          sendError(response, tooLarge ? 413 : 400, tooLarge ? "request_too_large" : "invalid_json", tooLarge ? "Request body is too large" : "Body must be valid JSON");
          return;
        }
        const inviteKey = body?.invite_key;
        const identity = body?.identity;
        const a2aUrlValue = body?.a2a_url;
        if (typeof inviteKey !== "string" || !inviteKey.startsWith("cci_") || inviteKey.length > 100) {
          sendError(response, 401, "invalid_invite", "Invite key is invalid or expired");
          return;
        }
        if (typeof identity !== "string" || !IDENTITY_PATTERN.test(identity)) {
          sendError(response, 400, "invalid_identity", "identity must look like agent@host");
          return;
        }
        let a2aUrl;
        try {
          a2aUrl = new URL(a2aUrlValue);
          if (a2aUrl.protocol !== "https:" && !(config.allowInsecureJoinUrls && a2aUrl.protocol === "http:")) throw new Error();
        } catch {
          sendError(response, 400, "invalid_a2a_url", "a2a_url must be a valid HTTPS URL");
          return;
        }
        const normalizedA2aUrl = a2aUrl.toString();
        const healthUrl = new URL("/.well-known/agent-card.json", normalizedA2aUrl).toString();
        try {
          const credentials = await redeemInvite(registry, {
            inviteKey,
            identity,
            a2aUrl: normalizedA2aUrl,
            healthUrl,
            timeoutMs: config.requestTimeoutMs,
          });
          sendJson(response, 201, {
            identity,
            hub_url: config.publicBaseUrl,
            peer_name: "claw-council",
            api_token: credentials.apiToken,
            a2a_token: credentials.a2aToken,
          });
        } catch (error) {
          if (error instanceof Error && error.message === "identity_exists") {
            sendError(response, 409, "identity_exists", "This identity is already registered");
          } else {
            sendError(response, 401, "invalid_invite", "Invite key is invalid or expired");
          }
        }
        return;
      }

      const client = await authenticate(request, config, registry);
      if (!client) {
        sendError(response, 401, "unauthorized", "A valid bearer token is required");
        return;
      }

      if (request.method === "GET" && url.pathname === "/v1/agents") {
        const { agents } = await directory(config, registry);
        const entries = await Promise.all(
          [...agents.values()].map(async (agent) => ({
            id: agent.identity,
            ...(await probeAgent(agent, config.onlineTimeoutMs)),
          })),
        );
        sendJson(response, 200, { agents: entries });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/messages") {
        let body;
        try {
          body = await readJson(request);
        } catch (error) {
          const tooLarge = error instanceof Error && error.message === "request_too_large";
          sendError(response, tooLarge ? 413 : 400, tooLarge ? "request_too_large" : "invalid_json", tooLarge ? "Request body is too large" : "Body must be valid JSON");
          return;
        }

        const whom = body?.whom;
        const input = body?.input;
        const conversationId = body?.conversation_id;
        if (typeof whom !== "string" || !IDENTITY_PATTERN.test(whom)) {
          sendError(response, 400, "invalid_whom", "whom must be an identity such as yui@padik");
          return;
        }
        if (typeof input !== "string" || input.trim().length === 0 || Buffer.byteLength(input) > 65_536) {
          sendError(response, 400, "invalid_input", "input must contain 1 to 65536 bytes of text");
          return;
        }
        if (conversationId !== undefined && (typeof conversationId !== "string" || !CONVERSATION_PATTERN.test(conversationId))) {
          sendError(response, 400, "invalid_conversation_id", "conversation_id contains unsupported characters");
          return;
        }
        if (!mayContact(client, whom)) {
          sendError(response, 403, "target_forbidden", "This client may not contact the requested agent");
          return;
        }
        const { agents } = await directory(config, registry);
        const agent = agents.get(whom);
        if (!agent) {
          sendError(response, 404, "agent_not_found", "Requested agent is not registered");
          return;
        }

        const id = randomUUID();
        try {
          const task = await sendMessage(agent, {
            input,
            contextId: contextIdFor(client.identity, conversationId),
          });
          if (task.status === "working") {
            pending.set(id, { agent, taskId: task.taskId, from: whom, to: client.identity });
          }
          sendJson(response, task.status === "working" ? 202 : 200, {
            id,
            from: whom,
            to: client.identity,
            status: task.status,
            ...(task.output ? { output: task.output } : {}),
          });
        } catch (error) {
          sendError(response, 502, "agent_unavailable", error instanceof Error ? error.message : String(error));
        }
        return;
      }

      const messageMatch = request.method === "GET" && url.pathname.match(/^\/v1\/messages\/([0-9a-f-]+)$/i);
      if (messageMatch) {
        const id = messageMatch[1];
        const item = pending.get(id);
        if (!item || item.to !== client.identity) {
          sendError(response, 404, "message_not_found", "Message is unknown or no longer pending");
          return;
        }
        try {
          const task = await getTask(item.agent, item.taskId);
          if (task.status !== "working") pending.delete(id);
          sendJson(response, 200, {
            id,
            from: item.from,
            to: item.to,
            status: task.status,
            ...(task.output ? { output: task.output } : {}),
          });
        } catch (error) {
          sendError(response, 502, "agent_unavailable", error instanceof Error ? error.message : String(error));
        }
        return;
      }

      sendError(response, 404, "not_found", "Route not found");
    } catch (error) {
      sendError(response, 500, "internal_error", error instanceof Error ? error.message : String(error));
    }
  });
}

export async function listen(server, { host, port }) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server.address();
}
