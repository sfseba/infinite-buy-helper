import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newPosition, starPct, buildOrders, detectFills, applyFills, stepDay, reconcile, refreshPending, validateState,
} from '../engine/engine.mjs';

test('별% 공식', () => {
  const p = newPosition({ ticker: 'TQQQ', splits: 20, seed: 4000 });
  p.T = 4; assert.equal(starPct(p), 9);          // 15 - 1.5*4
  p.splits = 40; assert.equal(starPct(p), 12);   // 15 - 0.75*4
  const s = newPosition({ ticker: 'SOXL', splits: 20, seed: 4000 });
  s.T = 3; assert.equal(starPct(s), 14);         // 20 - 2*3
  s.splits = 40; assert.equal(starPct(s), 17);   // 20 - 3
});

test('첫 매수: 직전 종가 +15% LOC, 1회 매수금으로 수량 계산', () => {
  const p = newPosition({ ticker: 'TQQQ', splits: 20, seed: 4000 });
  const plan = buildOrders(p, 77.41);
  assert.equal(plan.phase, 'first');
  assert.equal(plan.unit, 200);
  assert.equal(plan.orders.length, 1);
  assert.equal(plan.orders[0].price, 89.02);
  assert.equal(plan.orders[0].qty, 2);
});

test('전반전: 평단 LOC + 별지점 LOC, 쿼터 매도 + 목표가 매도', () => {
  const p = { ...newPosition({ ticker: 'TQQQ', splits: 20, seed: 4000 }), T: 4, qty: 10, avg: 70, cash: 3200 };
  const plan = buildOrders(p, 70);
  assert.equal(plan.phase, 'front');
  assert.equal(plan.unit, 200);          // 3200 / (20-4)
  assert.equal(plan.starPoint, 76.3);    // 70 * 1.09
  const [a, s, q, t] = plan.orders;
  assert.deepEqual([a.kind, a.price, a.qty], ['avg', 70, 1]);
  assert.deepEqual([s.kind, s.price, s.qty], ['star', 76.29, 1]);
  assert.deepEqual([q.kind, q.price, q.qty], ['quarter', 76.3, 2]);
  assert.deepEqual([t.kind, t.price, t.qty], ['target', 80.5, 8]);
});

test('후반전: 별지점이 평단 아래, 1회 매수금 전부', () => {
  const p = { ...newPosition({ ticker: 'TQQQ', splits: 20, seed: 4000 }), T: 12, qty: 40, avg: 60, cash: 1600 };
  const plan = buildOrders(p, 55);
  assert.equal(plan.phase, 'back');
  assert.equal(plan.starPoint, 58.2);    // 60 * (1 - 3%)
  assert.equal(plan.orders.filter((o) => o.side === 'buy').length, 1);
  assert.equal(plan.orders[0].qty, Math.floor(200 / 58.19));
});

test('소액 보정: 절반으로 1주 못 사면 평단 LOC 한 건으로', () => {
  const p = { ...newPosition({ ticker: 'TQQQ', splits: 20, seed: 1600 }), T: 2, qty: 2, avg: 77, cash: 1440 };
  const plan = buildOrders(p, 77);
  const buys = plan.orders.filter((o) => o.side === 'buy');
  assert.equal(buys.length, 1);
  assert.equal(buys[0].tInc, 1);
  assert.ok(plan.notes.some((n) => n.level === 'info'));
});

test('소진 구간이면 주문 없이 경고', () => {
  const p = { ...newPosition({ ticker: 'TQQQ', splits: 20, seed: 4000 }), T: 19.5, qty: 60, avg: 60, cash: 50 };
  const plan = buildOrders(p, 50);
  assert.equal(plan.phase, 'reverse');
  assert.equal(plan.orders.length, 0);
  assert.equal(plan.notes[0].level, 'danger');
});

