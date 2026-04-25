# WAKE

**Will-Aware Knowledge Execution** — A post-mortem protocol for AI agents.

What happens to your agent when you're gone?

## Structure

| Directory | Description |
|---|---|
| [`wake-mcp-server/`](wake-mcp-server/) | MCP server — 23 tools, SQLite, encrypted, multi-user, web dashboard |
| [`docs/`](docs/) | Manifesto site + interactive protocol demo (GitHub Pages) |

## Quick Start

```bash
cd wake-mcp-server
pnpm install && pnpm run build
pnpm start        # stdio + dashboard on http://localhost:3000
pnpm test         # 69 tests
```

## The Protocol

```
ACTIVE → VIGIL → EULOGY → REST
```

Your agent calls `heartbeat` on every interaction. When you stop responding, **VIGIL** triggers. A designated verifier confirms the death. **EULOGY** executes your succession plan — delivering final messages, activating tiered access to your Black Box, and initiating agent-to-agent handoffs. **REST** executes your terminal directive: archive, distill, or delete.

Everything is configurable: beneficiaries, redactions, time-locks, no-resurrection directives, jurisdiction, webhooks.

## Documentation

- [MCP Server README](wake-mcp-server/README.md) — full tool reference, auth, deploy
- [SKILL.md](wake-mcp-server/SKILL.md) — universal agent instructions

## Author

[Omodaka9375](https://github.com/Omodaka9375)

## License

Apache-2.0
