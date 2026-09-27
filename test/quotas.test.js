'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const q = require('../lib');
const { parseQuotasPage, parseLimit } = require('../lib/parse');

const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'quotas-2026-09-26.html');
const CLI = path.join(ROOT, 'bin', 'cli.js');

test('parseLimit handles every value shape on Google\'s page', () => {
  assert.deepEqual(parseLimit('90 min / day'), { raw: '90 min / day', value: 90, unit: 'min', per: 'day', note: false, seconds: 5400 });
  assert.equal(parseLimit('6 hr / day').seconds, 21600);
  assert.equal(parseLimit('30 sec / execution').seconds, 30);
  assert.equal(parseLimit('20,000 / day').value, 20000);
  assert.equal(parseLimit('1,000').per, null);
  assert.equal(parseLimit('20 / user / script').per, 'user / script');
  assert.equal(parseLimit('100* / day').note, true);
  assert.equal(parseLimit('100* / day').raw, '100 / day');
});

test('parses both tables from the page', () => {
  const p = parseQuotasPage(fs.readFileSync(FIXTURE, 'utf8'));
  assert.equal(p.quotas.length, 22);
  assert.equal(p.limitations.length, 18);
  assert.equal(p.googleLastUpdated, '2026-09-03');
  const email = p.quotas.find((r) => r.id === 'email-recipients-per-day');
  assert.equal(email.feature, 'Email recipients per day');
  assert.equal(email.consumer.value, 100);
  assert.equal(email.consumer.note, true);
});

test('throws instead of guessing when the layout changes', () => {
  assert.throws(() => parseQuotasPage('<html><h2 id="other">x</h2></html>'), /not found/);
});

test('shipped data matches Google\'s published figures', () => {
  assert.equal(q.get('script-runtime', 'consumer').seconds, 360);
  assert.equal(q.get('script-runtime', 'workspace').seconds, 360);
  assert.equal(q.get('custom-function-runtime', 'consumer').seconds, 30);
  assert.equal(q.get('triggers-total-runtime', 'consumer').seconds, 5400);
  assert.equal(q.get('triggers-total-runtime', 'workspace').seconds, 21600);
  assert.equal(q.get('url-fetch-calls', 'consumer').value, 20000);
  assert.equal(q.get('url-fetch-calls', 'workspace').value, 100000);
  assert.equal(q.get('triggers', 'consumer').value, 20);
  assert.equal(q.get('simultaneous-executions-per-user', 'consumer').value, 30);
});

test('get accepts names as well as ids', () => {
  assert.equal(q.get('URL Fetch calls').id, 'url-fetch-calls');
  assert.equal(q.get('nonexistent limit'), null);
  assert.throws(() => q.get('url-fetch-calls', 'gmail'), /account/);
});

test('estimate reproduces the worked example on the quotas guide', () => {
  const e = q.estimate({ rows: 500, callsPerRow: 3, latencyMs: 200, runsPerDay: 4, fetchesPerRow: 3 });
  assert.equal(e.perRunSeconds, 300);
  assert.equal(e.maxRowsPerRun, 600);
  assert.equal(e.binding.id, 'script-runtime');
  assert.equal(Math.round(e.binding.share * 100), 83);
  assert.equal(e.ceilings.find((c) => c.id === 'triggers-total-runtime').used, 1200);
  assert.equal(e.ceilings.find((c) => c.id === 'url-fetch-calls').used, 6000);
  assert.equal(e.fits, true);
});

test('estimate finds the daily ceiling when it binds first', () => {
  const e = q.estimate({ rows: 500, callsPerRow: 3, latencyMs: 200, runsPerDay: 24 });
  assert.equal(e.binding.id, 'triggers-total-runtime');
  assert.equal(e.fits, false);
  assert.equal(q.estimate({ rows: 500, callsPerRow: 3, latencyMs: 200, runsPerDay: 24, account: 'workspace' }).fits, true);
});

