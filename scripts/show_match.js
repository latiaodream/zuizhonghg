#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'fetcher', 'data', 'latest-matches.json');
if (!fs.existsSync(file)) {
  console.error('NOT_FOUND', file);
  process.exit(1);
}
const raw = fs.readFileSync(file, 'utf8');
const j = JSON.parse(raw);
const list = Array.isArray(j.matches) ? j.matches : Array.isArray(j) ? j : [];

const kwLeague = process.argv[2] || '德国甲组';
const kwHome = process.argv[3] || '云达不莱梅';
const kwAway = process.argv[4] || '沃尔夫斯堡';

const found = list.filter(m => String(m.league||'').includes(kwLeague) && String(m.home||'').includes(kwHome) && String(m.away||'').includes(kwAway));
if (!found.length) {
  console.log('NOT_FOUND for', kwLeague, kwHome, kwAway); 
  process.exit(0);
}
const m = found[0];
const out = {
  league: m.league,
  home: m.home,
  away: m.away,
  time: m.time,
  markets: {
    full: {
      handicapLines: (m.markets?.full?.handicapLines || []).slice(0, 8),
      overUnderLines: (m.markets?.full?.overUnderLines || []).slice(0, 8),
    },
    half: {
      moneyline: m.markets?.half?.moneyline,
      handicapLines: (m.markets?.half?.handicapLines || []).slice(0, 8),
      overUnderLines: (m.markets?.half?.overUnderLines || []).slice(0, 8),
    }
  }
};
console.log(JSON.stringify(out, null, 2));

