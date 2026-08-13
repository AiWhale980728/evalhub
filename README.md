# EvalHub

EvalHub is a source-available, self-hosted workspace for comparing 2–8 text
models on the same evaluation dataset. It is designed for product and model
selection teams that need one repeatable flow for BYOK connections, dataset
management, parallel runs, review, and export.

## What it includes

- 2–8 model comparison with responsive matrix, grid, and focused views
- Independent Temperature, Max Tokens, Top P, Top K, penalties, seed, stop sequences, and System Prompt for every selected model
- Multiple model versions under the same provider connection
- OpenAI, Anthropic, Gemini, and OpenAI-compatible endpoints
- An optional offline Mock provider and synthetic dataset, loaded only on request
- CSV, JSON, and JSONL dataset import
- Parallel execution with timeout and concurrency controls
- Keyword heuristic scoring and optional LLM-as-a-Judge fallback
- Latency, token, and configurable cost estimates
- Human review notes and CSV report export
- Functional workspaces for overview, datasets, test cases, tasks, model management, failure analysis, metrics, reports, review, and system settings
- Local JSON persistence and AES-256-GCM encryption for API keys

## Quick start

Requirements: Node.js 22 or newer.

```bash
npm ci
npm run dev
```

Open `http://localhost:4173`. The web interface and local API run together.

EvalHub starts with an empty workspace. It does not automatically create model
connections, datasets, evaluation history, or sample scores.

For a production-style local build:

```bash
npm run build
npm start
```

Open `http://localhost:8787`.

## First use

1. Open **Model Management → API Connections** and add a provider, API key,
   and one or more model IDs.
2. Open **Datasets** and import CSV, JSON, or JSONL test cases.
3. Create an evaluation and select 2–8 models. Models from the same provider
   connection can be compared together.
4. Optionally override inference parameters for each selected model, then run
   the evaluation.
5. Review the matrix, failures, metrics, human-review queue, and CSV report.

To explore EvalHub without a provider key, use **Load removable demo project**
from the empty overview. This explicit action adds an offline Mock connection
and a synthetic support dataset. It does not add evaluation history or
fabricated scores, and both demo assets can be deleted before real use.

## Docker

```bash
docker compose up --build
```

Then open `http://localhost:8787`. Persistent state is stored in the named
`evalhub-data` volume.

For production use, set `EVALHUB_MASTER_KEY` to a long random secret through
your deployment environment. Keep it stable: changing or losing the key makes
previously encrypted API credentials unreadable.

## API connections

Connections are configured in **Model Management → API Connections**. EvalHub
supports these adapter types:

| Type | Typical Base URL | Protocol |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | OpenAI Chat Completions |
| Anthropic | `https://api.anthropic.com` | Anthropic Messages |
| Gemini | `https://generativelanguage.googleapis.com` | Gemini generateContent |
| OpenAI-compatible | Provider or local server URL | OpenAI-compatible endpoints |
| Mock | `mock://local` | Offline deterministic demo |

The application never returns a saved API key to the browser. The connection
list exposes only whether a key exists and its final four characters.

## Dataset formats

JSONL example:

```json
{"id":"TC-001","input":"Explain the refund policy","expectedKeywords":["refund","policy"],"tags":["support"]}
```

CSV example:

```csv
id,input,expected_keywords,tags
TC-001,Explain the refund policy,refund|policy,support
```

The CSV importer supports simple comma-separated rows. Fields containing commas
or line breaks should be supplied as JSONL instead.

## Security model

- State is stored under `EVALHUB_DATA_DIR` and is not committed to source control.
- API keys are encrypted at rest with AES-256-GCM.
- With no configured master key, a random local key is created with restrictive
  file permissions in the data directory.
- The server binds to `127.0.0.1` by default. Docker explicitly binds to all
  container interfaces so the published port can work.
- Write endpoints reject cross-origin browser requests.
- Model prompts and outputs are sent to the providers you configure. Review
  each provider's privacy and retention terms before using confidential data.

For access beyond a trusted machine or network, deploy EvalHub behind an
authenticated reverse proxy. Authentication, role-based access control, SSO,
audit logs, backups, and multi-user isolation must be provided by the deployment
environment. See [SECURITY.md](SECURITY.md).

## Verification

```bash
npm run check
```

This runs unit and API lifecycle tests, the production build, and static worker
packaging tests.

## License

EvalHub is **source available**, not OSI open source. The
[EvalHub Community License](LICENSE) permits personal use and internal use by a
company, including modification, provided the visible `EvalHub by YJW`
attribution remains intact.

The Community License prohibits white-labeling, attribution removal, resale,
paid hosting, SaaS offerings, commercial redistribution, and embedding into a
third-party commercial product without a separate written commercial license.
See [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md) for the licensing boundary.

The license and this summary are not legal advice. Obtain professional legal
review before relying on them for enforcement or compliance decisions.

## Contributing

Bug reports and focused improvements are welcome. Read
[CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change.