test('estimate uses the 30-second limit for custom functions', () => {
  const e = q.estimate({ rows: 800, callsPerRow: 1, latencyMs: 150, customFunction: true });
  assert.equal(e.binding.id, 'custom-function-runtime');
  assert.equal(e.maxRowsPerRun, 200);
  assert.equal(e.fits, false);
  assert.equal(e.guide, q.GUIDES.customFunctions);
});

test('estimate rejects bad input', () => {
  assert.throws(() => q.estimate({ rows: 'x', callsPerRow: 1, latencyMs: 1 }), /rows/);
});

test('explain maps Google\'s exception messages', () => {
  assert.deepEqual(q.explain('Service using too much computer time for one day').limits.map((l) => l.value), ['90 min / day']);
  assert.equal(q.explain('Service using too much computer time for one day', 'workspace').limits[0].value, '6 hr / day');
  assert.match(q.explain('Service invoked too many times in a short time: Calendar. Try Utilities.sleep(1000) between calls.').cause, /rate limit/);
  assert.match(q.explain('Service invoked too many times: Calendar.').cause, /daily quota/);
  assert.equal(q.explain('There are too many scripts running simultaneously for this Google user account.').limits[0].value, '30 / user');
  assert.equal(q.explain('Exceeded maximum execution time (line 0).').alsoSee, q.GUIDES.customFunctions);
  assert.equal(q.explain('Limit exceeded: Email Attachments Per Message.').limits[0].value, '250 / msg');
  assert.equal(q.explain('Something unrelated'), null);
});

test('CLI: list, get, check, explain and --json', () => {
  assert.match(execFileSync('node', [CLI]).toString(), /Triggers total runtime\s+90 min \/ day/);
  assert.match(execFileSync('node', [CLI, '--workspace']).toString(), /Triggers total runtime\s+6 hr \/ day/);
  assert.match(execFileSync('node', [CLI, 'get', 'url', 'fetch', 'calls']).toString(), /Workspace:\s+100,000 \/ day/);
  const check = JSON.parse(execFileSync('node', [CLI, 'check', '--rows', '500', '--calls', '3', '--runs', '4', '--json']).toString());
  assert.equal(check.maxRowsPerRun, 600);
  assert.match(execFileSync('node', [CLI, 'explain', 'This script has too many triggers.']).toString(), /20 \/ user \/ script/);
  assert.equal(spawnSync('node', [CLI, 'explain', 'nothing to see']).status, 1);
  assert.equal(spawnSync('node', [CLI, 'check', '--rows', '10']).status, 2);
});

test('update script writes a changelog entry only when a limit changes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asq-'));
  for (const d of ['lib', 'scripts', 'data']) fs.mkdirSync(path.join(dir, d));
  fs.copyFileSync(path.join(ROOT, 'lib', 'parse.js'), path.join(dir, 'lib', 'parse.js'));
  fs.copyFileSync(path.join(ROOT, 'scripts', 'update.js'), path.join(dir, 'scripts', 'update.js'));
  fs.copyFileSync(path.join(ROOT, 'data', 'quotas.json'), path.join(dir, 'data', 'quotas.json'));
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), '# Changelog\n');
  const run = (html) => execFileSync('node', [path.join(dir, 'scripts', 'update.js'), '--html', html], { env: { ...process.env, GITHUB_OUTPUT: '' } }).toString();

  assert.match(run(FIXTURE), /changed=false/);
  assert.equal(fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8'), '# Changelog\n');

  const changed = path.join(dir, 'changed.html');
  fs.writeFileSync(changed, fs.readFileSync(FIXTURE, 'utf8').replace('<td>90 min / day</td>', '<td>60 min / day</td>'));
  assert.match(run(changed), /Triggers total runtime, consumer: 90 min \/ day to 60 min \/ day/);
  const log = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
  assert.match(log, /Google changed 1 limit\n/);
  assert.match(log, /- Triggers total runtime, consumer: 90 min \/ day to 60 min \/ day/);
});
