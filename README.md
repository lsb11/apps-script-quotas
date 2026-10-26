# apps-script-quotas

[![npm version](https://img.shields.io/npm/v/apps-script-quotas)](https://www.npmjs.com/package/apps-script-quotas) [![Quota tracker](https://github.com/lsb11/apps-script-quotas/actions/workflows/track-quotas.yml/badge.svg)](https://github.com/lsb11/apps-script-quotas/actions/workflows/track-quotas.yml) [![license](https://img.shields.io/npm/l/apps-script-quotas)](#license)

Every **Google Apps Script quota and limit** as data, checked against [Google's quotas page](https://developers.google.com/apps-script/guides/services/quotas) every day, with a CLI that tells you **which limit your script will hit first** and what an Apps Script quota error means.

Google updates that page without announcing it, and doesn't keep a history of old values. This repo does: when a limit changes, the daily check records the old and new value in [CHANGELOG.md](CHANGELOG.md).

```
npx apps-script-quotas check --rows 500 --calls 3 --latency 200 --runs 4
```

```
Fits. The closest ceiling is script runtime per execution, at 83%.

  ok    Script runtime per execution       5:00 of 6:00  (83%)
  ok    Trigger runtime per day            20 min of 90 min  (22%)

  One run fits about 600 items before the per-run limit.
  Latency is the only estimate here. Replace it with a measured figure for your script.
```

Zero dependencies. Node 18 or later.

## Commands

```bash
# every quota and limitation (consumer accounts; add --workspace for Workspace)
npx apps-script-quotas
npx apps-script-quotas --workspace

# one limit
npx apps-script-quotas get "url fetch calls"

# which ceiling a job hits first
npx apps-script-quotas check --rows 500 --calls 3 --latency 200 --runs 4 --fetches 1
npx apps-script-quotas check --rows 800 --calls 1 --latency 150 --custom-function

# what an error means
npx apps-script-quotas explain "Service using too much computer time for one day"
npx apps-script-quotas explain "There are too many scripts running simultaneously for this Google user account."

# JSON for scripts and CI
npx apps-script-quotas check --rows 500 --calls 3 --json
```

`check` options:

| Flag | Meaning |
| --- | --- |
| `--rows <n>` | Items processed per run (required) |
| `--calls <n>` | Service calls per item: each `getValue`, `setValue`, `appendRow` or `UrlFetchApp.fetch` (required) |
| `--latency <ms>` | Average milliseconds per call. Default 200. Measure yours with `console.time()` |
| `--runs <n>` | Trigger runs per day. Default 1 |
| `--fetches <n>` | UrlFetch calls per item, to check the daily URL Fetch quota. Default 0 |
| `--custom-function` | The code runs from a cell, so it has a 30-second limit |
| `--manual` | Not run by a trigger, so the daily trigger runtime quota does not apply |
| `--workspace` | Use Google Workspace limits |

## What `check` measures

A script can be stopped by three different ceilings, and they bind in different orders depending on the job:

1. **Per-execution runtime:** 6 minutes for a normal script on any account, 30 seconds for a custom function.
2. **Daily trigger runtime:** 90 minutes a day on a consumer account, 6 hours on Workspace. Only triggered runs count.
3. **Daily URL Fetch calls:** 20,000 a day on a consumer account, 100,000 on Workspace.

The arithmetic is `rows × calls × latency`, compared against each ceiling. Every limit comes from the shipped data; the only estimate is the latency you pass in.

## Use it as a library

```js
const quotas = require('apps-script-quotas');

quotas.get('url-fetch-calls', 'consumer');
// { raw: '20,000 / day', value: 20000, unit: null, per: 'day', note: false }

quotas.get('Triggers total runtime', 'workspace').seconds;
// 21600

const e = quotas.estimate({ rows: 500, callsPerRow: 3, latencyMs: 200, runsPerDay: 4 });
e.binding.id;      // 'script-runtime'
e.maxRowsPerRun;   // 600

quotas.explain('Limit exceeded: Email Attachments Per Message.');
// { cause, fix, limits: [{ feature: 'Email attachments', value: '250 / msg' }], guide }

quotas.meta;
// { source, googleLastUpdated: '2026-09-03', checkedAt: '2026-09-26' }
```

The raw data is in [`data/quotas.json`](data/quotas.json). Each row keeps Google's exact wording in `raw`, plus parsed `value`, `unit`, `per` and, for time limits, `seconds`. `note: true` means Google attaches a footnote to that value (for example, lower limits on trial accounts), so check the source page.

## How the tracking works

A [GitHub Action](.github/workflows/track-quotas.yml) fetches Google's quotas page once a day, parses both tables and compares them with `data/quotas.json`. If any value has changed, it commits the new data, adds a dated entry to [CHANGELOG.md](CHANGELOG.md) and opens an issue. If the page can't be parsed, it opens an issue instead of guessing, and the existing data stays as it was.

Watch this repo (Custom, then Releases and Issues) to hear when Google changes a limit.

Google's page says its quotas are "subject to elimination, reduction, or change at any time, without notice". This package reports what Google publishes. Treat it as a guide, and check the source page before relying on a figure.

## Guides

The fixes behind `check` and `explain`, with working code:

- **[Google Apps Script quotas explained](https://stackarchitect.xyz/blog/google-apps-script-quotas-explained-how-to-avoid-limits-and-scale-your-automations/)**: every limit, the errors each one causes, and a resumable batch pattern that survives the 6-minute limit.
- **[Google Sheets custom function errors](https://stackarchitect.xyz/blog/google-sheets-custom-function-errors/)**: the 30-second limit, `Loading...` that never finishes, "too many scripts running simultaneously", and how to process a range in one call.
- **[Autocrat stopping mid-merge](https://stackarchitect.xyz/autocrat-quota-fix/)**: why Autocrat hits the 6-minute and document-creation limits on large sheets, and moving the merge to Make.com.
- **[When to upgrade to Google Workspace](https://stackarchitect.xyz/blog/when-to-upgrade-free-make-google-workspace/)**: which daily quotas Workspace raises, and why it does not change the 6-minute limit per run.
- **[Shopify orders and inventory to Google Sheets](https://stackarchitect.xyz/shopify-google-sheets-automation/)**: writing Shopify data to a sheet without Apps Script triggers.

## Related

- **[shopify-capi-validator](https://github.com/lsb11/shopify-capi-validator)**: validates Meta Conversions API and TikTok Events API payloads locally before they fail silently.

More free guides and tools: [stackarchitect.xyz](https://stackarchitect.xyz/).

## License

MIT © [Stack Architect](https://stackarchitect.xyz/)
