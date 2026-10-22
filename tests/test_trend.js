const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const code = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n');
function makeEl(id) {
  const el = { id, value: '', style: {}, options: [], checked: false, files: [], _html: '', _text: '',
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, focus() {}, blur() {}, click() {},
    appendChild() {}, remove() {}, setAttribute() {}, getAttribute() { return null; }, addEventListener() {}, removeEventListener() {},
    querySelector() { return makeEl('x'); }, querySelectorAll() { return []; } };
  Object.defineProperty(el, 'textContent', { get() { return el._text; }, set(v) { el._text = String(v); }, configurable: true });
  Object.defineProperty(el, 'innerHTML', { get() { return el._html; }, set(v) { el._html = String(v); }, configurable: true });
  return el;
}
const store = {}, els = {};
const getEl = id => (els[id] || (els[id] = makeEl(id)));
const sandbox = {
  document: { getElementById: getEl, querySelector: () => makeEl('q'), querySelectorAll: () => [], createElement: () => makeEl('c'), addEventListener() {}, body: makeEl('b'), documentElement: makeEl('h'), visibilityState: 'visible' },
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
  navigator: { userAgent: 'node' }, location: { href: 'file:///t' }, fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve([]), text: () => Promise.resolve('') }),
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, console, confirm: () => true, alert() {},
  Blob: class { constructor(p) { this.p = p; } }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  Intl, Date, Math, JSON, Number, String, Array, Object, Set, Map, RegExp, parseFloat, parseInt, isNaN, isFinite,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox); vm.runInContext(code, sandbox, { filename: 'app.js' });

const mkDays = vals => vals.map((v, i) => ({ key: '2026-10-' + String(i + 1).padStart(2, '0'), value: v }));

const cases = [
  { name: 'gte 正常：喝水 8 杯', item: { id: 'a', name: '喝水', quant: { unit: '杯', target: 8, compare: 'gte' } }, vals: [3, 6, 8, null, 7, 5, 8, 8] },
  { name: 'gte 目标远高：40 vs 0~2', item: { id: 'b', name: '运动', quant: { unit: '分钟', target: 40, compare: 'gte' } }, vals: [0, 2, 1, null, 2, 0, 2, 1] },
  { name: 'gte 目标远低：-50 vs 60~70', item: { id: 'c', name: '压力', quant: { unit: '', target: -50, compare: 'gte' } }, vals: [60, 65, 70, 62, 68, 66, 69, 64] },
  { name: 'lte 体重：70 vs 68', item: { id: 'd', name: '体重', quant: { unit: 'kg', target: 70, compare: 'lte' } }, vals: [68.6, 68.4, null, 68.9, 68.2, 68.5, 68.1, 67.9] },
  { name: 'lte 目标远低：0 vs 300~400', item: { id: 'e', name: '热量', quant: { unit: 'kcal', target: 0, compare: 'lte' } }, vals: [300, 350, 400, 320, 380, 360, 390, 340] },
  { name: '无记录 + 有目标', item: { id: 'f', name: '冥想', quant: { unit: '分钟', target: 20, compare: 'gte' } }, vals: [null, null, null, null, null, null, null, null] },
  { name: '无记录 + 无目标', item: { id: 'g', name: '空', quant: { unit: '', target: '', compare: 'gte' } }, vals: [null, null, null, null, null, null, null, null] },
  { name: '只有一个点', item: { id: 'h', name: '单点', quant: { unit: '', target: 10, compare: 'gte' } }, vals: [null, null, null, null, null, null, null, 6] },
  { name: '负值 gte', item: { id: 'i', name: '收支', quant: { unit: '元', target: -5, compare: 'gte' } }, vals: [-8, -3, -10, -6, -2, -9, -4, -7] },
];

let fail = 0;
const out = [];
const ok = (c, m) => { if (!c) { fail++; console.log('  X ' + m); } else console.log('  ok ' + m); };
const TARGET_LINE = /<line x1="54" y1="([\d.]+)" x2="604" y2="[\d.]+" stroke="#dc2626"/;

cases.forEach(c => {
  console.log('\n=== ' + c.name + ' ===');
  const days = mkDays(c.vals);
  const small = sandbox.renderTrendSvg(c.item, days);
  const large = sandbox.renderTrendSvgLarge(c.item, days);
  const hasTarget = c.item.quant.target !== '' && c.item.quant.target != null;
  const hasData = c.vals.some(v => v != null);
  const rng = sandbox.chartRange(c.vals.filter(v => v != null), c.item.quant.target, { ticks: 4, goodAbove: c.item.quant.compare !== 'lte' });
  console.log('  range:', rng.min, '~', rng.max, 'step', rng.step, 'ticks', rng.ticks.join(','));

  ok(rng.ticks.length <= 7, '刻度 ' + rng.ticks.length + ' 个 (<=7)');
  if (hasTarget) {
    ok(/stroke="#dc2626"/.test(small), '小图有目标虚线');
    ok(TARGET_LINE.test(large), '大图有目标虚线');
    const m = large.match(TARGET_LINE);
    if (m) { const yv = +m[1]; ok(yv >= 22 && yv <= 228, '目标线 y=' + yv + ' 在绘图区 22~228'); }
    ok(!/超出显示范围/.test(large), '无「超出显示范围」文案');
    ok(Number(c.item.quant.target) >= rng.min && Number(c.item.quant.target) <= rng.max, '目标 ' + c.item.quant.target + ' 在 [' + rng.min + ',' + rng.max + '] 内');
  } else {
    ok(!/stroke="#dc2626"/.test(large), '未设目标不画虚线');
  }
  if (hasData) ok((large.match(/<circle/g) || []).length === c.vals.filter(v => v != null).length, '数据点数与有填天数一致');
  if (!hasData && !hasTarget) ok(/trend-empty/.test(large) && /trend-empty/.test(small), '无记录无目标 -> 空提示');
  out.push({ name: c.name, small, large });
});
console.log('\nfailures: ' + fail);

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED'));
process.exit(fail === 0 ? 0 : 1);
