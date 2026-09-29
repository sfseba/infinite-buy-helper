// 일봉 시세 가져오기: Yahoo Finance → 실패하면 Stooq로 한 번 더 시도합니다.
// 둘 다 무료·비공식 경로라 가끔 막히거나 형식이 바뀔 수 있어요. 실패하면 봇이 텔레그램으로 알려줍니다.

const UA = 'Mozilla/5.0 (infinite-buy-helper; +https://github.com)';

function nyDate(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}
function nyClock(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(now));
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h * 60 + m;
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${url})`);
  return res.text();
}

async function fromYahoo(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1mo&interval=1d`;
  const j = JSON.parse(await getText(url));
  const r = j?.chart?.result?.[0];
  if (!r || !r.timestamp) throw new Error(`Yahoo 응답 형식이 달라요 (${ticker})`);
  const q = r.indicators.quote[0];
  return r.timestamp.map((t, i) => ({ date: nyDate(t * 1000), close: q.close[i], high: q.high[i] }))
    .filter((b) => b.close != null && b.high != null);
}

async function fromStooq(ticker) {
  const url = `https://stooq.com/q/d/l/?s=${ticker.toLowerCase()}.us&i=d`;
  const lines = (await getText(url)).trim().split(/\r?\n/);
  if (!/^Date,Open,High,Low,Close/i.test(lines[0] || '')) throw new Error(`Stooq 응답 형식이 달라요 (${ticker})`);
  return lines.slice(-30).map((l) => {
    const [date, , high, , close] = l.split(',');
    return { date, close: Number(close), high: Number(high) };
  }).filter((b) => b.close > 0 && b.high > 0);
}

/** 장이 끝난(완성된) 일봉만 날짜순으로 돌려줍니다. */
export async function fetchBars(ticker, { now = Date.now() } = {}) {
  const errors = [];
  let bars = null;
  for (const src of [fromYahoo, fromStooq]) {
    try { bars = await src(ticker); if (bars.length) break; } catch (e) { errors.push(e.message); }
  }
  if (!bars || !bars.length) throw new Error(`${ticker} 시세를 못 가져왔어요: ${errors.join(' / ')}`);

  const today = nyDate(now);
  const closed = nyClock(now) >= 16 * 60 + 30; // 뉴욕 16:30 이후면 오늘 봉도 완성으로 봅니다
  bars = bars.filter((b) => b.date < today || (b.date === today && closed));
  bars.sort((a, b) => (a.date < b.date ? -1 : 1));

  // 기본 점검: 값이 이상하면 멈춥니다
  for (const b of bars) {
    if (!(b.close > 0) || !(b.high >= b.close * 0.999)) throw new Error(`${ticker} ${b.date} 시세 값이 이상해요 (종가 ${b.close}, 고가 ${b.high})`);
  }
  const last = bars[bars.length - 1];
  const ageDays = (Date.parse(today) - Date.parse(last.date)) / 86400000;
  if (ageDays > 6) throw new Error(`${ticker} 최신 시세가 ${last.date}로 너무 오래됐어요. 데이터 소스를 확인하세요.`);
  return bars.map((b) => ({ ...b, close: Math.round(b.close * 100) / 100, high: Math.round(b.high * 100) / 100 }));
}
