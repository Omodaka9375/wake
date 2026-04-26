# WAKE MCP Server

[![npm](https://img.shields.io/npm/v/wake-mcp-server)](https://www.npmjs.com/package/wake-mcp-server) [![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

**Will-Aware Knowledge Execution** - A post-mortem protocol for AI agents.

23 tools · SQLite + AES-256-GCM encryption · Token auth

## Quick Start

```bash
# From source
pnpm install && pnpm run build
pnpm start              # stdio + dashboard on :3000
pnpm run start:http     # dashboard only (no stdio)
pnpm test               # 69 tests

# npx
npx wake-mcp-server
npx wake-mcp-server --http

# Docker
docker build -t wake-mcp-server .
docker run -p 3000:3000 -v wake-data:/app/data wake-mcp-server
```

Dashboard: `http://localhost:3000` (always available)

## Connect Your Agent

**Warp / Claude Desktop / Cursor** — same config, different file locations:

| Client | Config file |
|---|---|
| Warp | Settings → MCP |
| Claude Desktop | `claude_desktop_config.json` (under `mcpServers`) |
| Cursor | `.cursor/mcp.json` (under `mcpServers`) |

Using npx (recommended):
```json
{
  "wake-protocol": {
    "command": "npx",
    "args": ["wake-mcp-server"]
  }
}
```

Or with a local build:
```json
{
  "wake-protocol": {
    "command": "node",
    "args": ["<path>/wake-mcp-server/build/index.js"]
  }
}
```

**Any MCP client over HTTP:**
```
http://localhost:<port>/mcp
```
Default port is 3000. If taken, auto-increments. Set `WAKE_PORT` to override. Check the console output for the actual URL.

## Agent Skill

[`SKILL.md`](SKILL.md) — platform-agnostic instructions that teach any agent how to use WAKE:
- **Owner** — auto-heartbeat, conversational will setup, proactive knowledge contribution
- **Verifier** — death confirmation handling
- **Beneficiary** — tier-scoped access, final messages, handoff packages
- **Executor** — EULOGY management, legal export, terminal state, data purge

Point your agent at `SKILL.md` or include it in your system prompt.

## Protocol

```
ACTIVE → VIGIL → EULOGY → REST
```

- **ACTIVE** — Owner alive. Agent calls `heartbeat` each interaction.
- **VIGIL** — Inactivity threshold exceeded. Awaiting verifier confirmation.
- **EULOGY** — Succession executing. Tiered access, Black Box, final messages.
- **REST** — Terminal state (archive/distill/delete). Protocol complete.

## Authentication

Tokens generated once during `configure_will`. Three types:
- **Master** — owner operations (heartbeat, configure, vigil)
- **Verifier** — death confirmation only
- **Beneficiary** — per-person, scoped by tier (executor/beneficiary/memorial)

Tokens stored as SHA-256 hashes. State encrypted with AES-256-GCM (server key).

## Tools

### Will Management
| Tool | Auth | Phase | Description |
|---|---|---|---|
| `configure_will` | none | any | Create will, generate all tokens |
| `update_will` | master | ACTIVE | Modify will fields |
| `heartbeat` | master | ACTIVE | Signal owner is alive |
| `get_status` | optional | any | Protocol status (detailed with token) |

### Protocol Progression
| Tool | Auth | Phase | Description |
|---|---|---|---|
| `trigger_vigil` | master | ACTIVE | Manually force VIGIL |
| `verify_death` | verifier | VIGIL | Confirm death event |
| `execute_terminal_state` | executor | EULOGY | Execute archive/distill/delete |

### Data Access
| Tool | Auth | Phase | Description |
|---|---|---|---|
| `get_access_tier` | any token | any | Check token holder's tier |
| `get_final_message` | any token | EULOGY/REST | Retrieve final message (time-lock aware) |
| `get_black_box` | any token | EULOGY/REST | Compiled knowledge, tier-scoped |
| `get_audit_log` | executor | any | Full audit trail |

### Knowledge
| Tool | Auth | Phase | Description |
|---|---|---|---|
| `contribute_knowledge` | master | ACTIVE | Add knowledge entry (category, summary, details) |
| `list_knowledge` | master | ACTIVE | List entries, optional category filter |
| `delete_knowledge` | master | ACTIVE | Remove an entry |

### Inter-Agent Handoff
| Tool | Auth | Phase | Description |
|---|---|---|---|
| `initiate_handoff` | executor | EULOGY/REST | Generate handoff package for a beneficiary |
| `get_handoff_package` | any token | EULOGY/REST | Self-serve handoff (wake-handoff-v1 JSON) |

### Backup & Recovery
| Tool | Auth | Phase | Description |
|---|---|---|---|
| `export_will` | executor | any | Export encrypted state blob |
| `import_will` | none | any | Import from exported blob |
| `list_backups` | executor | any | List auto-backup snapshots |
| `restore_backup` | executor | any | Restore from backup |

### Legal & Compliance
| Tool | Auth | Phase | Description |
|---|---|---|---|
| `export_legal_will` | executor | any | RUFADAA-compatible legal document |
| `purge_owner_data` | executor | REST | Permanently delete all data (right to be forgotten) |
| `get_deletion_certificate` | none | any | Retrieve deletion certificate after purge |

## Key Features

- **Multi-user** — `ownerId` param on every tool, independent state per owner
- **Auto-backup** — previous state saved on every write, last 5 kept
- **Background monitor** — checks heartbeat staleness every 5 min, auto-triggers VIGIL
- **Dead man's switch** — auto-escalates VIGIL → EULOGY if verifier doesn't respond
- **Webhooks** — fire on `vigil.triggered`, `eulogy.started`, `eulogy.message`, `rest.executed`, `timelock.released`
- **Time-locks** — `releaseAfter` on messages and knowledge entries, sealed until date
- **Redaction filtering** — entries matching redaction categories hidden from all tiers
- **Tier-scoped Black Box** — executor sees all, beneficiary sees finances/contacts/documents, memorial sees curated entries only
- **No-resurrection directive** — enforceable flag propagated to handoffs and certificates
- **Jurisdiction mapping** — legal export maps to applicable laws (RUFADAA, GDPR, ELVIS Act, etc.)
- **Deletion certificate** — SHA-256 attested record, sole survivor of data purge

## Dashboard

Web UI at `http://localhost:3000`. Role-based views:
- **Login** — paste any token, auto-detects role
- **Owner** — status, knowledge CRUD, heartbeat, VIGIL trigger, legal export
- **Verifier** — status, death confirmation
- **Executor** — Black Box, messages, audit, terminal state, handoff, purge
- **Beneficiary/Memorial** — tier-scoped Black Box, messages

Set `WAKE_PORT=8080` to change the port.

## Data

SQLite database at `data/wake.db`. Server encryption key at `data/.server-key`. Deletion certificates at `data/deletion-certificate-*.json`.

Delete the `data/` directory to reset everything.

## Deploy

**One-click:**

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/wake-mcp-server)

[![Deploy on Fly.io](https://img.shields.io/badge/Deploy-Fly.io-8B5CF6)](https://fly.io/launch?image=wake-mcp-server)

**CLI:**
```bash
# Railway
railway init && railway up

# Fly.io
fly launch       # creates app + volume
fly deploy

# Docker
docker build -t wake-mcp-server .
docker run -p 3000:3000 -v wake-data:/app/data wake-mcp-server
```

**Docker Compose:**
```yaml
services:
  wake:
    build: .
    ports: ["3000:3000"]
    volumes: ["wake-data:/app/data"]
volumes:
  wake-data:
```

Config files included: `railway.toml`, `fly.toml`, `vercel.json`, `Dockerfile`.

Note: Vercel is serverless — SQLite won't persist. Use Railway or Fly for production.
