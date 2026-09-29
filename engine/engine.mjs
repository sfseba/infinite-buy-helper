// 무한매수 도우미 - 계산 엔진
// 웹 계산기(브라우저)와 알림 봇(Node)이 같은 파일을 씁니다.
// 외부 라이브러리 없이 순수 함수로만 작성했습니다.
//
// 규칙 출처: 공개된 V4.0 일반모드 요약 (README의 '규칙 안내' 참고).
// 공식 규칙은 라오어 무한매수법 카페에서 직접 확인하세요.

export const TICKERS = {
  TQQQ: { base: 15, target: 15 },
  SOXL: { base: 20, target: 20 },
};
export const SPLITS = [20, 30, 40];
export const STATE_VERSION = 1;

export const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const r4 = (x) => Math.round((x + Number.EPSILON) * 10000) / 10000;
const clone = (o) => JSON.parse(JSON.stringify(o));

/** 새 포지션(종목 하나의 사이클 장부)을 만듭니다. seed는 달러 금액입니다. */
export function newPosition({ ticker = 'TQQQ', splits = 20, seed = 1600, id } = {}) {
  if (!TICKERS[ticker]) throw new Error(`지원하지 않는 종목: ${ticker}`);
  if (!SPLITS.includes(Number(splits))) throw new Error(`분할 수는 ${SPLITS.join('/')} 중 하나여야 해요`);
  if (!(seed > 0)) throw new Error('원금(달러)은 0보다 커야 해요');
  return {
    id: id || `${ticker}-${Date.now().toString(36)}`,
    ticker,
    splits: Number(splits),
    seed: r2(seed),
    cash: r2(seed),
    qty: 0,
    avg: 0,
    T: 0,
    cycleNo: 1,
    cycleStart: null,
    cycleSeed: r2(seed),
    lastProcessed: null,
    refClose: null,
    pending: null,
    cycles: [],
    log: [],
  };
}

export function emptyState() {
  return { version: STATE_VERSION, positions: [], updatedAt: null };
}

/** 별% (예: 20분할 TQQQ = 15 − 1.5T) */
export function starPct(pos) {
  const { base } = TICKERS[pos.ticker];
  return base - ((2 * base) / pos.splits) * pos.T;
}

/** 현재 구간: first(첫 매수) / front(전반전) / back(후반전) / reverse(소진) */
export function phaseOf(pos) {
  if (pos.qty <= 0) return 'first';
  if (pos.T > pos.splits - 1) return 'reverse';
  return pos.T < pos.splits / 2 ? 'front' : 'back';
}

export const PHASE_LABEL = { first: '첫 매수', front: '전반전', back: '후반전', reverse: '소진 구간' };

/**
 * 오늘 넣을 주문을 계산합니다.
 * refClose: 직전 거래일 종가 (첫 매수 수량 계산에 사용)
 * 반환: { phase, unit, starPct, starPoint, orders[], notes[] }
 *   order = { side:'buy'|'sell', kind, type:'LOC'|'LIMIT', price, qty, tInc, label }
 *   note  = { level:'info'|'warn'|'danger', text }
 */
