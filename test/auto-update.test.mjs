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

test("updater always restores an active Gateway and never auto-accepts new capabilities", () => {
  const script = renderUpdater({ openclawBinary: "/opt/openclaw/bin/openclaw" });
  assert.match(script, /systemctl --user stop/);
  assert.match(script, /plugins update claw-council/);
  assert.match(script, /systemctl --user start/);
  assert.match(script, /plugins inspect claw-council --runtime --json/);
  assert.doesNotMatch(script, /accept-capabilities/);
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
