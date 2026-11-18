import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const EMPTY_REGISTRY = Object.freeze({
  version: 1,
  agents: {},
  clients: {},
  invites: {},
});

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function generateToken() {
  return randomBytes(32).toString("hex");
}

function normalizeRegistry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Registry must contain an object");
  }
  if (value.version !== 1) throw new Error("Unsupported registry version");
  for (const key of ["agents", "clients", "invites"]) {
    if (!value[key] || typeof value[key] !== "object" || Array.isArray(value[key])) {
      throw new Error(`Registry field ${key} must be an object`);
    }
  }
  return value;
}

export async function readRegistry(path) {
  if (!path) return structuredClone(EMPTY_REGISTRY);
  try {
    return normalizeRegistry(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return structuredClone(EMPTY_REGISTRY);
    throw error;
  }
}

export async function writeRegistry(path, registry) {
  if (!path) throw new Error("registryPath is not configured");
  normalizeRegistry(registry);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export class RegistryStore {
  #queue = Promise.resolve();

  constructor(path) {
    this.path = path;
  }

  read() {
    return readRegistry(this.path);
  }

  transact(mutator) {
    const operation = this.#queue.then(async () => {
      const registry = await this.read();
      const result = await mutator(registry);
      await writeRegistry(this.path, registry);
      return result;
    });
    this.#queue = operation.catch(() => undefined);
    return operation;
  }
}

export async function createInvite(store, { ttlSeconds = 3600, allow = ["*"] } = {}) {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 604800) {
    throw new Error("ttlSeconds must be between 60 and 604800");
  }
  if (!Array.isArray(allow) || allow.length === 0 || !allow.every((entry) => typeof entry === "string")) {
    throw new Error("allow must be a non-empty array of identities or *");
  }
  const inviteKey = `cci_${generateToken()}`;
  const now = Date.now();
  const expiresAt = now + ttlSeconds * 1000;
  await store.transact((registry) => {
    registry.invites[hashToken(inviteKey)] = {
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
      allow,
    };
  });
  return { inviteKey, expiresAt: new Date(expiresAt).toISOString() };
}

export async function redeemInvite(store, { inviteKey, identity, a2aUrl, healthUrl, timeoutMs }) {
  return store.transact((registry) => {
    const inviteHash = hashToken(inviteKey);
    const invite = registry.invites[inviteHash];
    if (!invite || Date.parse(invite.expiresAt) <= Date.now()) {
      if (invite) delete registry.invites[inviteHash];
      throw new Error("invalid_invite");
    }
    if (registry.agents[identity] || registry.clients[identity]) {
      throw new Error("identity_exists");
    }

    const apiToken = `cca_${generateToken()}`;
    const a2aToken = `cca2a_${generateToken()}`;
    const createdAt = new Date().toISOString();
    registry.agents[identity] = {
      a2aUrl,
      healthUrl,
      token: a2aToken,
      timeoutMs,
      createdAt,
    };
    registry.clients[identity] = {
      tokenHash: hashToken(apiToken),
      allow: invite.allow,
      createdAt,
    };
    delete registry.invites[inviteHash];
    return { apiToken, a2aToken };
  });
}