export function buildOrders(pos, refClose) {
  const { base, target } = TICKERS[pos.ticker];
  const phase = phaseOf(pos);
  const left = pos.splits - pos.T;
  const unit = left > 0 ? pos.cash / left : 0;
  const sp = starPct(pos);
  const star = r2(pos.avg * (1 + sp / 100));
  const orders = [];
  const notes = [];

  if (phase === 'reverse') {
    notes.push({
      level: 'danger',
      text: `T가 ${pos.splits - 1}을 넘어 소진 구간(리버스모드)에 들어왔어요. 이 도구는 리버스모드 주문을 계산하지 않아요. 공식 규칙을 확인하고 직접 진행하세요.`,
    });
    return { phase, unit, starPct: sp, starPoint: star, orders, notes };
  }

  if (phase === 'first') {
    if (!(refClose > 0)) {
      notes.push({ level: 'warn', text: '첫 매수 수량을 계산하려면 직전 종가가 필요해요.' });
    } else {
      const qty = Math.floor(unit / refClose);
      orders.push({
        side: 'buy', kind: 'first', type: 'LOC', price: r2(refClose * (1 + base / 100)), qty, tInc: 1,
        label: `첫 매수 · 직전 종가 +${base}% LOC (사실상 종가 매수)`,
      });
      if (qty < 1) notes.push({ level: 'warn', text: `1회 매수금 $${r2(unit)}로는 1주를 살 수 없어요. 원금을 늘리거나 분할 수를 줄이세요.` });
    }
    return finish();
  }

  // 매수
  const starBuy = r2(star - 0.01);
  if (phase === 'front') {
    const half = unit / 2;
    const qa = Math.floor(half / pos.avg);
    const qs = Math.floor(half / starBuy);
    if (qa >= 1 && qs >= 1) {
      orders.push({ side: 'buy', kind: 'avg', type: 'LOC', price: r2(pos.avg), qty: qa, tInc: 0.5, label: '평단 매수 · 1회 매수금의 절반' });
      orders.push({ side: 'buy', kind: 'star', type: 'LOC', price: starBuy, qty: qs, tInc: 0.5, label: '별지점 매수 · 1회 매수금의 절반 (별지점 − $0.01)' });
    } else {
      const q = Math.floor(unit / pos.avg);
      if (q >= 1) {
        orders.push({ side: 'buy', kind: 'avg', type: 'LOC', price: r2(pos.avg), qty: q, tInc: 1, label: '평단 매수 · 1회 매수금 전부 (소액 보정)' });
        notes.push({ level: 'info', text: '절반 금액으로는 1주를 살 수 없어서 1회 매수금을 평단 LOC 한 건으로 모았어요. 원래 규칙과 조금 달라요.' });
      } else {
        notes.push({ level: 'warn', text: `1회 매수금 $${r2(unit)}로는 1주를 살 수 없어요. 오늘은 매수 주문이 없어요.` });
      }
    }
  } else {
    const q = Math.floor(unit / starBuy);
    if (q >= 1) orders.push({ side: 'buy', kind: 'star', type: 'LOC', price: starBuy, qty: q, tInc: 1, label: '별지점 매수 · 후반전, 1회 매수금 전부' });
    else notes.push({ level: 'warn', text: `1회 매수금 $${r2(unit)}로는 1주를 살 수 없어요. 오늘은 매수 주문이 없어요.` });
  }

  // 매도
  const qq = Math.floor(pos.qty / 4);
  if (qq > 0) {
    orders.push({ side: 'sell', kind: 'quarter', type: 'LOC', price: star, qty: qq, tInc: 0, label: '쿼터 매도 · 보유의 1/4, 별지점' });
  } else {
    notes.push({ level: 'info', text: '보유 수량이 4주 미만이라 쿼터 매도는 건너뛰어요.' });
  }
  orders.push({
    side: 'sell', kind: 'target', type: 'LIMIT', price: r2(pos.avg * (1 + target / 100)), qty: pos.qty - qq, tInc: 0,
    label: `목표가 매도 · 나머지 전부, 평단 +${target}%`,
  });
  return finish();

  function finish() {
    return { phase, unit: r2(unit), starPct: r4(sp), starPoint: phase === 'first' ? null : star, orders: orders.filter((o) => o.qty > 0), notes };
  }
}

/**
 * 하루치 시세(종가·고가)로 주문 체결 여부를 판정합니다.
 * LOC 매수: 종가 ≤ 주문가면 종가에 체결 / LOC 매도: 종가 ≥ 주문가면 종가에 체결
 * 지정가 매도: 고가 ≥ 주문가면 주문가에 체결
 * 실제 체결은 증권사 앱에서 꼭 확인하세요. 이 함수는 추정입니다.
 */
export function detectFills(orders, bar) {
  return orders.map((o) => {
    let filled = false;
    let fillPrice = null;
    if (o.type === 'LOC' && o.side === 'buy') { filled = bar.close <= o.price; fillPrice = bar.close; }
    else if (o.type === 'LOC' && o.side === 'sell') { filled = bar.close >= o.price; fillPrice = bar.close; }
    else if (o.type === 'LIMIT' && o.side === 'sell') { filled = bar.high != null && bar.high >= o.price; fillPrice = o.price; }
    return { ...o, filled, fillQty: filled ? o.qty : 0, fillPrice: r2(fillPrice) };
  });
}

/**
 * 체결 결과를 장부에 반영합니다. (원본은 바꾸지 않고 새 객체를 돌려줍니다)
 * fills: detectFills 결과 또는 사용자가 직접 체크한 주문 목록 (filled, fillQty, fillPrice)
 * 반환: { pos, events[] }
 */
