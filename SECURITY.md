# Security Policy

## Supported versions

Security fixes are developed for the latest released version and the `main`
branch. Older releases may not receive backported fixes. Before reporting a
problem, reproduce it against the latest release when it is safe to do so.

## Reporting a vulnerability

Do not disclose suspected vulnerabilities in a public issue, discussion,
chat, or pull request.

Use the repository's private **Security advisory** reporting flow:

1. Open the repository's **Security** tab.
2. Select **Advisories** and **Report a vulnerability**.
3. Include the affected version or commit, deployment configuration, impact,
   reproduction steps, and any suggested mitigation.

If private vulnerability reporting is unavailable, contact a maintainer
privately through a contact channel published by the project and ask for a
secure reporting method. Do not send exploit details until a private channel
has been established.

Reports should contain:

- A concise description of the issue and its security impact.
- The affected server, agent, desktop, plugin, or deployment component.
- Preconditions such as authentication level, network access, or platform.
- Minimal reproduction steps or a proof of concept.
- Relevant logs with credentials, tokens, client data, and personal data
  removed.
- Whether the issue is known to be actively exploited or publicly disclosed.

Maintainers will make a best effort to acknowledge a complete report within
three business days, validate and triage it, coordinate a remediation and
release, and credit the reporter unless anonymity is requested.

## Disclosure expectations

Please allow maintainers a reasonable opportunity to investigate and publish
a fix before public disclosure. Maintainers will communicate material changes
in severity or remediation status through the private report.

Testing must follow [ACCEPTABLE_USE.md](ACCEPTABLE_USE.md). In particular, only
test systems and accounts you own or are explicitly authorized to assess.
Avoid accessing real user data, degrading service, establishing persistence,
or retaining data obtained during testing.

## Operational security

Operators are responsible for securing their deployment. At minimum:

- Restrict network exposure and place internet-facing installations behind a
  properly configured TLS endpoint.
- Change or otherwise protect default credentials before exposing the service
  to untrusted networks.
- Protect `save.json`, databases, certificates, signing keys, agent tokens,
  backups, and uploaded files as secrets.
- Enable agent authentication, enrollment approval, least-privilege RBAC, MFA,
  and audit logging where appropriate.
- Keep the server, agents, desktop application, container images, host
  operating system, and reverse proxy current.
- Review plugins and signing keys before installation.
- Back up persistent data and periodically test restoration.

## Scope

The following are generally in scope when they affect the latest release:

- Authentication, authorization, session, MFA, OIDC, and enrollment bypasses.
- Cross-tenant or cross-client access.
- Remote code execution or command injection.
- Path traversal, unsafe upload handling, or unauthorized file access.
- Cryptographic, signing, update, or agent identity failures.
- Plugin sandbox escapes or signature-validation bypasses.
- Sensitive information exposure.

The following are generally not security vulnerabilities by themselves:

- Findings that require an already fully privileged administrator and do not
  cross an intended trust boundary.
- Missing hardening on an installation that contradicts the documented
  deployment requirements.
- Denial-of-service reports without a practical, reproducible impact.
- Automated scanner output without validation.
- Social engineering, physical attacks, or attacks against third-party
  services outside the project's control.

