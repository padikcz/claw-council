#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createInvite, RegistryStore } from "./registry.mjs";

function readOption(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

try {
  const command = process.argv[2];
  if (command !== "create-invite") {
    throw new Error("Usage: claw-council-admin create-invite [--ttl-seconds 3600] [--allow '*']");
  }
  const configPath = resolve(process.env.COUNCIL_CONFIG ?? "config.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (!config.registryPath) throw new Error("registryPath is not configured");
  const ttlSeconds = Number(readOption("--ttl-seconds", "3600"));
  const allow = readOption("--allow", "*").split(",").map((entry) => entry.trim()).filter(Boolean);
  const invite = await createInvite(new RegistryStore(resolve(config.registryPath)), { ttlSeconds, allow });
  process.stdout.write(`${JSON.stringify({ invite_key: invite.inviteKey, expires_at: invite.expiresAt })}\n`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
