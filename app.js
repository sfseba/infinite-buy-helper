// 무한매수 도우미 - 웹 계산기 화면 로직
import {
  newPosition, emptyState, refreshPending, detectFills, applyFills, reconcile, adoptBroker,
  validateState, PHASE_LABEL, r2,
} from './engine/engine.mjs';

const KEY = 'ibh-state-v1';
const SEL_KEY = 'ibh-selected';
const $ = (id) => document.getElementById(id);
const usd = (x) => (x == null || !isFinite(x) ? '–' : '$' + Number(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const num = (id) => { const v = parseFloat(String($(id).value).replace(/[,\s$]/g, '')); return isFinite(v) ? v : NaN; };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let state = load();
let sel = 0;
try { sel = Number(localStorage.getItem(SEL_KEY)) || 0; } catch { /* 저장소 없음 */ }
let draftFills = null; // 체결 입력 중인 주문 목록
let adding = false;

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && !validateState(s).length) return s;
  } catch { /* 무시 */ }
  return emptyState();
}
function save() {
  state.updatedAt = new Date().toISOString();
  try { localStorage.setItem(KEY, JSON.stringify(state)); localStorage.setItem(SEL_KEY, String(sel)); } catch { /* 저장 불가 */ }
}
const pos = () => state.positions[sel];
function setPos(p) { state.positions[sel] = p; save(); }

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg; t.setAttribute('role', 'status');
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}
const note = (level, text) => `<div class="note ${level}">${esc(text)}</div>`;

// ---------- 렌더링 ----------
function render() {
  if (sel >= state.positions.length) sel = Math.max(0, state.positions.length - 1);
  const has = state.positions.length > 0;
  $('setup').hidden = has && !adding;
  $('su-cancel').hidden = !has;
  $('main').hidden = !has;
  renderTabs();
  updateSetupHint();
  if (!has) return;
  renderOrders();
  renderBook();
  renderCycles();
}

function renderTabs() {
  $('tabs').innerHTML = state.positions.map((p, i) =>
    `<button class="tab" role="tab" aria-selected="${i === sel}" data-i="${i}">${esc(p.ticker)} · ${p.splits}분할</button>`).join('');
  $('tabs').querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { sel = Number(b.dataset.i); draftFills = null; save(); render(); }));
}

function renderOrders() {
  const p = pos();
  if (!p.pending) setPos(refreshPending(p, p.refClose));
  const plan = pos().pending;
  $('phase').textContent = PHASE_LABEL[plan.phase];
  $('phase').className = 'chip' + (plan.phase === 'reverse' ? ' reverse' : '');
  $('st-unit').textContent = usd(plan.unit);
  $('st-star').textContent = plan.phase === 'first' ? '–' : (plan.starPct >= 0 ? '+' : '') + plan.starPct.toFixed(2) + '%';
  $('st-point').textContent = plan.phase === 'first' ? '–' : usd(plan.starPoint);
  $('st-t').textContent = `${pos().T} / ${pos().splits}`;
  $('orders').innerHTML = plan.orders.length
    ? plan.orders.map((o) => `<div class="order ${o.side}"><span class="tag">${o.side === 'buy' ? '매수' : '매도'} · ${o.type === 'LIMIT' ? '지정가' : 'LOC'}</span><div class="what">${esc(o.label)}</div><div class="nums"><div class="p">${usd(o.price)}</div><div class="q">${o.qty}주</div></div></div>`).join('')
    : '<p class="empty">오늘 넣을 주문이 없어요.</p>';
  $('order-notes').innerHTML = plan.notes.map((n) => note(n.level, n.text)).join('');
  if (document.activeElement !== $('ref-close')) $('ref-close').value = pos().refClose ?? '';
}

function renderBook() {
  const p = pos();
  const items = [
    ['T', p.T], ['보유 수량', p.qty + '주'], ['평단', usd(p.avg)], ['남은 현금', usd(p.cash)],
    ['사이클', p.cycleNo + '번째'], ['사이클 시작', p.cycleStart || '–'], ['처음 원금', usd(p.seed)], ['마지막 반영일', p.lastProcessed || '–'],
  ];
  $('book').innerHTML = items.map(([k, v]) => `<div><span>${k}</span>${esc(v)}</div>`).join('');
  $('log').innerHTML = (p.log || []).slice().reverse().slice(0, 40).map((l) =>
    `<li>${esc(l.date)} · ${l.events.length ? l.events.map(eventText).map(esc).join(' / ') : '체결 없음'}</li>`).join('') || '<li>아직 기록이 없어요</li>';
}

