const http = require('http');
const fs = require('fs');
const url = `http://localhost:3001/api/crown-automation/matches-system?gtype=ft&showtype=today&_t=${Date.now()}`;
http.get(url, { headers: { 'Cache-Control': 'no-cache' } }, (res) => {
  let data = '';
  res.on('data', (chunk) => (data += chunk));
  res.on('end', () => {
    try {
      fs.writeFileSync('out.json', data);
      const json = JSON.parse(data);
      const m = (json.matches || []).find((x) => x && x.markets && x.markets.half && x.markets.half.moneyline && (x.markets.half.moneyline.home || x.markets.half.moneyline.draw || x.markets.half.moneyline.away));
      if (!m) {
        console.error('NO_HALF_ML');
        process.exitCode = 2;
        return;
      }
      const { homeTeam, awayTeam } = m;
      const ml = m.markets.half.moneyline;
      const hh = (m.markets.half.handicapLines || []).slice(0, 2);
      const hou = (m.markets.half.overUnderLines || []).slice(0, 2);
      const result = { homeTeam, awayTeam, halfMoneyline: ml, halfHandicapSamples: hh, halfOuSamples: hou };
      console.log(JSON.stringify(result, null, 2));
    } catch (e) {
      console.error('PARSE_ERR', e.message);
      console.error(data.slice(0, 300));
      process.exitCode = 1;
    }
  });
}).on('error', (e) => {
  console.error('HTTP_ERR', e.message);
  process.exitCode = 1;
});

