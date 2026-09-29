// 텔레그램 메시지 문구 만들기
import { PHASE_LABEL } from '../engine/engine.mjs';
import { esc } from './telegram.mjs';

const usd = (x) => '$' + Number(x).toFixed(2);
const KIND = { first: '첫 매수', avg: '평단 매수', star: '별지점 매수', quarter: '쿼터 매도', target: '목표가 매도' };

export function formatEvents(events) {
  if (!events.length) return '지난 거래일 체결: 없음 (추정)';
  const lines = ['지난 거래일 체결 (종가·고가로 추정):'];
  for (const e of events) {
    if (e.type === 'buy') lines.push(`  🔴 ${KIND[e.kind] || e.kind} ${e.qty}주 @ ${usd(e.price)}  (T +${e.tInc})`);
    else if (e.type === 'sell') lines.push(`  🔵 ${KIND[e.kind] || e.kind} ${e.qty}주 @ ${usd(e.price)}  (손익 ${e.pnl >= 0 ? '+' : ''}${usd(e.pnl)})`);
    else if (e.type === 'cycleEnd') lines.push(`  <b>사이클 ${e.cycle.no} 종료</b>: ${e.cycle.profit >= 0 ? '+' : ''}${usd(e.cycle.profit)} (${e.cycle.pct.toFixed(2)}%)`);
    else if (e.type === 'note') lines.push(`  참고: ${esc(e.text)}`);
  }
  return lines.join('\n');
}

export function formatPosition(pos, events, lastBar) {
  const p = pos.pending;
  const head = `<b>${esc(pos.ticker)} ${pos.splits}분할</b> · 사이클 ${pos.cycleNo} · ${PHASE_LABEL[p.phase]}`;
  const status = `T ${pos.T} · 보유 ${pos.qty}주 · 평단 ${usd(pos.avg)} · 현금 ${usd(pos.cash)}`;
  const market = lastBar ? `기준 종가 ${usd(lastBar.close)} (${lastBar.date})` : '';
  const orders = p.orders.length
    ? p.orders.map((o) => `  ${o.side === 'buy' ? '🔴 매수' : '🔵 매도'} ${o.type === 'LIMIT' ? '지정가' : 'LOC'} <b>${usd(o.price)}</b> × ${o.qty}주 — ${esc(o.label)}`).join('\n')
    : '  (오늘 넣을 주문 없음)';
  const notes = p.notes.map((n) => `  ${n.level === 'danger' ? '⛔' : n.level === 'warn' ? '⚠️' : 'ℹ️'} ${esc(n.text)}`).join('\n');
  return [head, status, market, '', formatEvents(events), '', '<b>오늘의 주문</b>' + (p.phase !== 'first' ? ` (1회 매수금 ${usd(p.unit)}, 별% ${p.starPct.toFixed(2)}%, 별지점 ${usd(p.starPoint)})` : ` (1회 매수금 ${usd(p.unit)})`), orders, notes]
    .filter((x) => x !== undefined).join('\n');
}

export function formatMessage(blocks, { weekly } = {}) {
  const footer = [
    '체결은 종가·고가로 추정한 값이에요. 증권사 앱과 다르면 웹 계산기에서 고치고 state.json에 반영하세요.',
    weekly ? '📋 주말에 증권사 잔고(수량·평단·현금)와 장부를 한 번 대조해 주세요.' : '',
  ].filter(Boolean).join('\n');
  return ['<b>무한매수 도우미 · 오늘의 주문</b>', '', blocks.join('\n\n────────\n\n'), '', footer].join('\n');
}
