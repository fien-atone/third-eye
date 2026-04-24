# Security Policy

Third Eye runs entirely on your machine. Your session data, DB, and
server all live on localhost — nothing is transmitted off your box.

## Reporting a vulnerability

If you find a security issue — **do not open a public GitHub issue**.

Preferred: [open a private security advisory](https://github.com/fien-atone/third-eye/security/advisories/new)
on this repo. GitHub delivers it to me privately and gives us a
structured place to coordinate a fix.

Alternative: email `contact@ivanshumov.com` with:

- Description of the issue
- Steps to reproduce
- Your assessment of impact (what could an attacker do?)
- Affected version(s)

I'll acknowledge within 72 hours.

## Scope

**In scope:**
- Third Eye's own server code (ingest, API, static serving)
- Client-side code shipped in this repo
- Docker image build produced by this repo's Dockerfile
- Anything that could leak your session data off your machine or
  let a local-network attacker reach the dashboard when you didn't
  intend it to be exposed

**Out of scope:**
- Issues in Claude Code, Codex CLI, or any other upstream tool that
  writes the session files we read
- Issues in third-party dependencies (report those to the upstream
  project; I'll bump versions here once they ship a fix)
- Social engineering / physical access to the machine running
  Third Eye
- Denial of service from arbitrarily large session files

## Supported versions

Only the latest `v2.x` release line receives security fixes. If you
run an older version, upgrade first and confirm the issue still
reproduces.

| Version | Supported |
| ------- | --------- |
| 2.x     | ✅        |
| 1.x     | ❌        |
