<div align="center">
  <h1>CPA Key Manager (cpa-key-billing)</h1>
  <p><strong>Per-key billing, team group routing pools, model-scoped quotas, and per-account concurrency management for <a href="https://github.com/router-for-me/CLIProxyAPI">CLIProxyAPI</a>.</strong></p>
  <p>
    <a href="https://github.com/hbdzp/CPA-Key-Manager/releases/latest"><img src="https://img.shields.io/github/v/release/hbdzp/CPA-Key-Manager?label=release" alt="Latest release"></a>
    <a href="https://github.com/hbdzp/CPA-Key-Manager/actions/workflows/check.yml"><img src="https://github.com/hbdzp/CPA-Key-Manager/actions/workflows/check.yml/badge.svg" alt="CI status"></a>
    <img src="https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux-blue" alt="Platforms: Windows, macOS, and Linux">
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License"></a>
  </p>
  <p><strong>English</strong> · <a href="./README.md">简体中文</a></p>
</div>
<img src="images/example.png" alt="CPA Key Billing dashboard" width="100%" />

**Plugin ID: `cpa-key-billing` · Store Name: API Key 计费与团队管理 · Repository: [hbdzp/CPA-Key-Manager](https://github.com/hbdzp/CPA-Key-Manager)**

## Features

- **Multi-window Quotas & Model-Scoped Quota Pools (`QuotaScope`)**
  - Set spending (USD), token, and request quotas for each API key, with independent or shared reset schedules.
  - Scope each quota window within a plan to **all models**, **model families** (`Claude`, `GPT`, `Gemini`, `DeepSeek`, `Qwen`, `Grok`, `Kimi`, `GLM`), or **custom rules** (exact model IDs and `prefix*` wildcards) with live matched/excluded model preview.
- **Team Groups & Tri-mode Credential Pools (`ordinary` / `exclusive` / `common`)**
  - **Ordinary Pool (`ordinary`)**: Standard team permission group with shared credentials across groups.
  - **Exclusive Pool (`exclusive`)**: Reserves bound credentials/categories exclusively for keys in this group, automatically preventing other groups and ungrouped keys from using them.
  - **Common Pool (`common`)**: Shared fallback pool automatically merged into all grouped API keys without per-key binding.
  - **Dual Access-Control Switches**: Master switch to enable/disable group & route access control, plus an opt-in switch to deny ungrouped API keys (`deny_ungrouped`).
  - **In-Group Upstream Account Toggle**: View runtime concurrency and directly enable/disable upstream accounts inside each group card.
- **Fine-grained Routing & Pinned-Selection Tri-state Picker**
  - Configure model, credential-category, and individual credential allow/deny rules across Routes, Team Groups, and API Keys.
  - Built-in tri-state picker (`unselected` / `allowed ✓` / `denied ✕`) with category & status filtering, filtered bulk actions, and **memorized pinned sorting** that keeps initially selected items at the top when opening a drawer.
  - **Seamless Credential Rotation Migration**: Automatically migrates bound credential fingerprints across routes, groups, and keys when an upstream OAuth auth file rotates to a new credential ID under the same provider, source, and account.
- **Upstream Per-Account Concurrency Limits & Usage Analytics**
  - Configure a default per-account concurrency limit (`0–1000`) and per-account overrides (`0–1000`).
  - Dual enforcement: `scheduler.pick` steers away from saturated accounts while `request.intercept_after` atomically reserves account concurrency slots.
  - Dedicated **Per-Account Concurrency** and **Account Usage & Concurrency** cards on the Auth Files page.
- **Flexible Pricing & `$0` Admission for Unpriced Models**
  - Sync reference prices from [models.dev](https://models.dev/), apply custom overrides, long-context tiered pricing, and 2.5× Codex priority billing.
  - Unpriced models are automatically admitted at `$0` (`unpriced`) with token and request tracking instead of returning `503 model_price_error`.
- **Self-Service API Key Portal (`#account`)**
  - Downstream users can inspect their quota windows, model scopes, accessible models, `partially_blocked` status, and usage history.

## Requirements

- CLIProxyAPI **7.3.7 or later** (compatible with v8).
- A CLIProxyAPI build with plugin support (`no-plugin` builds cannot load this plugin).

## Installation

Supports Linux `amd64` / `arm64`, macOS `amd64` / `arm64`, and Windows `amd64` / `arm64`.

### Option 1: Plugin Store (Recommended)

Add this repository's `registry.json` to `plugins.store-sources` in your `config.yaml`:

```yaml
plugins:
  enabled: true
  dir: "plugins"
  store-sources:
    - "https://raw.githubusercontent.com/hbdzp/CPA-Key-Manager/main/registry.json"
```

Then install from the management panel's **Plugin Store** or via the management API (`source-f6b85975fe67` is the deterministic `source_id` for the URL above):

```bash
curl -X POST "http://127.0.0.1:8317/v8/management/plugins/store/cpa-key-billing/install?source=source-f6b85975fe67" \
  -H "Authorization: Bearer <MANAGEMENT_KEY>"
```

### Option 2: Installer Script

Run the installer from your CLIProxyAPI directory.

On macOS or Linux:

```sh
curl -LsSf https://raw.githubusercontent.com/hbdzp/CPA-Key-Manager/main/install.sh | sh
```

On Windows, stop CLIProxyAPI first, then run this in PowerShell:

```powershell
irm https://raw.githubusercontent.com/hbdzp/CPA-Key-Manager/main/install.ps1 | iex
```

### Option 3: Manual Release Download

Download the archive for your platform from [Releases](https://github.com/hbdzp/CPA-Key-Manager/releases/latest) and extract the library into CLIProxyAPI’s `plugins/` directory:

```text
plugins/cpa-key-billing.so       # Linux (amd64 / arm64)
plugins/cpa-key-billing.dylib    # macOS (amd64 / arm64)
plugins/cpa-key-billing.dll      # Windows (amd64 / arm64)
```

## Configuration

Add the following to your CLIProxyAPI `config.yaml`:

```yaml
plugins:
  enabled: true
  dir: "plugins"
  configs:
    cpa-key-billing:
      enabled: true
      priority: 100 # Plugin scheduling priority; higher values take precedence
      debug: false # Include routing and reference-price matching in debug logs
      codex_fast_mode_billing: false # Charge 2.5× for Codex priority requests
      mask_api_key_view_emails: false # Mask email addresses in API key account views
      allow_api_key_quota_reset: false # Allow API key users to reset accessible Codex and Claude auth file quotas
      state_file: "plugins/cpa-key-billing-state-v1.db"
      routing:
        strategy: "round-robin" # round-robin, weighted-round-robin, fill-first
        session-affinity: false # Reuse an available upstream credential for the same session
        session-affinity-ttl: "1h" # Idle timeout for session bindings
```

## Rejection responses

| Condition | HTTP status | `type` | `code` |
| --- | --- | --- | --- |
| API key concurrency limit reached | `429` | `rate_limit_error` | `rate_limit_exceeded` |
| Upstream account concurrency limit reached | `429` | `rate_limit_error` | `rate_limit_exceeded` |
| Subscription quota window exhausted | `429` | `rate_limit_error` | `rate_limit_exceeded` |
| Ungrouped API key denied / all assigned groups disabled | `403` | `permission_error` | `access_denied` |
| Model access denied | `403` | `permission_error` | `insufficient_quota` |
| No available credential matches the routing rules | `503` | `server_error` | `internal_server_error` |
| Selected credential violates routing or exclusive-pool rules | `503` | `server_error` | `routing_credential_mismatch` |
| Selected credential's routing permissions cannot be verified | `503` | `server_error` | `routing_credential_unverified` |
| Bound routing rule or exclusive-pool configuration conflict | `503` | `server_error` | `routing_configuration_error` |

## Acknowledgments

- Upstream base: [haowang02/cpa-plugin-key-billing](https://github.com/haowang02/cpa-plugin-key-billing)
- Feature reference: [CHIMOOO/cpa-plugin-key-billing-manager](https://github.com/CHIMOOO/cpa-plugin-key-billing-manager)
- [LINUX DO](https://linux.do/) community.
