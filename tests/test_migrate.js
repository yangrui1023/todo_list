// 数据结构版本与迁移（第 5 层）：老数据一路升到最新，且反复执行结果不变
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n');

function makeEl(id) {
  const cls = new Set();
  const el = {
    id, value: '', style: {}, options: [], checked: false, files: [], _html: '', _text: '', disabled: false,
    classList: { add(c) { cls.add(c); }, remove(c) { cls.delete(c); }, toggle() {}, contains() { return false; } },
    focus() {}, blur() {}, click() {}, appendChild() {}, remove() {}, setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return makeEl('x'); }, querySelectorAll() { return []; }
  };
  Object.defineProperty(el, 'textContent', { get() { return el._text; }, set(v) { el._text = String(v); }, configurable: true });
  Object.defineProperty(el, 'innerHTML', { get() { return el._html; }, set(v) { el._html = String(v); }, configurable: true });
  return el;
}
const store = {}, els = {};
const getEl = id => (els[id] || (els[id] = makeEl(id)));
const sandbox = {
  document: {
    getElementById: getEl, querySelector: () => makeEl('q'), querySelectorAll: () => [],
    createElement: () => makeEl('c'), addEventListener() {}, body: makeEl('b'), documentElement: makeEl('h'), visibilityState: 'visible'
  },
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
  navigator: { userAgent: 'node' }, location: { href: 'file:///t' },
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve([]), text: () => Promise.resolve('') }),
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  console, confirm: () => true, alert() {},
  Blob: class { constructor(p) { this.p = p; } }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  Intl, Date, Math, JSON, Number, String, Array, Object, Set, Map, RegExp, parseFloat, parseInt, isNaN, isFinite,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'app.js' });
sandbox.escapeHtml = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const S = sandbox;
const G = expr => vm.runInContext(expr, sandbox);

function load(raw) {
  Object.keys(els).forEach(k => delete els[k]);
  store['checkin_app_data'] = JSON.stringify(raw);
  S.loadData();
  return G('JSON.parse(JSON.stringify(state))');
}

console.log('=== 1. 新装：空状态结构完整 ===');
const fresh = G('JSON.parse(JSON.stringify(makeEmptyState()))');
ok(fresh.schemaVersion === G('SCHEMA_VERSION'), '新状态自带当前版本号');
ok(Array.isArray(fresh.categories) && Array.isArray(fresh.foods), 'categories / foods 是数组');
ok(typeof fresh.records === 'object' && typeof fresh.diets === 'object', 'records / diets 是对象');
ok(fresh.dietGoals.breakfast === 500 && fresh.dietGoals.total === 2000, '饮食目标四项齐备');
ok(fresh._rev === 0, 'rev 从 0 开始');

console.log('\n=== 2. 第 1 版老数据（没有 schemaVersion）===');
let st = load({
  categories: [{ id: 'c1', name: '健康', items: [{ id: 'i1', name: '早起' }] }],
  records: { '2026-10-01': ['i1'] }
  // 没有 foods / diets / dietGoals / dietMealNotes / schemaVersion
});
ok(st.schemaVersion === G('SCHEMA_VERSION'), '自动升到当前版本');
ok(Array.isArray(st.foods) && st.foods.length === 0, '补出空的 foods');
ok(st.diets && typeof st.diets === 'object', '补出空的 diets');
ok(st.dietMealNotes && typeof st.dietMealNotes === 'object', '补出空的 dietMealNotes');
ok(st.dietGoals.breakfast === 500 && st.dietGoals.lunch === 700, '缺的三餐目标补默认值');
ok(st.dietGoals.total === 2000, '补出全天总目标');
ok(st.dietRemoved === false, '补出 dietRemoved');
ok(st.categories.some(c => c.builtin === 'diet'), '饮食内置分类自动注入');
ok(st.records['2026-10-01'][0] === 'i1', '历史记录保持原样（没有被改成对象）');

console.log('\n=== 3. 更老的数据：饮食记录没有 meal 字段 ===');
st = load({
  schemaVersion: 1,
  categories: [],
  records: {},
  diets: { '2026-09-01': [{ id: 'd1', name: '巨无霸', kcal: 550, qty: 1 }], '2026-09-02': 'not-an-array' },
  dietGoals: { breakfast: 400 }
});
ok(st.diets['2026-09-01'][0].meal === 'lunch', '缺 meal 的记录归到午餐');
ok(Array.isArray(st.diets['2026-09-02']), '非数组的日记账被纠成空数组');
ok(st.dietGoals.breakfast === 400, '用户设过的目标不被默认值覆盖');
ok(st.dietGoals.dinner === 600, '没设过的目标补默认 600');

console.log('\n=== 4. 显式 null 不能被当成「缺字段」补回来 ===');
st = load({
  schemaVersion: 1, categories: [], records: {},
  dietGoals: { breakfast: null, lunch: null, dinner: null, total: null }
});
ok(st.dietGoals.breakfast === null && st.dietGoals.dinner === null, '用户清空的目标保持 null');

console.log('\n=== 5. 幂等：连跑三次，内容不变 ===');
st = load({
  categories: [{ id: 'c1', name: '健康', items: [{ id: 'i1', name: '早起', quant: { unit: '杯', target: 8 } }] }],
  records: { '2026-10-01': [{ id: 'i1', value: 3, note: '还行' }] },
  diets: { '2026-10-01': [{ id: 'd1', meal: 'breakfast', name: '包子', kcal: 200, qty: 2 }] }
});
const once = JSON.stringify(G('state'));
G('ensureStateShape()'); G('ensureStateShape()'); G('ensureStateShape()');
ok(JSON.stringify(G('state')) === once, '重复执行不再改动任何字段');

console.log('\n=== 6. 脏数据：不该崩，也不该污染状态 ===');
st = load({ schemaVersion: 2, categories: 'oops', records: [1, 2], foods: null, diets: 'x' });
ok(Array.isArray(st.categories), 'categories 被纠成数组');
ok(st.records && !Array.isArray(st.records), 'records 被纠成对象');
ok(Array.isArray(st.foods), 'foods 被纠成数组');
ok(typeof st.diets === 'object', 'diets 被纠成对象');
st = load(null);
ok(st.schemaVersion === G('SCHEMA_VERSION'), 'null 数据当成新装处理');

console.log('\n=== 7. 来自未来版本的数据：不试图回调，直接压到当前版本 ===');
st = load({ schemaVersion: 99, categories: [], records: {}, __future: 1 });
ok(st.schemaVersion === G('SCHEMA_VERSION'), '版本号被压回当前版本');
ok(st.categories && st.records, '仍然能正常使用');

console.log('\n=== 8. 源码护栏：迁移只允许在 MIGRATIONS 里做 ===');
ok(/const MIGRATIONS = \[/.test(html), '存在迁移表');
ok(/function migrateState|MIGRATIONS.forEach/.test(html), '有统一的迁移执行点');
ok(html.indexOf('if (s.dietGoals.total === undefined)') < 0 || html.indexOf('MIGRATIONS') < html.indexOf('if (s.dietGoals.total === undefined)'),
  '历史 if 补丁已并入迁移表');

console.log('');
if (fail > 0) { console.log(`${fail} FAILED`); process.exit(1); }
console.log('PASS');
