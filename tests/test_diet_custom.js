// 自定义记录：不入食物库，直接往某餐记一条（热量计入合计，份数可调，可删除）
const fs = require('fs'), vm = require('vm');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const code = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n');

function makeEl(id) {
  const cls = new Set();
  const el = {
    id, value: '', style: {}, options: [], checked: false, files: [], _html: '', _text: '', disabled: false,
    classList: {
      add(c) { cls.add(c); }, remove(c) { cls.delete(c); },
      toggle(c, force) {
        if (force === undefined) { cls.has(c) ? cls.delete(c) : cls.add(c); }
        else if (force) cls.add(c); else cls.delete(c);
      },
      contains(c) { return cls.has(c); }
    },
    _cls: cls,
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
vm.createContext(sandbox); vm.runInContext(code, sandbox, { filename: 'app.js' });

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const S = sandbox;
const TODAY = () => S.formatDate(new Date());

// 干净起点：空数据 + 启用饮食分类（loadData 会自动注入内置饮食分类）
store['checkin_app_data'] = JSON.stringify({ categories: [], records: {}, foods: [] });
S.loadData();
ok(!!S.getDietCat(), '内置饮食分类已注入');

console.log('=== 1. 打开自定义记录弹窗 ===');
S.openDietMealModal('lunch');
S.openDietMealModal('lunch');
S.openDietCustomModal();
ok(!!getEl('dietCustomName') && !!getEl('dietCustomKcal'), '弹窗打开，表单有名称和热量两个输入框');

console.log('=== 2. 校验 ===');
getEl('dietCustomName').value = '';
getEl('dietCustomKcal').value = '400';
let threw = false;
try { S.confirmEditModal(); } catch (e) { threw = true; }
ok(!threw && (S.getDietEntries(TODAY()) || []).length === 0, '名称为空 → 不写入，弹窗校验拦截');

console.log('=== 3. 添加成功 ===');
getEl('dietCustomName').value = '一碗面';
getEl('dietCustomKcal').value = '400';
S.confirmEditModal();
let entries = S.getDietEntries(TODAY());
ok(entries.length === 1, '写入一条记录');
ok(entries[0].name === '一碗面' && entries[0].kcal === 400, '名称与热量正确');
ok(entries[0].qty === 1 && entries[0].unit === 'serving', '默认 1 份（按份计价）');
ok(!entries[0].foodId, '不带 foodId（不关联食物库）');
ok(S.dietTotalKcal(entries) === 400, '热量计入本餐合计');
ok(!S.getFoods().some(f => f.name === '一碗面'), '没有混进食物库');

console.log('=== 4. 与食物库记录共存、份数可调 ===');
S.getFoods().push({ id: 'f1', kind: 'food', brand: 'X', name: '苹果', kcal: 52 });
S.addDietByFood('f1');
S.addDietCustom('加餐饼干', 120, 'lunch');
entries = S.getDietEntries(TODAY());
ok(entries.length === 3 && S.dietTotalKcal(entries) === 572, '自定义与食物库记录并存，合计正确');
const custom = entries.find(e => e.custom && e.name === '加餐饼干');
S.changeDietQty(custom.id, 1);
ok(S.dietEntryKcal(S.getDietEntries(TODAY()).find(e => e.id === custom.id)) === 240, '份数 +1 → 热量 ×2');

console.log('=== 5. 删除 ===');
S.removeDietEntry(custom.id);
ok(!S.getDietEntries(TODAY()).some(e => e.id === custom.id), '自定义条目可删除');

console.log(fail === 0 ? '\nPASS' : `\nFAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