test('체결 판정: LOC는 종가, 지정가는 고가 기준', () => {
  const orders = [
    { side: 'buy', type: 'LOC', price: 70, qty: 1 },
    { side: 'sell', type: 'LOC', price: 76.3, qty: 2 },
    { side: 'sell', type: 'LIMIT', price: 80.5, qty: 8 },
  ];
  const f = detectFills(orders, { close: 69.5, high: 81 });
  assert.deepEqual(f.map((x) => x.filled), [true, false, true]);
  assert.equal(f[0].fillPrice, 69.5);
  assert.equal(f[2].fillPrice, 80.5);
});

test('매수 반영: 평단·T·현금', () => {
  const p = { ...newPosition({ ticker: 'TQQQ', splits: 20, seed: 4000 }), T: 1, qty: 2, avg: 75, cash: 3850, cycleStart: '2026-09-01' };
  const fills = [
    { side: 'buy', kind: 'avg', type: 'LOC', qty: 1, tInc: 0.5, filled: true, fillQty: 1, fillPrice: 72 },
    { side: 'buy', kind: 'star', type: 'LOC', qty: 1, tInc: 0.5, filled: true, fillQty: 1, fillPrice: 72 },
  ];
  const { pos } = applyFills(p, fills, '2026-09-02');
  assert.equal(pos.qty, 4);
  assert.equal(pos.avg, 73.5);
  assert.equal(pos.T, 2);
  assert.equal(pos.cash, 3706);
});

test('쿼터 매도는 T × 0.75, 전량 매도면 사이클 종료', () => {
  const p = { ...newPosition({ ticker: 'TQQQ', splits: 20, seed: 4000 }), T: 8, qty: 20, avg: 70, cash: 2600, cycleStart: '2026-09-01' };
  let r = applyFills(p, [{ side: 'sell', kind: 'quarter', type: 'LOC', qty: 5, filled: true, fillQty: 5, fillPrice: 72 }], '2026-09-10');
  assert.equal(r.pos.T, 6);
  assert.equal(r.pos.qty, 15);
  r = applyFills(r.pos, [{ side: 'sell', kind: 'target', type: 'LIMIT', qty: 15, filled: true, fillQty: 15, fillPrice: 80.5 }], '2026-09-12');
  assert.equal(r.pos.qty, 0);
  assert.equal(r.pos.T, 0);
  assert.equal(r.pos.cycleNo, 2);
  assert.equal(r.pos.cycles.length, 1);
  assert.equal(r.pos.cycles[0].profit, r.pos.cash - 4000);
  assert.ok(r.events.some((e) => e.type === 'cycleEnd'));
});

test('stepDay: 사이클 한 바퀴 시뮬레이션', () => {
  let p = refreshPending(newPosition({ ticker: 'TQQQ', splits: 20, seed: 4000 }), 70, '2026-09-01');
  const bars = [
    { date: '2026-09-02', close: 70, high: 71 },
    { date: '2026-09-03', close: 66, high: 70 },
    { date: '2026-09-04', close: 64, high: 67 },
    { date: '2026-09-07', close: 72, high: 73 },
    { date: '2026-09-08', close: 78, high: 80 },
  ];
  for (const b of bars) ({ pos: p } = stepDay(p, b));
  assert.equal(p.lastProcessed, '2026-09-08');
  assert.ok(p.cycles.length === 1 || p.qty > 0);
  assert.ok(p.cash >= 0);
  assert.ok(p.pending && p.pending.orders.length > 0);
});

test('잔고 대조', () => {
  const p = { ...newPosition({ ticker: 'TQQQ', splits: 20, seed: 4000 }), qty: 10, avg: 70, cash: 3300 };
  assert.equal(reconcile(p, { qty: 10, avg: 70.01, cash: '' }).ok, true);
  const r = reconcile(p, { qty: 9, avg: 71, cash: 3300 });
  assert.equal(r.ok, false);
  assert.deepEqual(r.diffs.map((d) => d.field), ['qty', 'avg']);
});

test('state 검증', () => {
  assert.deepEqual(validateState({ version: 1, positions: [newPosition()] }), []);
  assert.ok(validateState({ positions: [{ ticker: 'X' }] }).length > 0);
});
