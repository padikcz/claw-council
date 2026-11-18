#!/usr/bin/env node
import { chmod, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export const pluginSource = "git:github.com/padikcz/claw-council@plugin-stable";

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function command(binary, args, { quiet = false } = {}) {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = quiet ? result.stderr?.trim() : "";
    throw new Error(`${binary} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  return quiet ? result.stdout.trim() : "";
}

export function autoUpdatePaths(home = homedir()) {
  const unitDirectory = join(home, ".config", "systemd", "user");
  return {
    script: join(home, ".local", "lib", "claw-council", "update-plugin"),
    bootstrapMarker: join(home, ".local", "state", "claw-council", "bootstrap-stable-source"),
    service: join(unitDirectory, "claw-council-update.service"),
    timer: join(unitDirectory, "claw-council-update.timer"),
  };
}

export function renderUpdater({ openclawBinary, bootstrapMarker }) {
  return `#!/bin/sh
set -eu

openclaw_bin=${shellQuote(openclawBinary)}
bootstrap_marker=${shellQuote(bootstrapMarker)}
gateway_unit=openclaw-gateway.service
gateway_was_active=0

restore_gateway() {
  if [ "$gateway_was_active" -eq 1 ]; then
    systemctl --user start "$gateway_unit"
  fi
}

if systemctl --user is-active --quiet "$gateway_unit"; then
  gateway_was_active=1
fi
trap restore_gateway EXIT HUP INT TERM

if [ "$gateway_was_active" -eq 1 ]; then
  systemctl --user stop "$gateway_unit"
fi

if [ -f "$bootstrap_marker" ]; then
  "$openclaw_bin" plugins install ${shellQuote(pluginSource)} --force --accept-capabilities --no-enable
  rm -f "$bootstrap_marker"
else
  "$openclaw_bin" plugins update claw-council
fi
restore_gateway
gateway_was_active=0
trap - EXIT HUP INT TERM

"$openclaw_bin" plugins inspect claw-council --runtime --json >/dev/null
`;
}

export function renderService({ environmentFile, updaterPath }) {
  return `[Unit]
Description=Update the ClawCouncil OpenClaw plugin
Documentation=https://github.com/padikcz/claw-council
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
EnvironmentFile=-${environmentFile}
ExecStart=${updaterPath}
TimeoutStartSec=15min
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict

[Install]
WantedBy=default.target
`;
}

export function renderTimer() {
  return `[Unit]
Description=Check daily for a stable ClawCouncil plugin update

[Timer]
OnCalendar=*-*-* 04:00:00
RandomizedDelaySec=1h
Persistent=true
Unit=claw-council-update.service

[Install]
WantedBy=timers.target
`;
}

async function assertAbsent(path) {
  try {
    await stat(path);
    throw new Error(`Automatic-update file already exists at ${path}; refusing to overwrite it`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function installAutoUpdate({
  openclawBinary,
  environmentFile,
  bootstrapSource = false,
  replace = false,
  enable = true,
  home = homedir(),
}) {
  const paths = autoUpdatePaths(home);
  if (!replace) {
    await Promise.all([paths.script, paths.service, paths.timer].map(assertAbsent));
  }
  await mkdir(dirname(paths.script), { recursive: true, mode: 0o700 });
  await mkdir(dirname(paths.service), { recursive: true, mode: 0o700 });
  await mkdir(dirname(paths.bootstrapMarker), { recursive: true, mode: 0o700 });
  await writeFile(paths.script, renderUpdater({ openclawBinary, bootstrapMarker: paths.bootstrapMarker }), { mode: 0o700 });
  await chmod(paths.script, 0o700);
  await writeFile(paths.service, renderService({ environmentFile, updaterPath: paths.script }), { mode: 0o600 });
  await writeFile(paths.timer, renderTimer(), { mode: 0o600 });
  if (bootstrapSource) {
    await writeFile(paths.bootstrapMarker, `${pluginSource}\n`, { mode: 0o600 });
  } else {
    await rm(paths.bootstrapMarker, { force: true });
  }
  command("systemctl", ["--user", "daemon-reload"], { quiet: true });
  if (enable) {
    command("systemctl", ["--user", "enable", "--now", "claw-council-update.timer"], { quiet: true });
  }
  return paths;
}

async function main() {
  if (process.platform !== "linux") throw new Error("Automatic updates currently support Linux OpenClaw hosts only");
  const openclawBinary = command("sh", ["-c", "command -v openclaw"], { quiet: true });
  if (!openclawBinary.startsWith("/")) throw new Error("Could not resolve the OpenClaw executable path");
  const environmentFile = join(homedir(), ".config", "openclaw", "claw-council.env");
  await stat(environmentFile);
  const inspection = JSON.parse(command(openclawBinary, ["plugins", "inspect", "claw-council", "--json"], { quiet: true }));
  const bootstrapSource = inspection?.install?.spec !== pluginSource;
  const paths = await installAutoUpdate({ openclawBinary, environmentFile, bootstrapSource, replace: true });
  process.stdout.write(`ClawCouncil now follows the reviewed stable plugin branch. Daily update timer installed at ${paths.timer}.\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