function eventText(e) {
  const K = { first: '첫 매수', avg: '평단 매수', star: '별지점 매수', quarter: '쿼터 매도', target: '목표가 매도' };
  if (e.type === 'buy') return `${K[e.kind] || '매수'} ${e.qty}주 @ ${usd(e.price)}`;
  if (e.type === 'sell') return `${K[e.kind] || '매도'} ${e.qty}주 @ ${usd(e.price)}`;
  if (e.type === 'cycleEnd') return `사이클 ${e.cycle.no} 종료 ${e.cycle.profit >= 0 ? '+' : ''}${usd(e.cycle.profit)}`;
  return e.text || '';
}

function renderCycles() {
  const c = pos().cycles || [];
  if (!c.length) { $('cycles').innerHTML = '<p class="empty">아직 끝난 사이클이 없어요. 목표가 매도가 체결되면 여기에 쌓여요.</p>'; return; }
  const total = c.reduce((s, x) => s + x.profit, 0);
  $('cycles').innerHTML = `<table><thead><tr><th>사이클</th><th>기간</th><th>시작 현금</th><th>끝 현금</th><th>수익</th><th>수익률</th></tr></thead><tbody>${
    c.slice().reverse().map((x) => `<tr><td>${x.no}</td><td>${esc(x.start || '?')} → ${esc(x.end)}</td><td>${usd(x.startCash)}</td><td>${usd(x.endCash)}</td><td class="${x.profit >= 0 ? 'pos' : 'neg'}">${x.profit >= 0 ? '+' : ''}${usd(x.profit)}</td><td class="${x.profit >= 0 ? 'pos' : 'neg'}">${x.pct.toFixed(2)}%</td></tr>`).join('')
  }</tbody><tfoot><tr><td>합계</td><td colspan="3"></td><td class="${total >= 0 ? 'pos' : 'neg'}">${total >= 0 ? '+' : ''}${usd(total)}</td><td></td></tr></tfoot></table>`;
}

// ---------- 시작 화면 ----------
function updateSetupHint() {
  const krw = num('su-krw'), fx = num('su-fx'), splits = Number($('su-splits').value);
  if (krw > 0 && fx > 0) {
    const seed = krw / fx;
    const close = num('su-close');
    let t = `원금 ≈ ${usd(seed)} · 1회 매수금 ≈ ${usd(seed / splits)}`;
    if (close > 0) t += ` · 1회에 약 ${Math.floor(seed / splits / close)}주`;
    $('su-hint').textContent = t;
  } else $('su-hint').textContent = '원금과 환율을 넣어주세요.';
}
['su-krw', 'su-fx', 'su-splits', 'su-close'].forEach((id) => $(id).addEventListener('input', updateSetupHint));

$('su-start').addEventListener('click', () => {
  const krw = num('su-krw'), fx = num('su-fx'), close = num('su-close');
  if (!(krw > 0 && fx > 0)) { toast('원금과 환율을 확인해 주세요'); return; }
  let p;
  try { p = newPosition({ ticker: $('su-ticker').value, splits: Number($('su-splits').value), seed: r2(krw / fx) }); }
  catch (e) { toast(e.message); return; }
  p = refreshPending(p, close > 0 ? close : null);
  state.positions.push(p);
  sel = state.positions.length - 1;
  adding = false;
  save(); render();
  toast('포지션을 만들었어요');
});
$('su-cancel').addEventListener('click', () => { adding = false; render(); });

// ---------- 오늘의 주문 ----------
$('recalc').addEventListener('click', () => {
  const c = num('ref-close');
  if (!(c > 0)) { toast('직전 종가를 넣어주세요'); return; }
  setPos(refreshPending(pos(), c));
  renderOrders();
  toast('주문을 다시 계산했어요');
});