export function applyFills(pos0, fills, date) {
  const pos = clone(pos0);
  const events = [];
  const done = fills.filter((f) => f.filled && f.fillQty > 0 && f.fillPrice > 0);

  // 매도 먼저
  for (const f of done.filter((x) => x.side === 'sell')) {
    const q = Math.min(f.fillQty, pos.qty);
    if (q <= 0) continue;
    const pnl = (f.fillPrice - pos.avg) * q;
    pos.qty -= q;
    pos.cash = r2(pos.cash + q * f.fillPrice);
    if (f.kind === 'quarter') pos.T = r4(pos.T * 0.75);
    events.push({ type: 'sell', kind: f.kind, qty: q, price: f.fillPrice, pnl: r2(pnl) });
  }
  if (pos.qty === 0 && events.some((e) => e.type === 'sell')) {
    const profit = r2(pos.cash - pos.cycleSeed);
    const cycle = {
      no: pos.cycleNo, start: pos.cycleStart, end: date,
      startCash: pos.cycleSeed, endCash: pos.cash, profit,
      pct: pos.cycleSeed > 0 ? r4((profit / pos.cycleSeed) * 100) : 0,
    };
    pos.cycles.push(cycle);
    events.push({ type: 'cycleEnd', cycle });
    pos.T = 0; pos.avg = 0; pos.cycleNo += 1; pos.cycleStart = null; pos.cycleSeed = pos.cash;
  }

  // 매수
  for (const f of done.filter((x) => x.side === 'buy')) {
    let q = f.fillQty;
    if (q * f.fillPrice > pos.cash + 0.005) {
      q = Math.floor(pos.cash / f.fillPrice);
      events.push({ type: 'note', text: `현금이 부족해 ${f.fillQty}주 중 ${q}주만 반영했어요.` });
    }
    if (q <= 0) continue;
    const newQty = pos.qty + q;
    pos.avg = r4((pos.avg * pos.qty + q * f.fillPrice) / newQty);
    pos.qty = newQty;
    pos.cash = r2(pos.cash - q * f.fillPrice);
    const inc = f.qty > 0 ? f.tInc * (q / f.qty) : 0;
    pos.T = r4(pos.T + inc);
    if (!pos.cycleStart) pos.cycleStart = date;
    events.push({ type: 'buy', kind: f.kind, qty: q, price: f.fillPrice, tInc: r4(inc) });
  }

  pos.lastProcessed = date;
  pos.log = [...(pos.log || []), { date, events }].slice(-120);
  return { pos, events };
}

/** 오늘 주문을 새로 계산해 pending에 저장합니다. */
export function refreshPending(pos0, refClose, basedOn) {
  const pos = clone(pos0);
  if (refClose > 0) pos.refClose = r2(refClose);
  const plan = buildOrders(pos, pos.refClose);
  pos.pending = { basedOn: basedOn || pos.lastProcessed || null, ...plan };
  return pos;
}

/** 하루치 시세로 [체결 판정 → 반영 → 다음 주문 계산]을 한 번에 합니다. (봇이 사용) */
export function stepDay(pos0, bar) {
  let pos = clone(pos0);
  let events = [];
  if (pos.pending && pos.pending.orders && pos.pending.orders.length) {
    const fills = detectFills(pos.pending.orders, bar);
    ({ pos, events } = applyFills(pos, fills, bar.date));
  } else {
    pos.lastProcessed = bar.date;
  }
  pos = refreshPending(pos, bar.close, bar.date);
  return { pos, events };
}

/**
 * 증권사 잔고와 장부를 대조합니다. 빈 값은 비교하지 않습니다.
 * 반환: { ok, diffs: [{ field, label, book, broker }] }
 */
export function reconcile(pos, broker) {
  const diffs = [];
  const check = (field, label, tol) => {
    const b = broker[field];
    if (b === '' || b == null || !isFinite(b)) return;
    if (Math.abs(Number(b) - pos[field]) > tol) diffs.push({ field, label, book: pos[field], broker: Number(b) });
  };
  check('qty', '보유 수량', 0.0001);
  check('avg', '평단', 0.05);
  check('cash', '남은 현금', 1);
  return { ok: diffs.length === 0, diffs };
}

/** 증권사 값으로 장부를 맞춥니다. T는 그대로 둡니다. */
export function adoptBroker(pos0, broker) {
  const pos = clone(pos0);
  for (const f of ['qty', 'avg', 'cash']) {
    const v = broker[f];
    if (v !== '' && v != null && isFinite(v)) pos[f] = f === 'qty' ? Math.floor(Number(v)) : Number(v);
  }
  pos.log = [...(pos.log || []), { date: new Date().toISOString().slice(0, 10), events: [{ type: 'note', text: '증권사 잔고 값으로 장부를 맞췄어요.' }] }].slice(-120);
  return pos;
}

/** 저장 파일(state.json)이 올바른 모양인지 확인합니다. */
export function validateState(s) {
  const errs = [];
  if (!s || typeof s !== 'object') return ['JSON 객체가 아니에요'];
  if (!Array.isArray(s.positions)) errs.push('positions 배열이 없어요');
  else s.positions.forEach((p, i) => {
    if (!TICKERS[p.ticker]) errs.push(`positions[${i}].ticker 값이 잘못됐어요`);
    if (!SPLITS.includes(p.splits)) errs.push(`positions[${i}].splits 값이 잘못됐어요`);
    for (const f of ['cash', 'qty', 'avg', 'T']) if (typeof p[f] !== 'number' || !isFinite(p[f])) errs.push(`positions[${i}].${f} 값이 숫자가 아니에요`);
  });
  return errs;
}
