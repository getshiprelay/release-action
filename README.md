# ShipRelay Release Action

[![GitHub release](https://img.shields.io/github/v/release/getshiprelay/release-action)](https://github.com/getshiprelay/release-action/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Generate an **automated changelog** whenever a tag is pushed.

ShipRelay Release Action is a **release notes github action** that turns your commits into clean, audience-aware changelogs. If you enable `auto-publish`, it can publish your **AI release notes** immediately after generation.

- Website: [https://shiprelay.io](https://shiprelay.io)
- Interactive demo: [https://shiprelay.io/demo](https://shiprelay.io/demo)

## Quickstart

```yaml
name: Release Notes
on:
  push:
    tags: ['v*']
jobs:
  changelog:
    runs-on: ubuntu-latest
    steps:
      - uses: getshiprelay/release-action@v1
        with:
          api-key: ${{ secrets.SHIPRELAY_API_KEY }}
          auto-publish: true
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `api-key` | Yes | — | Your ShipRelay API key (from Settings → API) |
| `audience` | No | `user` | `developer`, `user`, `executive`, or `marketing` |
| `auto-publish` | No | `false` | `true` publishes automatically, `false` leaves a draft |

## Outputs

| Output | Description |
|---|---|
| `draft-url` | URL to review the draft in ShipRelay dashboard |
| `changelog-url` | URL of the published changelog (only when `auto-publish=true`) |
| `version` | The tag version processed by this run |

## Example with outputs

```yaml
name: Release Notes
on:
  push:
    tags: ['v*']

jobs:
  changelog:
    runs-on: ubuntu-latest
    steps:
      - id: shiprelay
        uses: getshiprelay/release-action@v1
        with:
          api-key: ${{ secrets.SHIPRELAY_API_KEY }}
          audience: user
          auto-publish: false

      - name: Show draft
        run: |
          echo "Version: ${{ steps.shiprelay.outputs.version }}"
          echo "Draft: ${{ steps.shiprelay.outputs.draft-url }}"
```

## First-time setup

1. Create your ShipRelay account.
2. Connect your repository in the dashboard.
3. Copy your project API key from Settings.
4. Add `SHIPRELAY_API_KEY` to your repo secrets.
5. Push a tag like `v1.0.0`.

## Failure messages

The action fails fast with clear messages:

- `API key invalid`
- `Repository not connected`
- `Tag not found`

## Console output

Draft mode:

```text
✅ ShipRelay changelog generated for v1.2.0
📝 Review draft: https://app.shiprelay.io/changelogs/{id}
```

Auto-publish mode:

```text
✅ ShipRelay changelog published for v1.2.0
📄 View: https://{slug}.shiprelay.io/v1.2.0
```

## Notes

- Designed for tag workflows (`refs/tags/*`).
- Polling timeout is 2 minutes to prevent hanging CI jobs.
- Supports `SHIPRELAY_BASE_URL` environment variable for self-hosted/testing environments.
