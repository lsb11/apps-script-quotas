'use strict';

const data = require('../data/quotas.json');
const { slug } = require('./parse');

const GUIDES = {
  quotas: 'https://stackarchitect.xyz/blog/google-apps-script-quotas-explained-how-to-avoid-limits-and-scale-your-automations/',
  resumable: 'https://stackarchitect.xyz/blog/google-apps-script-quotas-explained-how-to-avoid-limits-and-scale-your-automations/#resumable',
  customFunctions: 'https://stackarchitect.xyz/blog/google-sheets-custom-function-errors/',
};

const ACCOUNTS = ['consumer', 'workspace'];

function all() {
  return [...data.quotas, ...data.limitations];
}

function checkAccount(account) {
  if (!ACCOUNTS.includes(account)) throw new Error(`account must be "consumer" or "workspace", got "${account}"`);
}

/**
 * Look up one quota or limitation by id or name.
 * get('url-fetch-calls')             -> full record
 * get('URL Fetch calls', 'consumer') -> { raw, value, unit, per, ... }
 */
function get(nameOrId, account) {
  const key = slug(String(nameOrId));
  // Exact id first, then a name containing the query, then the longest id the
  // query starts with (Google's errors say "Email Attachments Per Message" for
  // the row called "Email attachments").
  const row = all().find((r) => r.id === key) ||
    all().find((r) => r.id.includes(key)) ||
    all().filter((r) => key.startsWith(r.id)).sort((a, b) => b.id.length - a.id.length)[0];
  if (!row) return null;
  if (!account) return row;
  checkAccount(account);
  return row[account];
}

function search(term) {
  const key = slug(String(term));
  return all().filter((r) => r.id.includes(key));
}

function limitSeconds(id, account) {
  const v = get(id, account);
  if (!v || v.seconds == null) throw new Error(`No time limit found for ${id}`);
  return v.seconds;
}

/**
 * Which ceiling does a job hit first?
 *
 * estimate({ rows: 500, callsPerRow: 3, latencyMs: 200, runsPerDay: 4 })
 *
 * Options
 *   rows            items processed per run
 *   callsPerRow     service calls per item (getValue, setValue, UrlFetch ...)
 *   latencyMs       average milliseconds per call; measure yours with console.time()
 *   runsPerDay      how many times a trigger runs it per day (default 1)
 *   fetchesPerRow   UrlFetch calls per item (default 0)
 *   account         'consumer' (default) or 'workspace'
 *   customFunction  true if called from a cell, which has a 30-second limit
 *   triggered       false if it only runs manually (daily trigger runtime then does not apply)
 */
function estimate(opts) {
  const o = Object.assign({ runsPerDay: 1, fetchesPerRow: 0, account: 'consumer', customFunction: false, triggered: true }, opts);
  checkAccount(o.account);
  for (const k of ['rows', 'callsPerRow', 'latencyMs']) {
    if (!(typeof o[k] === 'number' && o[k] >= 0)) throw new Error(`${k} must be a number of 0 or more`);
  }

  const perRunSeconds = (o.rows * o.callsPerRow * o.latencyMs) / 1000;
  const runLimitId = o.customFunction ? 'custom-function-runtime' : 'script-runtime';
  const runLimit = limitSeconds(runLimitId, o.account);

  const ceilings = [{
    id: runLimitId,
    label: o.customFunction ? 'Custom function runtime per call' : 'Script runtime per execution',
    used: perRunSeconds,
    limit: runLimit,
    unit: 'seconds',
  }];

  if (o.triggered && !o.customFunction) {
    ceilings.push({
      id: 'triggers-total-runtime',
      label: 'Trigger runtime per day',
      used: perRunSeconds * o.runsPerDay,
      limit: limitSeconds('triggers-total-runtime', o.account),
      unit: 'seconds',
    });
  }

  if (o.fetchesPerRow > 0) {
    ceilings.push({
      id: 'url-fetch-calls',
      label: 'URL Fetch calls per day',
      used: o.rows * o.fetchesPerRow * o.runsPerDay,
      limit: get('url-fetch-calls', o.account).value,
      unit: 'calls',
    });
  }

  for (const c of ceilings) c.share = c.limit ? c.used / c.limit : 0;
  const binding = ceilings.reduce((a, b) => (b.share > a.share ? b : a));
  const perRowMs = o.callsPerRow * o.latencyMs;

  return {
    account: o.account,
    perRunSeconds,
    maxRowsPerRun: perRowMs > 0 ? Math.floor((runLimit * 1000) / perRowMs) : Infinity,
    ceilings,
    binding,
    fits: ceilings.every((c) => c.used <= c.limit),
    guide: o.customFunction ? GUIDES.customFunctions : (binding.id === 'script-runtime' ? GUIDES.resumable : GUIDES.quotas),
    note: 'Latency is the only estimate here. Replace it with a measured figure for your script.',
  };
}

