// 테스트용: 네트워크 대신 가짜 Yahoo 시세를 돌려줍니다.
// MOCK_BARS 환경변수: [{"date":"2026-09-01","close":70,"high":71}, ...]
const bars = JSON.parse(process.env.MOCK_BARS || '[]');
globalThis.__sent = [];
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('api.telegram.org')) {
    console.log('[mock telegram]', JSON.parse(opts.body).text.slice(0, 80));
    return new Response('{"ok":true}', { status: 200 });
  }
  if (u.includes('yahoo')) {
    const ts = bars.map((b) => Date.parse(b.date + 'T20:00:00Z') / 1000);
    const body = { chart: { result: [{ timestamp: ts, indicators: { quote: [{ close: bars.map((b) => b.close), high: bars.map((b) => b.high) }] } }] } };
    return new Response(JSON.stringify(body), { status: 200 });
  }
  return new Response('blocked', { status: 403 });
};
