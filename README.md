<h1 align="center">AIUSD Pro</h1>

<p align="center">
  <strong>AI-powered trading agent with built-in reasoning.</strong>
</p>

<p align="center">
  <a href="https://aiusd.ai"><img src="https://img.shields.io/badge/aiusd.ai-visit-blue" alt="Website" /></a>
  <a href="https://www.npmjs.com/package/aiusd-pro"><img src="https://img.shields.io/npm/v/aiusd-pro" alt="npm" /></a>
  <a href="https://github.com/galpha-ai/aiusd-pro/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License" /></a>
</p>

---

AIUSD Pro delegates to a managed backend agent that handles all reasoning, tool selection, multi-step execution, and transaction confirmation. Speak naturally — the agent understands intent, manages context across turns, and executes end-to-end.

> Looking for structured CLI tools without managed inference? See [AIUSD Core](https://github.com/galpha-ai/aiusd-core).

## Install

### Claude Code / Codex / Cursor

```bash
npx skills add galpha-ai/aiusd-pro -y -g
```

### OpenClaw

Drag & drop the [.skill file](https://github.com/galpha-ai/aiusd-pro/releases/latest/download/aiusd-pro.skill) into your OpenClaw chat, or:

```bash
openclaw skill install aiusd-pro.skill
```

### npm

```bash
npm install -g aiusd-pro
```

### Manual

```bash
git clone https://github.com/galpha-ai/aiusd-pro.git
cd aiusd-pro && npm install && npm run build
```

## Quick Start

```bash
aiusd-pro login --browser                    # Authenticate
aiusd-pro send "What are my balances?"       # Ask anything
aiusd-pro send "Buy $100 of SOL"             # Execute trades
aiusd-pro send "Long ETH 10x"               # Complex strategies
```

## How It Works

1. **Send** — your message is posted to the AIUSD backend agent
2. **Reason** — the agent selects tools, plans execution, and handles multi-step logic
3. **Execute** — trades are placed, transactions are confirmed automatically
4. **Respond** — results stream back in natural language

Sessions maintain full conversation context. Follow-ups, confirmations, and multi-turn workflows are handled automatically.

## What You Can Do

| Domain | Examples |
|--------|---------|
| **Spot Trading** | "Buy $100 of SOL", "Sell all my ETH", "Swap TRUMP for USDC" |
| **Perpetuals** | "Long ETH 10x", "Short BTC at $70k", "Close my position" |
| **Prediction Markets** | "Bet $10 on Yes for Bitcoin 100k", "Search election markets" |
| **Account** | "What's my balance?", "Show my deposit addresses" |
| **Staking** | "Stake 500 AIUSD", "Unstake my AIUSD" |
| **Market Data** | "What's trending?", "Show xStock prices" |
| **Monitoring** | "Monitor @elonmusk with $100 budget" |

## Authentication

```bash
aiusd-pro login --browser       # Sign in via browser
aiusd-pro login --new-wallet    # Create a new account
aiusd-pro logout                # Sign out
```

## Session Management

```bash
aiusd-pro session new           # Start a new conversation
aiusd-pro session list          # List sessions
aiusd-pro session reset         # Reset current session
aiusd-pro cancel                # Cancel active operation
```

## Supported Platforms

| Platform | Install |
|----------|---------|
| Claude Code | `npx skills add galpha-ai/aiusd-pro` |
| Codex | `npx skills add galpha-ai/aiusd-pro` |
| Cursor | `npx skills add galpha-ai/aiusd-pro` |
| OpenClaw | `.skill` file or symlink |
| GitHub Copilot | Symlink to `.github/skills/` |

## Core vs. Pro

| | Core | Pro |
|---|------|-----|
| **Inference** | Client-side LLM | Managed backend agent |
| **Interface** | Structured CLI commands | Natural language |
| **Inference cost** | None — bring your own LLM | Included |
| **Best for** | Developers building custom agents | End users and turnkey integrations |

## Security

- **Local-first** — authentication tokens stored on-device (`~/.aiusd/`)
- **Open source** — fully auditable skill code
- **Managed execution** — trades execute through the AIUSD platform with custody controls

## Links

- [Documentation](https://docs.aiusd.ai)
- [AIUSD Core](https://github.com/galpha-ai/aiusd-core) — structured CLI tools, no managed inference
- [Website](https://aiusd.ai)

## License

MIT