// Exception messages as Google documents them, plus the two custom function
// messages from Google's custom functions guide.
const ERRORS = [
  {
    match: /exceeded maximum execution time/i,
    limit: ['script-runtime', 'custom-function-runtime'],
    cause: 'One execution ran past its time limit: 6 minutes for a normal script, 30 seconds for a custom function called from a cell (the cell shows #ERROR!).',
    fix: 'For scripts, split the job across runs with a resumable batch. For custom functions, process the whole range in one call or move the work to a menu command.',
    guide: GUIDES.resumable,
    alsoSee: GUIDES.customFunctions,
  },
  {
    match: /service invoked too many times in a short time/i,
    limit: [],
    cause: 'A rate limit: the script called one service too often within a short window. Google does not publish the per-minute figure for most services.',
    fix: 'Batch reads and writes (getValues/setValues once), and retry with a growing delay for calls that cannot be batched.',
    guide: GUIDES.quotas,
  },
  {
    match: /service invoked too many times/i,
    limit: [],
    cause: 'A daily quota for the named service is used up. Quotas are per user and reset 24 hours after the first request.',
    fix: 'Reduce calls to that service, spread work across days, or check whether a Workspace account raises that quota.',
    guide: GUIDES.quotas,
  },
  {
    match: /service using too much computer time for one day/i,
    limit: ['triggers-total-runtime'],
    cause: 'Triggered executions used up the daily trigger runtime: 90 minutes on a consumer account, 6 hours on Workspace.',
    fix: 'Make each run shorter, run triggers less often, or move heavy work off Apps Script.',
    guide: GUIDES.quotas,
  },
  {
    match: /script invoked too many times per second/i,
    limit: [],
    cause: 'Too many executions started in a short burst. Google says this most often comes from a custom function repeated down a column.',
    fix: 'Call the custom function once for the whole range and return a two-dimensional array.',
    guide: GUIDES.customFunctions,
  },
  {
    match: /too many scripts running simultaneously/i,
    limit: ['simultaneous-executions-per-user'],
    cause: 'More than 30 executions were running at once for this user, usually many custom function cells recalculating together.',
    fix: 'Replace per-cell formulas with one range formula, or offset triggers so they do not overlap.',
    guide: GUIDES.customFunctions,
  },
  {
    match: /you do not have permission to call/i,
    limit: [],
    cause: 'A custom function used a service that needs authorisation. Custom functions cannot ask for it.',
    fix: 'Run that code from a custom menu instead, which can ask for authorisation.',
    guide: GUIDES.customFunctions,
  },
  {
    match: /too many triggers/i,
    limit: ['triggers'],
    cause: 'The script has reached 20 triggers for this user. A common cause is creating one-shot triggers without deleting the ones that already fired.',
    fix: 'Delete your own triggers with ScriptApp.deleteTrigger before creating the next one.',
    guide: GUIDES.resumable,
  },
  {
    match: /limit exceeded/i,
    limit: [],
    cause: 'A named quota or limitation was exceeded. The text after "Limit exceeded:" names it.',
    fix: 'Look the named limit up (apps-script-quotas get "<name>") and reduce usage below it.',
    guide: GUIDES.quotas,
  },
];

/** Explain an Apps Script error message: which limit, why, and what to do. */
function explain(message, account = 'consumer') {
  checkAccount(account);
  const hit = ERRORS.find((e) => e.match.test(String(message)));
  if (!hit) return null;
  const limits = hit.limit.map((id) => {
    const r = get(id);
    return r ? { id, feature: r.feature, value: r[account].raw } : null;
  }).filter(Boolean);
  const named = String(message).match(/Limit exceeded:\s*([^.]+)/i) || String(message).match(/too many times(?: for one day)?:\s*([^.]+)/i);
  const out = { cause: hit.cause, fix: hit.fix, limits, guide: hit.guide };
  if (hit.alsoSee) out.alsoSee = hit.alsoSee;
  if (named) {
    out.named = named[1].trim();
    const r = get(out.named);
    if (r) out.limits.push({ id: r.id, feature: r.feature, value: r[account].raw });
  }
  return out;
}

module.exports = {
  meta: { source: data.source, googleLastUpdated: data.googleLastUpdated, checkedAt: data.checkedAt },
  quotas: data.quotas,
  limitations: data.limitations,
  all,
  get,
  search,
  estimate,
  explain,
  GUIDES,
};
