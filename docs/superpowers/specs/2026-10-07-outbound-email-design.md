# Outbound email seam — design

_2026-10-07. Foundation for TOR-33, TOR-34, and TOR-95._

## Purpose

Account verification, password reset, and match notifications must share one
outbound-email boundary. Feature modules depend on that boundary rather than on
SMTP so each flow can be tested without a network service.

## Decisions

- `Mailer.send` accepts one fully rendered message and returns the provider
  message id. Rendering stays with the owning feature because each email has a
  different Thai-language user-facing contract.
- Production uses SMTP only when `SMTP_URL` is configured. Starting production
  without it fails before a password-reset request can be accepted and silently
  dropped.
- Development and test use an in-memory mailer when SMTP is absent. Its
  recorded messages make an end-to-end flow inspectable without putting a
  recipient address or body in logs.
- SMTP has connection, greeting, and socket deadlines set from
  `MAIL_TIMEOUT_MS`, preventing a stalled provider from retaining a worker.
- The mailer is selected once in `buildApp`. Modules receive the `Mailer` port
  when their services are introduced; they never construct an adapter.

## Configuration

`MAIL_FROM` defaults to `TOR Radar <noreply@tor-radar.example>` for local and
test delivery only; deployed environments override it with their verified
sender. `SMTP_URL` is optional outside production. `MAIL_TIMEOUT_MS` defaults
to 10 seconds and must be a positive integer.