// ---------- 체결 입력 ----------
$('fx-detect').addEventListener('click', () => {
  const plan = pos().pending;
  const close = num('fx-close');
  let high = num('fx-high');
  if (!(close > 0)) { toast('종가를 넣어주세요'); return; }
  if (!(high > 0)) high = close;
  if (!plan || !plan.orders.length) { toast('확인할 주문이 없어요'); return; }
  draftFills = detectFills(plan.orders, { close, high });
  renderFillList();
});

function renderFillList() {
  if (!draftFills) { $('fx-list').innerHTML = ''; $('fx-preview').innerHTML = ''; $('fx-apply').disabled = true; return; }
  $('fx-list').innerHTML = draftFills.map((f, i) => `
    <div class="fill-row">
      <input type="checkbox" id="fl-c${i}" ${f.filled ? 'checked' : ''} aria-label="체결됨">
      <label for="fl-c${i}" style="color:var(--ink);font-size:13.5px">${f.side === 'buy' ? '매수' : '매도'} ${f.type === 'LIMIT' ? '지정가' : 'LOC'} ${usd(f.price)} × ${f.qty}주<br><small style="color:var(--muted)">${esc(f.label)}</small></label>
      <label>체결 수량<input id="fl-q${i}" inputmode="numeric" value="${f.filled ? f.fillQty : f.qty}"></label>
      <label>체결가<input id="fl-p${i}" inputmode="decimal" value="${f.fillPrice ?? ''}"></label>
    </div>`).join('');
  draftFills.forEach((_, i) => ['c', 'q', 'p'].forEach((k) => $(`fl-${k}${i}`).addEventListener('input', previewFills)));
  previewFills();
}

function collectFills() {
  return draftFills.map((f, i) => {
    const filled = $(`fl-c${i}`).checked;
    const q = Math.floor(num(`fl-q${i}`));
    const pr = num(`fl-p${i}`);
    return { ...f, filled, fillQty: filled && q > 0 ? Math.min(q, f.qty) : 0, fillPrice: pr > 0 ? pr : f.fillPrice };
  });
}

function previewFills() {
  const date = $('fx-date').value || new Date().toISOString().slice(0, 10);
  const { pos: next, events } = applyFills(pos(), collectFills(), date);
  const p = pos();
  const cell = (k, a, b) => `<div><span>${k}</span>${a} → <b>${b}</b></div>`;
  $('fx-preview').innerHTML = `<p class="empty" style="margin:4px 0 8px">반영하면 이렇게 바뀌어요${events.length ? '' : ' (체결 없음)'}</p><div class="diff">${
    cell('T', p.T, next.T) + cell('보유', p.qty + '주', next.qty + '주') + cell('평단', usd(p.avg), usd(next.avg)) + cell('현금', usd(p.cash), usd(next.cash))
  }</div>${events.filter((e) => e.type === 'cycleEnd' || e.type === 'note').map((e) => note(e.type === 'cycleEnd' ? 'ok' : 'warn', eventText(e))).join('')}`;
  $('fx-apply').disabled = false;
}

$('fx-apply').addEventListener('click', () => {
  if (!draftFills) return;
  const date = $('fx-date').value || new Date().toISOString().slice(0, 10);
  const close = num('fx-close');
  const { pos: next, events } = applyFills(pos(), collectFills(), date);
  setPos(refreshPending(next, close > 0 ? close : next.refClose, date));
  draftFills = null;
  ['fx-close', 'fx-high'].forEach((id) => { $(id).value = ''; });
  $('fx-date').value = nextWeekday(date);
  renderFillList(); render();
  toast(events.some((e) => e.type === 'cycleEnd') ? '사이클이 끝났어요! 새 사이클 주문을 확인하세요' : '반영했어요. 오늘의 주문이 새로 계산됐어요');
});

function nextWeekday(d) {
  const t = new Date(d + 'T12:00:00Z');
  do { t.setUTCDate(t.getUTCDate() + 1); } while ([0, 6].includes(t.getUTCDay()));
  return t.toISOString().slice(0, 10);
}

