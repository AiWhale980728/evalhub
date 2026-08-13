# Security Policy

## Supported version

Security fixes currently target the latest commit on the `main` branch.

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue. Use GitHub's
private vulnerability reporting feature for this repository. Include the
affected version, reproduction steps, impact, and any suggested mitigation.

## Deployment guidance

EvalHub is local-first and binds to the loopback interface by default. The MVP
does not provide user authentication or tenant isolation. If access outside a
trusted machine is required:

- place EvalHub behind an authenticated TLS reverse proxy;
- restrict network access with a firewall or private network;
- provide `EVALHUB_MASTER_KEY` through a secrets manager;
- back up the data directory and encryption key separately;
- use a dedicated low-privilege API key for each model provider;
- avoid importing personal, regulated, or production data unless the complete
  deployment and provider data path has been reviewed.

Never commit the data directory, `.master-key`, `.env` files, API credentials,
evaluation outputs, or customer datasets.

## Scope limitations

This MVP has no authentication, RBAC, SSO, audit log, or multi-user isolation.
Security headers and same-origin write checks are defense-in-depth measures,
not a substitute for access control.
