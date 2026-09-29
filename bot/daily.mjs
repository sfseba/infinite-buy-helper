// 매일 실행되는 알림 봇
// 1) data/state.json 읽기 → 2) 새 거래일 시세로 어제 주문 체결 추정·반영
// 3) 오늘 주문 계산 → 4) state.json 저장 → 5) 텔레그램 전송
// 이 봇은 주문을 넣지 않습니다. 계산하고 알려주기만 합니다.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stepDay, refreshPending, validateState } from '../engine/engine.mjs';
import { fetchBars } from './market.mjs';
import { sendTelegram, esc } from './telegram.mjs';
import { formatPosition, formatMessage } from './format.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_PATH = process.env.STATE_PATH || join(ROOT, 'data', 'state.json');
const DRY = process.argv.includes('--dry'); // 저장 없이 결과만 출력

async function main() {
  const state = JSON.parse(await readFile(STATE_PATH, 'utf8'));
  const errs = validateState(state);
  if (errs.length) throw new Error('state.json 형식 오류: ' + errs.join(', '));
  if (!state.positions.length) {
    await sendTelegram('무한매수 도우미: data/state.json에 포지션이 없어요. 웹 계산기의 "설정 · 백업"에서 만든 JSON을 붙여넣어 주세요.');
    return;
  }

  const blocks = [];
  let weekly = false;
  for (let i = 0; i < state.positions.length; i++) {
    let pos = state.positions[i];
    const bars = await fetchBars(pos.ticker);
    const lastBar = bars[bars.length - 1];
    let events = [];

    if (!pos.lastProcessed) {
      // 처음 실행: 과거 체결은 추정하지 않고 오늘 주문만 계산합니다
      pos = refreshPending(pos, lastBar.close, lastBar.date);
      pos.lastProcessed = lastBar.date;
    } else {
      const fresh = bars.filter((b) => b.date > pos.lastProcessed);
      for (const bar of fresh) {
        const r = stepDay(pos, bar);
        pos = r.pos;
        events = events.concat(r.events);
      }
      if (!fresh.length && !pos.pending) pos = refreshPending(pos, lastBar.close, lastBar.date);
    }
    if (new Date(lastBar.date + 'T12:00:00Z').getUTCDay() === 5) weekly = true;
    state.positions[i] = pos;
    blocks.push(formatPosition(pos, events, lastBar));
  }

  state.updatedAt = new Date().toISOString();
  const text = formatMessage(blocks, { weekly });
  if (DRY) { console.log(text); return; }
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
  await sendTelegram(text);
}

main().catch(async (e) => {
  console.error(e);
  try { await sendTelegram(`⚠️ <b>무한매수 도우미 오류</b>\n${esc(e.message)}\n\n오늘 주문은 웹 계산기로 직접 계산해 주세요.`); } catch (e2) { console.error(e2); }
  process.exit(1);
});