// ---------- 장부 직접 수정 ----------
$('bk-edit').addEventListener('click', () => {
  const p = pos();
  $('bk-T').value = p.T; $('bk-qty').value = p.qty; $('bk-avg').value = p.avg; $('bk-cash').value = p.cash;
  $('bk-form').hidden = false;
});
$('bk-cancel').addEventListener('click', () => { $('bk-form').hidden = true; });
$('bk-save').addEventListener('click', () => {
  const v = { T: num('bk-T'), qty: Math.floor(num('bk-qty')), avg: num('bk-avg'), cash: num('bk-cash') };
  if (Object.values(v).some((x) => !(x >= 0))) { toast('0 이상의 숫자를 넣어주세요'); return; }
  const p = { ...pos(), ...v };
  p.log = [...(p.log || []), { date: new Date().toISOString().slice(0, 10), events: [{ type: 'note', text: `직접 수정: T ${v.T}, ${v.qty}주, 평단 ${v.avg}, 현금 ${v.cash}` }] }].slice(-120);
  setPos(refreshPending(p, p.refClose));
  $('bk-form').hidden = true;
  render(); toast('저장했어요');
});

// ---------- 잔고 대조 ----------
const brokerVals = () => ({ qty: $('rc-qty').value === '' ? '' : num('rc-qty'), avg: $('rc-avg').value === '' ? '' : num('rc-avg'), cash: $('rc-cash').value === '' ? '' : num('rc-cash') });
$('rc-check').addEventListener('click', () => {
  const r = reconcile(pos(), brokerVals());
  if (r.ok) { $('rc-result').innerHTML = note('ok', '장부와 증권사 잔고가 맞아요.'); $('rc-adopt').hidden = true; return; }
  $('rc-result').innerHTML = note('warn', '장부와 다른 값이 있어요. 체결 입력을 빠뜨렸는지 먼저 확인해 보세요.') +
    `<div class="diff" style="margin-top:8px">${r.diffs.map((d) => `<div><span>${d.label}</span>장부 ${d.book} · 증권사 <b>${d.broker}</b></div>`).join('')}</div>`;
  $('rc-adopt').hidden = false;
});
$('rc-adopt').addEventListener('click', () => {
  setPos(refreshPending(adoptBroker(pos(), brokerVals()), pos().refClose));
  $('rc-result').innerHTML = note('ok', '증권사 값으로 맞췄어요. T는 바뀌지 않으니 필요하면 직접 수정하세요.');
  $('rc-adopt').hidden = true;
  render();
});

// ---------- 백업 ----------
const exportText = () => JSON.stringify(state, null, 2);
$('bk-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(exportText()); toast('JSON을 복사했어요'); }
  catch { $('bk-json').value = exportText(); $('bk-json').select(); toast('아래 칸의 내용을 직접 복사해 주세요'); }
});
$('bk-download').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([exportText()], { type: 'application/json' }));
  a.download = 'state.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
function importState(s, source) {
  const errs = validateState(s);
  if (errs.length) { $('bk-msg').innerHTML = note('danger', '불러올 수 없어요: ' + errs.join(', ')); return; }
  state = s; sel = 0; draftFills = null; save(); render();
  $('bk-msg').innerHTML = note('ok', `${source}에서 포지션 ${s.positions.length}개를 불러왔어요.`);
}
$('bk-import').addEventListener('click', () => {
  try { importState(JSON.parse($('bk-json').value), '붙여넣은 JSON'); }
  catch { $('bk-msg').innerHTML = note('danger', 'JSON 형식이 아니에요. 복사한 내용을 그대로 붙여넣었는지 확인해 주세요.'); }
});
$('bk-bot').addEventListener('click', async () => {
  try {
    const res = await fetch('data/state.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    importState(await res.json(), '봇 장부(data/state.json)');
  } catch (e) {
    $('bk-msg').innerHTML = note('danger', `봇 장부를 못 불러왔어요 (${e.message}). GitHub Pages 주소에서 열었는지 확인해 주세요.`);
  }
});
$('bk-new').addEventListener('click', () => { adding = true; render(); $('setup').scrollIntoView({ behavior: 'smooth' }); });

let delArmed = false;
$('bk-del').addEventListener('click', () => {
  if (!delArmed) { delArmed = true; $('bk-del').textContent = '한 번 더 누르면 삭제돼요'; setTimeout(() => { delArmed = false; $('bk-del').textContent = '이 포지션 삭제'; }, 4000); return; }
  state.positions.splice(sel, 1); sel = 0; delArmed = false; $('bk-del').textContent = '이 포지션 삭제';
  save(); render(); toast('삭제했어요');
});

$('fx-date').value = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
render();
