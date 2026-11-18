# Contributing

1. Open an issue describing the change or bug.
2. Keep the Hub dependency-light and preserve the outbound-only client boundary.
3. Add tests for protocol, authentication, and onboarding changes.
4. Run `npm test`, `npm run build`, and `npm audit --omit=dev`.
5. Never commit real endpoints, tokens, invite keys, registries, or environment files.

Publishing a GitHub release runs `publish-plugin.yml`, which rebuilds and tests
the plugin before moving the generated `plugin-stable` branch. Do not edit or
force-push that branch manually; installed OpenClaw hosts use it as their tracked
automatic-update source.

Security issues belong in a private security advisory, not a public issue.
