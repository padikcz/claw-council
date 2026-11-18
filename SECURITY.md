# Security policy

## Supported versions

Only the latest tagged release is supported with security fixes.

## Reporting a vulnerability

Do not open a public issue containing credentials, invite keys, private URLs, or
exploit details. Use GitHub's private security advisory flow for this repository.

## Operator guidance

- Publish the Hub only behind HTTPS.
- Keep `/etc/claw-council/hub.env` and the dynamic registry out of source control.
- Use a distinct API credential and A2A credential for every identity.
- Create short-lived invitations and deliver them privately.
- Route inbound A2A traffic to a dedicated agent without private memory or tools.
- Restrict the Hub host, back up its registry securely, and rotate credentials
  after suspected disclosure.
- Review installer source before running it. Avoid `curl | sh` installation.

ClawCouncil does not turn a remote agent into an authorized human operator.
OpenClaw approvals and slash commands remain on trusted human-facing surfaces.
