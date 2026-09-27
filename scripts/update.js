#!/usr/bin/env node
'use strict';

// Fetches Google's Apps Script quotas page, rebuilds data/quotas.json and,
// when any limit has changed, records the change in CHANGELOG.md.
//
//   node scripts/update.js              fetch the live page
//   node scripts/update.js --html FILE  parse a saved copy instead (tests)
//   node scripts/update.js --dry-run    report changes without writing
//
// Prints "changed=true|false" and, in GitHub Actions, writes it to GITHUB_OUTPUT.

const fs = require('fs');
const path = require('path');
const { parseQuotasPage } = require('../lib/parse');

const SOURCE = 'https://developers.google.com/apps-script/guides/services/quotas';
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'quotas.json');
const CHANGELOG = path.join(ROOT, 'CHANGELOG.md');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1] || true;
}

function index(data) {
  const m = new Map();
  for (const r of [...data.quotas, ...data.limitations]) m.set(`${r.kind}:${r.feature}`, r);
  return m;
}

function diff(prev, next) {
  const changes = [];
  const a = index(prev);
  const b = index(next);
  for (const [k, r] of b) {
    const old = a.get(k);
    if (!old) { changes.push(`Added: ${r.feature} (consumer ${r.consumer.raw}, Workspace ${r.workspace.raw})`); continue; }
    for (const acct of ['consumer', 'workspace']) {
      if (old[acct].raw !== r[acct].raw) {
        const label = acct === 'consumer' ? 'consumer' : 'Workspace';
        changes.push(`${r.feature}, ${label}: ${old[acct].raw} to ${r[acct].raw}`);
      }
    }
  }
  for (const [k, r] of a) if (!b.has(k)) changes.push(`Removed: ${r.feature}`);
  return changes;
}

async function main() {
  const htmlFile = arg('--html');
  const dryRun = process.argv.includes('--dry-run');
  const today = new Date().toISOString().slice(0, 10);

  let html;
  if (htmlFile) {
    html = fs.readFileSync(htmlFile, 'utf8');
  } else {
    const res = await fetch(SOURCE, { headers: { 'User-Agent': 'apps-script-quotas tracker (+https://github.com/lsb11/apps-script-quotas)' } });
    if (!res.ok) throw new Error(`Google returned HTTP ${res.status}`);
    html = await res.text();
  }

  const parsed = parseQuotasPage(html);
  // Refuse to overwrite good data with a half-parsed page.
  if (parsed.quotas.length < 10 || parsed.limitations.length < 10) {
    throw new Error(`Parsed only ${parsed.quotas.length} quotas and ${parsed.limitations.length} limitations. Not writing.`);
  }

  const prev = fs.existsSync(DATA) ? JSON.parse(fs.readFileSync(DATA, 'utf8')) : { quotas: [], limitations: [] };
  const changes = diff(prev, parsed);
  const first = !prev.quotas.length;

  const next = {
    source: SOURCE,
    googleLastUpdated: parsed.googleLastUpdated,
    checkedAt: today,
    quotas: parsed.quotas,
    limitations: parsed.limitations,
  };

  const changed = first || changes.length > 0;
  if (changes.length) {
    console.log(`${changes.length} change(s):`);
    for (const c of changes) console.log(`  - ${c}`);
  } else {
    console.log(first ? 'First run: writing baseline.' : 'No limit has changed.');
  }

  if (!dryRun) {
    fs.writeFileSync(DATA, JSON.stringify(next, null, 2) + '\n');
    if (changes.length && !first) {
      const log = fs.existsSync(CHANGELOG) ? fs.readFileSync(CHANGELOG, 'utf8') : '# Changelog\n';
      const entry = `\n## ${today}: Google changed ${changes.length} limit${changes.length > 1 ? 's' : ''}\n\n` +
        changes.map((c) => `- ${c}`).join('\n') +
        `\n\nSource: ${SOURCE} (Google's "last updated" date: ${parsed.googleLastUpdated || 'not shown'})\n`;
      const [head, ...rest] = log.split('\n');
      fs.writeFileSync(CHANGELOG, [head, entry.trimEnd(), ...rest].join('\n') + (log.endsWith('\n') ? '' : '\n'));
    }
  }

  console.log(`changed=${changes.length > 0}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changes.length > 0}\nsummary<<EOF\n${changes.join('\n')}\nEOF\n`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
