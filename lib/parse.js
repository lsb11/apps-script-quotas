'use strict';

// Parses Google's "Quotas for Google Services" page into structured data.
// Zero dependencies: the page is two plain HTML tables under stable anchors
// (#current_quotas and #current_limitations).

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };

function decode(s) {
  return s.replace(/&(#?\w+);/g, (m, e) => (e in ENTITIES ? ENTITIES[e] : m));
}

function text(html) {
  return decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

const TIME_SECONDS = { sec: 1, min: 60, hr: 3600 };

// "90 min / day" -> { raw, value: 90, unit: 'min', per: 'day', seconds: 5400, note: false }
function parseLimit(raw) {
  const note = raw.includes('*');
  const clean = raw.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  const parts = clean.split(' / ');
  const amount = parts.shift().trim();
  const per = parts.length ? parts.join(' / ').trim() : null;
  const m = amount.match(/^([\d,.]+)\s*([A-Za-z]+)?$/);
  const out = { raw: clean, value: null, unit: null, per, note };
  if (m) {
    out.value = Number(m[1].replace(/,/g, ''));
    out.unit = m[2] || null;
    if (out.unit && TIME_SECONDS[out.unit]) out.seconds = out.value * TIME_SECONDS[out.unit];
  }
  return out;
}

function slug(s) {
  return s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function tableAfter(html, anchorId) {
  const at = html.search(new RegExp(`id=["']${anchorId}["']`));
  if (at === -1) throw new Error(`Section #${anchorId} not found. Google may have changed the page layout.`);
  const start = html.indexOf('<table', at);
  const end = html.indexOf('</table>', start);
  if (start === -1 || end === -1) throw new Error(`No table found after #${anchorId}.`);
  return html.slice(start, end);
}

function rows(tableHtml) {
  const out = [];
  const trs = tableHtml.match(/<tr[\s\S]*?<\/tr>/g) || [];
  for (const tr of trs) {
    if (/<th[\s>]/.test(tr)) continue; // header row
    const cells = (tr.match(/<td[\s\S]*?<\/td>/g) || []).map(text);
    if (cells.length < 3) continue;
    const feature = cells[0].replace(/\s*\(for example,? [^)]*\)\s*/i, ' ').trim();
    out.push({
      id: slug(feature),
      feature,
      consumer: parseLimit(cells[1]),
      workspace: parseLimit(cells[2]),
    });
  }
  if (!out.length) throw new Error('Table parsed to zero rows. Google may have changed the page layout.');
  return out;
}

function parseQuotasPage(html) {
  const updated = html.match(/Last updated (\d{4}-\d{2}-\d{2})/);
  return {
    googleLastUpdated: updated ? updated[1] : null,
    quotas: rows(tableAfter(html, 'current_quotas')).map((r) => ({ ...r, kind: 'daily' })),
    limitations: rows(tableAfter(html, 'current_limitations')).map((r) => ({ ...r, kind: 'limit' })),
  };
}

module.exports = { parseQuotasPage, parseLimit, slug };
