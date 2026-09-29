import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function daysAgo(n) {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
}
function run(statePath, bars) {
  return execFileSync(process.execPath, ['--import', join(ROOT, 'test/mock-fetch.mjs'), join(ROOT, 'bot/daily.mjs')], {
    env: { ...process.env, STATE_PATH: statePath, MOCK_BARS: JSON.stringify(bars), TELEGRAM_BOT_TOKEN: 'x', TELEGRAM_CHAT_ID: '1' },
    encoding: 'utf8',
  });
}

test('봇: 첫 실행은 주문만 계산, 다음 실행은 체결 추정 후 갱신', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ibh-'));
  const statePath = join(dir, 'state.json');
  copyFileSync(join(ROOT, 'data/state.json'), statePath);

  const bars = [
    { date: daysAgo(4), close: 70, high: 71 },
    { date: daysAgo(3), close: 70, high: 71 },
  ];
  run(statePath, bars);
  let s = JSON.parse(readFileSync(statePath, 'utf8'));
  let p = s.positions[0];
  assert.equal(p.lastProcessed, daysAgo(3));
  assert.equal(p.pending.phase, 'first');
  assert.equal(p.pending.orders[0].qty, Math.floor(160 / 70));

  bars.push({ date: daysAgo(2), close: 69, high: 70 }); // 첫 매수 LOC(80.5) 체결
  run(statePath, bars);
  s = JSON.parse(readFileSync(statePath, 'utf8'));
  p = s.positions[0];
  assert.equal(p.qty, 2);
  assert.equal(p.avg, 69);
  assert.equal(p.T, 1);
  assert.equal(p.pending.phase, 'front');
});

test('봇: 시세 실패 시 오류 알림 후 종료 코드 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ibh-'));
  const statePath = join(dir, 'state.json');
  copyFileSync(join(ROOT, 'data/state.json'), statePath);
  assert.throws(() => run(statePath, []), (e) => e.status === 1 && /오류/.test(e.stdout));
});
