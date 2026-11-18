import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const IDENTITY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}@[a-z0-9][a-z0-9._-]{0,63}$/i;

function requiredEnv(name, env) {
  const value = env[name];
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

function assertUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must use http or https`);
  }
  return url.toString();
}

export function resolveConfig(raw, env = process.env) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Configuration must be an object");
  }

  const rawAgents = raw.agents;
  const rawClients = raw.clients;
  if (!rawAgents || typeof rawAgents !== "object" || Array.isArray(rawAgents)) {
    throw new Error("Configuration requires an agents object");
  }
  if (!rawClients || typeof rawClients !== "object" || Array.isArray(rawClients)) {
    throw new Error("Configuration requires a clients object");
  }

  const agents = new Map();
  for (const [identity, agent] of Object.entries(rawAgents)) {
    if (!IDENTITY_PATTERN.test(identity)) {
      throw new Error(`Invalid agent identity: ${identity}`);
    }
    if (!agent || typeof agent !== "object" || Array.isArray(agent)) {
      throw new Error(`Agent ${identity} must be an object`);
    }
    const a2aUrl = assertUrl(agent.a2aUrl, `agents.${identity}.a2aUrl`);
    const healthUrl = agent.healthUrl
      ? assertUrl(agent.healthUrl, `agents.${identity}.healthUrl`)
      : new URL("/.well-known/agent-card.json", a2aUrl).toString();
    agents.set(identity, {
      identity,
      a2aUrl,
      healthUrl,
      token: requiredEnv(agent.tokenEnv, env),
      timeoutMs: agent.timeoutMs ?? raw.requestTimeoutMs ?? 125_000,
    });
  }

  const clientsByToken = new Map();
  for (const [identity, client] of Object.entries(rawClients)) {
    if (!IDENTITY_PATTERN.test(identity)) {
      throw new Error(`Invalid client identity: ${identity}`);
    }
    if (!client || typeof client !== "object" || Array.isArray(client)) {
      throw new Error(`Client ${identity} must be an object`);
    }
    const token = requiredEnv(client.tokenEnv, env);
    if (clientsByToken.has(token)) {
      throw new Error("Client API tokens must be unique");
    }
    const allow = client.allow ?? ["*"];
    if (!Array.isArray(allow) || !allow.every((entry) => typeof entry === "string")) {
      throw new Error(`clients.${identity}.allow must be an array of identities`);
    }
    clientsByToken.set(token, { identity, allow: new Set(allow) });
  }

  return {
    host: raw.listen?.host ?? "127.0.0.1",
    port: raw.listen?.port ?? 8787,
    onlineTimeoutMs: raw.onlineTimeoutMs ?? 2_500,
    requestTimeoutMs: raw.requestTimeoutMs ?? 125_000,
    publicBaseUrl: raw.publicBaseUrl ? assertUrl(raw.publicBaseUrl, "publicBaseUrl").replace(/\/+$/, "") : undefined,
    registryPath: raw.registryPath ? resolve(raw.registryPath) : undefined,
    allowInsecureJoinUrls: raw.allowInsecureJoinUrls === true,
    agents,
    clientsByToken,
  };
}

export async function loadConfig(path = process.env.COUNCIL_CONFIG ?? "config.json", env = process.env) {
  const absolutePath = resolve(path);
  const raw = JSON.parse(await readFile(absolutePath, "utf8"));
  return resolveConfig(raw, env);
}
