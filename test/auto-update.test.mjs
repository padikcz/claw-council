import assert from "node:assert/strict";
import test from "node:test";
import {
  autoUpdatePaths,
  pluginSource,
  renderService,
  renderTimer,
  renderUpdater,
} from "../scripts/auto-update.mjs";

test("uses the moving stable Git source supported by OpenClaw", () => {
  assert.equal(pluginSource, "git:github.com/padikcz/claw-council@plugin-stable");
});

test("auto-update source does not resolve OpenClaw from npm's project-local PATH", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("../scripts/auto-update.mjs", import.meta.url), "utf8"),
  );
  assert.match(source, /npm", \["prefix", "--global"\]/);
  assert.doesNotMatch(source, /command -v openclaw/);
});

test("updater restores an active Gateway and keeps routine updates capability-gated", () => {
  const script = renderUpdater({
    openclawBinary: "/opt/openclaw/bin/openclaw",
    bootstrapMarker: "/srv/example/bootstrap-stable-source",
  });
  assert.match(script, /systemctl --user stop/);
  assert.match(script, /plugins update claw-council/);
  assert.match(script, /systemctl --user start/);
  assert.match(script, /plugins inspect claw-council --runtime --json/);
  assert.match(script, /if \[ -f "\$bootstrap_marker" \]/);
  assert.match(script, /plugins install 'git:github\.com\/padikcz\/claw-council@plugin-stable' --force --accept-capabilities --no-enable/);
  assert.match(script, /rm -f "\$bootstrap_marker"/);
});

test("capability acceptance is limited to the explicit one-time source migration", () => {
  const script = renderUpdater({
    openclawBinary: "/opt/openclaw/bin/openclaw",
    bootstrapMarker: "/srv/example/bootstrap-stable-source",
  });
  assert.equal(script.match(/accept-capabilities/g)?.length, 1);
  assert.doesNotMatch(script.match(/else\n([\s\S]*?)\nfi/)?.[1] ?? "", /accept-capabilities/);
});

test("timer is persistent, randomized, and receives the protected credential environment", () => {
  const paths = autoUpdatePaths("/srv/example");
  const service = renderService({
    environmentFile: "/srv/example/.config/openclaw/claw-council.env",
    updaterPath: paths.script,
  });
  const timer = renderTimer();
  assert.match(service, /EnvironmentFile=-\/srv\/example\/\.config\/openclaw\/claw-council\.env/);
  assert.match(service, /NoNewPrivileges=true/);
  assert.match(timer, /Persistent=true/);
  assert.match(timer, /RandomizedDelaySec=1h/);
});
