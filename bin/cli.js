#!/usr/bin/env node
'use strict';

const q = require('../lib');

const HELP = `apps-script-quotas: Google Apps Script quotas and limits, from Google's own page.

Usage
  apps-script-quotas                        every quota and limitation
  apps-script-quotas get <name>             one limit, e.g. get "url fetch calls"
  apps-script-quotas check [options]        which ceiling a job hits first
  apps-script-quotas explain "<error>"      what an Apps Script error means and how to fix it

Check options
  --rows <n>              items per run (required)
  --calls <n>             service calls per item (required)
  --latency <ms>          average ms per call (default 200; measure yours)
  --runs <n>              trigger runs per day (default 1)
  --fetches <n>           UrlFetch calls per item (default 0)
  --custom-function       it runs from a cell (30-second limit)
  --manual                it is not run by a trigger

Global options
  --workspace             use Google Workspace limits (default: consumer)
  --json                  machine-readable output
  -h, --help              this help

Data checked against Google on ${q.meta.checkedAt} (Google's page last updated ${q.meta.googleLastUpdated}).
Source: ${q.meta.source}`;

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => {
  const i = argv.indexOf(f);
  if (i === -1) return d;
  const n = Number(argv[i + 1]);
  if (Number.isNaN(n)) fail(`${f} needs a number`);
  return n;
};
const json = has('--json');
const account = has('--workspace') ? 'workspace' : 'consumer';
const positional = argv.filter((a, i) => !a.startsWith('-') && !(i > 0 && /^--(rows|calls|latency|runs|fetches)$/.test(argv[i - 1])));

function fail(msg) {
  console.error(`Error: ${msg}\nRun apps-script-quotas --help for usage.`);
  process.exit(2);
}

function out(obj, text) {
  console.log(json ? JSON.stringify(obj, null, 2) : text);
}

function mmss(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function mins(sec) {
  const m = sec / 60;
  return `${Number.isInteger(m) ? m : m.toFixed(1)} min`;
}

function table(rows) {
  const w = rows.reduce((a, r) => Math.max(a, r.feature.length), 0);
  return rows.map((r) => `  ${r.feature.padEnd(w)}  ${r[account].raw}`).join('\n');
}

if (has('-h') || has('--help')) { console.log(HELP); process.exit(0); }

const cmd = positional[0];

if (!cmd || cmd === 'list') {
  const label = account === 'workspace' ? 'Google Workspace' : 'Consumer (gmail.com)';
  out({ meta: q.meta, account, quotas: q.quotas, limitations: q.limitations },
    `${label} accounts\n\nDaily quotas (reset 24 hours after the first request)\n${table(q.quotas)}\n\n` +
    `Limitations\n${table(q.limitations)}\n\nChecked ${q.meta.checkedAt} against ${q.meta.source}`);
} else if (cmd === 'get') {
  const name = positional.slice(1).join(' ');
  if (!name) fail('get needs a name, e.g. get "url fetch calls"');
  const r = q.get(name);
  if (!r) {
    const near = q.search(name.split(' ')[0]);
    fail(`No limit called "${name}".${near.length ? ` Did you mean: ${near.map((x) => x.feature).join(', ')}?` : ''}`);
  }
  out(r, `${r.feature}\n  Consumer:   ${r.consumer.raw}\n  Workspace:  ${r.workspace.raw}` +
    (r.consumer.note || r.workspace.note ? '\n  Google adds a footnote to this row; see the source page.' : ''));
} else if (cmd === 'check') {
  const rows = val('--rows');
  const calls = val('--calls');
  if (rows == null || calls == null) fail('check needs --rows and --calls');
  const e = q.estimate({
    rows, callsPerRow: calls, latencyMs: val('--latency', 200), runsPerDay: val('--runs', 1),
    fetchesPerRow: val('--fetches', 0), account, customFunction: has('--custom-function'), triggered: !has('--manual'),
  });
  const lines = e.ceilings.map((c) => {
    const fmt = c.id === 'triggers-total-runtime' ? mins : mmss;
    const used = c.unit === 'seconds' ? `${fmt(c.used)} of ${fmt(c.limit)}` : `${Math.round(c.used).toLocaleString('en-GB')} of ${c.limit.toLocaleString('en-GB')}`;
    return `  ${c.used > c.limit ? 'OVER' : 'ok  '}  ${c.label.padEnd(34)} ${used}  (${Math.round(c.share * 100)}%)`;
  });
  const verdict = e.fits
    ? `Fits. The closest ceiling is ${e.binding.label.toLowerCase()}, at ${Math.round(e.binding.share * 100)}%.`
    : `Does not fit. It hits ${e.binding.label.toLowerCase()} first.`;
  out(e, `${verdict}\n\n${lines.join('\n')}\n\n  One run fits about ${e.maxRowsPerRun.toLocaleString('en-GB')} items before the per-run limit.\n  ${e.note}\n\n  Fix: ${e.guide}`);
} else if (cmd === 'explain') {
  const msg = positional.slice(1).join(' ');
  if (!msg) fail('explain needs an error message in quotes');
  const e = q.explain(msg, account);
  if (!e) {
    out({ found: false }, `Not a quota error this tool recognises. Google's list of quota exception messages:\n  ${q.meta.source}#exception_messages`);
    process.exit(1);
  }
  const lim = e.limits.length ? `\n\nLimit:\n${e.limits.map((l) => `  ${l.feature}: ${l.value}`).join('\n')}` : '';
  out(e, `Cause: ${e.cause}${lim}\n\nFix: ${e.fix}\n\nGuide: ${e.guide}${e.alsoSee ? `\nAlso: ${e.alsoSee}` : ''}`);
} else {
  fail(`Unknown command "${cmd}"`);
}
