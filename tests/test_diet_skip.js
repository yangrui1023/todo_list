// 不吃这餐：0 千卡也算完成，进连续天数/累计次数/统计，有明细时不许标
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
const CK = () => getEl('checkinList').innerHTML;

function seed(extra) {
  Object.keys(els).forEach(k => delete els[k]);
  store['checkin_app_data'] = JSON.stringify(Object.assign({
    categories: [{ id: 'c1', name: '健康', icon: '💪', archived: false, countInStats: true, items: [{ id: 'i1', name: '早起', archived: false }] }],
    records: {},
    foods: [{ id: 'f1', kind: 'food', brand: 'X', name: '苹果', kcal: 52 }],
    dietGoals: { breakfast: 400, lunch: 700, dinner: 600, total: 1800 }
  }, extra || {}));
  S.loadData();
  S.renderCheckin();
}

console.log('=== 1. 默认没标不吃 ===');
seed();
let bf = S.mealState(TODAY()).find(x => x.key === 'breakfast');
ok(bf.skipped === false, '默认 skipped = false');
ok(bf.done === false, '没记也没标不吃 → 未完成');

console.log('=== 2. 标记不吃 ===');
ok(S.setDietMealSkipped(TODAY(), 'breakfast', true) === true, '空餐可以标不吃');
bf = S.mealState(TODAY()).find(x => x.key === 'breakfast');
ok(bf.skipped === true, 'skipped = true');
ok(bf.sum === 0, '热量为 0');
ok(bf.done === true, '标不吃算完成');

console.log('=== 3. 打卡页展示 ===');
S.renderCheckin();
ok(/diet-skipped/.test(CK()), '行带 diet-skipped 样式');
ok(/不吃 · 0 千卡/.test(CK()), 'badge 显示「不吃 · 0 千卡」');
ok(!/diet-skip-btn/.test(CK()), '打卡页不再有行内快捷按钮（操作统一进弹窗）');

console.log('=== 3b. 弹窗内的不吃入口 ===');
seed();
S.openDietMealModal('lunch');
let dHtml = getEl('dietModalInner').innerHTML;
ok(/diet-modal-skip/.test(dHtml), '空餐弹窗底部有「这餐不吃」');
ok(/markDietSkip\('lunch'\)/.test(dHtml), '按钮绑定到 markDietSkip');
S.markDietSkip('lunch');
dHtml = getEl('dietModalInner').innerHTML;
ok(S.isDietMealSkipped(TODAY(), 'lunch'), '弹窗内点不出后状态写入');
S.openDietMealModal('lunch');
dHtml = getEl('dietModalInner').innerHTML;
ok(/diet-skip-banner/.test(dHtml), '已不吃的餐显示横条');
ok(/cancelDietSkip\('lunch'\)/.test(dHtml), '横条带「改为吃」');
ok(!/diet-modal-add/.test(dHtml), '不吃状态下隐藏添加入口');
S.cancelDietSkip('lunch');
ok(!S.isDietMealSkipped(TODAY(), 'lunch'), '「改为吃」清掉标记');
ok(/diet-modal-skip/.test(getEl('dietModalInner').innerHTML), '改回后重新出现「这餐不吃」');

console.log('=== 3c. 有明细时弹窗不显示不吃入口 ===');
seed();
S.getDietEntries(TODAY()).push({ id: 'd9', meal: 'lunch', foodId: 'f1', name: '苹果', kcal: 52, qty: 1, unit: 'serving' });
S.openDietMealModal('lunch');
ok(!/diet-modal-skip/.test(getEl('dietModalInner').innerHTML), '已有明细 → 不显示「这餐不吃」');

console.log('=== 4. 完成度统计（饮食分类默认不计入今日完成，需显式打开）===');
S.getDietCat().countInStats = true;
S.renderCheckin();
const progress = getEl('progressCount').innerHTML;
// 分母 = 三餐（都设了目标）+ 健康分类 1 项 = 4；分子 = 标不吃的那一餐
ok(/<span class="done">1<\/span> \/ 4/.test(progress), '标不吃计入今日完成（1/4）');
S.getDietCat().countInStats = false;

console.log('=== 5. 连续天数与累计次数 ===');
seed({ dietSkipped: {} });
S.setDietMealSkipped(TODAY(), 'lunch', true);
ok(S.getDietMealStreak('lunch') === 1, '连续天数把不吃算进去');
ok(S.getDietMealTotalCount('lunch') === 1, '累计次数把不吃算进去');

console.log('=== 6. 有明细时不许标不吃 ===');
seed({ diets: {} });
S.getDietEntries(TODAY()).push({ id: 'd1', meal: 'dinner', foodId: 'f1', name: '苹果', kcal: 52, qty: 1, unit: 'serving' });
ok(S.setDietMealSkipped(TODAY(), 'dinner', false) === true, '取消标记总能成功');
ok(S.setDietMealSkipped(TODAY(), 'dinner', true) === false, '有明细时标不吃被拒');
const dn = S.mealState(TODAY()).find(x => x.key === 'dinner');
ok(dn.skipped === false, '被拒后状态没变');

console.log('=== 7. 取消不吃 ===');
seed();
S.setDietMealSkipped(TODAY(), 'breakfast', true);
S.setDietMealSkipped(TODAY(), 'breakfast', false);
const bf2 = S.mealState(TODAY()).find(x => x.key === 'breakfast');
ok(bf2.skipped === false && bf2.done === false, '取消后回到未完成');
ok(!S.isDietMealSkipped(TODAY(), 'breakfast'), '取消后不再有不吃标记');

console.log('=== 8. 趋势图：不吃当天画 0 ===');
seed();
S.setDietMealSkipped(TODAY(), 'breakfast', true);
ok(S.dietMealSumOf(TODAY(), 'breakfast') === 0, '标不吃那天返回 0（不是 null）');
const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return S.formatDate(d); })();
ok(S.dietMealSumOf(yesterday, 'breakfast') === null, '没记的那天仍返回 null（折线跳过）');

console.log('=== 9. 脏数据清洗 ===');
seed({ dietSkipped: { 'not-a-date': { lunch: true }, [TODAY()]: { lunch: 'yes', dinner: true }, 'k': null } });
ok(!S.isDietMealSkipped('not-a-date', 'lunch'), '非法日期被清掉');
ok(S.isDietMealSkipped(TODAY(), 'lunch') === false, '非 true 值被清掉');
ok(S.isDietMealSkipped(TODAY(), 'dinner') === true, '合法 true 保留');
S.commit();
const saved = JSON.parse(store['checkin_app_data'] || '{}');
ok(!saved.dietSkipped || saved.dietSkipped['not-a-date'] === undefined, '提交落盘的数据里也清掉了');

console.log('=== 10. 剩余千卡恒 ≥ 0 ===');
seed();
S.getDietEntries(TODAY()).push({ id: 'd2', meal: 'lunch', foodId: 'f1', name: '大餐', kcal: 900, qty: 1, unit: 'serving' });
S.openDietMealModal('lunch');
const inner = getEl('dietModalInner').innerHTML;
ok(!/剩余 -/.test(inner), '不出现负数剩余');
ok(/剩余 0 千卡/.test(inner), '超出时剩余显示 0 千卡');
ok(/超出 200 千卡/.test(inner), '同时给出超出金额');

console.log(fail === 0 ? '\nPASS' : `\nFAIL (${fail})`);
process.exit(fail === 0 ? 0 : 1);
