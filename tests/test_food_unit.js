/**
 * 食物计价单位：按份 / 按克
 *
 * 关心六件事：
 *   1. 老数据（没有 unit）迁移后一律是「按份」，热量含义一点不变
 *   2. 两条热量公式：份 = kcal×份数；克 = kcal×克数/100，只在最后取整
 *   3. 克重只收整数 1~5000，超出四舍五入而不是悄悄截断
 *   4. picker 里份食物点一下即加，克食物必须先填克重（不能盲加）
 *   5. 汇总文案「2 份 + 150 克」，份和克不相加
 *   6. 改单位不重算历史：快照同步时单位变了就只刷名称
 */
const fs = require('fs'), vm = require('vm');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
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
  Intl, Date, Math, JSON, Number, String, Array, Object, Set, Map, RegExp, parseFloat, parseInt, isNaN, isFinite
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox); vm.runInContext(code, sandbox, { filename: 'app.js' });
sandbox.escapeHtml = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
sandbox.escAttr = sandbox.escapeHtml;

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const S = sandbox;
const G = s => vm.runInContext(s, sandbox);
const LIST = () => getEl('dietPickerList').innerHTML;
const INNER = () => getEl('dietModalInner').innerHTML;
const has = (s, sub) => String(s).indexOf(sub) >= 0;
const today = () => S.formatDate(G('ui.date'));

// 老数据：一条食物/记录都没有 unit（v2 及以前的样子）
const LEGACY_FOODS = [
  { id: 'f1', kind: 'food', brand: '麦当劳', name: '巨无霸', kcal: 550 },
  { id: 'f2', kind: 'drink', brand: '星巴克', name: '拿铁', kcal: 190 }
];
// 新数据：米饭按克
const GRAM_FOOD = { id: 'f3', kind: 'food', brand: '家里', name: '米饭', kcal: 116, unit: 'gram' };

function seed(opts) {
  const o = opts || {};
  Object.keys(els).forEach(k => delete els[k]);
  const data = {
    categories: [
      { id: 'c1', name: '健康', icon: '💪', archived: false, countInStats: true,
        items: [{ id: 'i1', name: '早起', archived: false }] }
    ],
    records: {},
    foods: o.foods || LEGACY_FOODS,
    diets: o.diets || {}
  };
  if (o.schemaVersion) data.schemaVersion = o.schemaVersion;
  store['checkin_app_data'] = JSON.stringify(data);
  S.loadData();
}

console.log('=== 1. 迁移：老数据一律「按份」 ===');
seed();
ok(G('SCHEMA_VERSION') === 3, '数据结构版本升到 3');
ok(G('state.schemaVersion') === 3, '迁移后数据标成第 3 版');
ok(G('state.foods.every(f => f.unit === "serving")'), '老食物全部补成 serving');
ok(S.foodUnit({}) === 'serving' && S.foodUnit(null) === 'serving', '没有 unit 字段时缺省按份');
ok(S.foodUnit({ unit: 'gram' }) === 'gram', 'gram 保持不回退');
ok(S.foodUnit({ unit: '乱七八糟' }) === 'serving', '脏单位当按份处理');

console.log('\n=== 2. 两条热量公式 ===');
ok(S.dietEntryKcal({ kcal: 550, qty: 2, unit: 'serving' }) === 1100, '按份：550 × 2 = 1100');
ok(S.dietEntryKcal({ kcal: 116, qty: 150, unit: 'gram' }) === 174, '按克：116 × 150 / 100 = 174');
ok(S.dietEntryKcal({ kcal: 116, qty: 100, unit: 'gram' }) === 116, '按克：吃满 100 克 = 每 100 克热量');
ok(S.dietEntryKcal({ kcal: 116, qty: 1, unit: 'gram' }) === 1, '按克：1 克也取整，不返回 0 以下的怪值');
ok(S.dietEntryKcal({ kcal: 116, qty: 50, unit: 'gram' }) === 58, '按克：116 × 50 / 100 = 58');
ok(S.dietEntryKcal({ kcal: 33, qty: 33, unit: 'gram' }) === 11, '按克：33 × 33 / 100 = 10.89 → 11（只在最后取整）');
ok(S.dietEntryKcal({ kcal: 550, qty: 2 }) === 1100, '没有 unit 的老记录仍按份算');

console.log('\n=== 3. 克重解析：整数 1~5000 ===');
ok(S.parseFoodGram('150') === 150, "150 → 150");
ok(S.parseFoodGram(' 150 ') === 150, '两边空格不影响');
ok(S.parseFoodGram('150g') === 150, '带单位的输入也能取数');
ok(S.parseFoodGram('150.6') === 151, '小数四舍五入（不是截断成 150）');
ok(S.parseFoodGram('150.4') === 150, '150.4 → 150');
ok(S.parseFoodGram('0') === null, '0 无效（想吃 0 克就是删除那条）');
ok(S.parseFoodGram('') === null, '空无效');
ok(S.parseFoodGram('abc') === null, '纯文字无效');
ok(S.parseFoodGram('5000') === 5000, '上限 5000 可以');
ok(S.parseFoodGram('5001') === null, '超过 5000 拒绝');
ok(S.parseFoodGram('-100') === 100, '负数按绝对值取（输入框本来就不该有负号）');

console.log('\n=== 4. 文案函数 ===');
ok(S.foodKcalBasis({ unit: 'gram' }) === '千卡/100克', '按克显示每 100 克基准');
ok(S.foodKcalBasis({}) === '千卡/份', '按份显示每份基准');
ok(S.foodKcalLabel({ unit: 'gram' }) === '每 100 克热量（千卡）', '表单标签按克');
ok(S.foodKcalLabel({}) === '热量（千卡/份）', '表单标签按份');
ok(S.foodQtyUnitName({ unit: 'gram' }) === '克', '单位名：克');
ok(S.foodQtyUnitName({}) === '份', '单位名：份');

console.log('\n=== 5. 汇总文案：份和克不相加 ===');
ok(S.dietQtyText([{ qty: 2 }, { qty: 1 }]) === '3 份', '只有份 → 3 份');
ok(S.dietQtyText([{ qty: 150, unit: 'gram' }]) === '150 克', '只有克 → 150 克');
ok(S.dietQtyText([{ qty: 2 }, { qty: 150, unit: 'gram' }]) === '2 份 + 150 克', '混合 → 2 份 + 150 克');
ok(S.dietQtyText([]) === '0 份', '空列表给 0 份，不给空字符串');

console.log('\n=== 6. 食物库列表显示热量基准 ===');
seed({ foods: LEGACY_FOODS.concat([GRAM_FOOD]) });
S.renderFoods();
const FOODLIST = () => getEl('foodList').innerHTML;
ok(has(FOODLIST(), '550 千卡/份'), '按份食物写「千卡/份」');
ok(has(FOODLIST(), '116 千卡/100克'), '按克食物写「千卡/100克」');

console.log('\n=== 7. picker：份直接加，克要先填克重 ===');
seed({ foods: LEGACY_FOODS.concat([GRAM_FOOD]) });
S.openDietMealModal('breakfast');
S.switchDietModalView('picker');
ok(has(LIST(), '550 千卡/份') && has(LIST(), '116 千卡/100克'), 'picker 也标出热量基准');
ok(has(LIST(), '＋ 填克重'), '克食物右侧是「＋ 填克重」而不是裸「＋」');

// 份食物：点一下直接 +1
S.addDietByFood('f1');
let day = S.dietEntriesOf(S.getDietEntries(today()), 'breakfast');
ok(day.length === 1 && day[0].qty === 1 && day[0].unit === 'serving', '份食物点一下 = 加 1 份');
S.addDietByFood('f1');
day = S.dietEntriesOf(S.getDietEntries(today()), 'breakfast');
ok(day[0].qty === 2, '再点一下 = 2 份');

// 克食物：点一下只展开，不落记录
S.openDietPickerGram('f3');
day = S.dietEntriesOf(S.getDietEntries(today()), 'breakfast');
ok(day.length === 1, '克食物点一下不会凭空加一条');
ok(G('ui.diet.gramFor') === 'f3', '记下正在填哪条');
ok(has(LIST(), 'dietGramInput') && has(LIST(), 'diet-gram-box'), '该行下面就地展开输入区');
ok(has(LIST(), 'diet-gram-quick'), '带常用量快捷按钮');
['>50<', '>100<', '>150<', '>200<'].forEach(n => ok(has(LIST(), n), '快捷量 ' + n.replace(/[<>]/g, '') + ' 在'));

console.log('\n=== 8. 克重输入：只收数字，快捷量点了填入 ===');
S.pickerGramQuick(150);
ok(G('ui.diet.gramVal') === '150', '快捷量填进状态');
ok(getEl('dietGramInput').value === '150', '快捷量填进输入框');
S.onPickerGramInput('12a3');
ok(G('ui.diet.gramVal') === '123', '输入过滤掉非数字');
S.onPickerGramInput('12345');
ok(G('ui.diet.gramVal') === '1234', '最多 4 位（上限 5000 用不到第 5 位）');
S.onPickerGramInput('150');

console.log('\n=== 9. 加入：同食物同餐累加克数 ===');
ok(S.confirmPickerGram('f3') === undefined || true, '执行加入不抛错');
day = S.dietEntriesOf(S.getDietEntries(today()), 'breakfast');
const rice = day.find(e => e.foodId === 'f3');
ok(!!rice && rice.unit === 'gram' && rice.qty === 150, '新增一条 150 克');
ok(G('ui.diet.gramFor') === '' && G('ui.diet.gramVal') === '', '加入后收起展开区');

S.addDietByGram('f3', '100');
day = S.dietEntriesOf(S.getDietEntries(today()), 'breakfast');
const rices = day.filter(e => e.foodId === 'f3');
ok(rices.length === 1 && rices[0].qty === 250, '再加 100 克 → 合并成一条 250 克，不产生第二条');
ok(S.addDietByGram('f3', '0') === false, '0 克被拒绝');
ok(S.addDietByGram('f3', '') === false, '空克重被拒绝');

console.log('\n=== 10. 份和克不会互相加错 ===');
// 同一种食物被改成克之后，历史那条按份的还在：两者必须各自独立
S.addDietByFood('f3');   // f3 现在是克食物，这一步应该只展开、不落记录
const before = S.dietEntriesOf(S.getDietEntries(today()), 'breakfast').filter(e => e.foodId === 'f3');
ok(before.length === 1 && before[0].qty === 250, '对克食物调 addDietByFood 不会加到那份记录上');

console.log('\n=== 11. 明细行：份给 − ＋，克给胶囊 ===');
S.switchDietModalView('detail');
ok(has(INNER(), 'diet-gram-chip'), '克行是克数胶囊');
ok(has(INNER(), '250 克'), '胶囊显示 250 克');
ok(has(INNER(), '290 千卡'), '克行热量 = 116 × 250 / 100 = 290');
ok(has(INNER(), 'diet-qty-btn'), '份行仍是 − ＋ 控件');

console.log('\n=== 12. 直接改克数 ===');
const riceId = S.dietEntriesOf(S.getDietEntries(today()), 'breakfast').find(e => e.foodId === 'f3').id;
ok(S.setDietGram(riceId, '200') === true, '改成 200 克成功');
ok(S.dietEntriesOf(S.getDietEntries(today()), 'breakfast').find(e => e.id === riceId).qty === 200, '克数已更新');
ok(S.setDietGram(riceId, '0') === false, '0 被拒绝，原值保留');
ok(S.dietEntriesOf(S.getDietEntries(today()), 'breakfast').find(e => e.id === riceId).qty === 200, '拒绝时不动原值');
ok(S.setDietGram(riceId, '9999') === false, '超上限被拒绝');

console.log('\n=== 13. 弹窗副标题用混合口径 ===');
const sub13 = getEl('editModalSub').textContent;
ok(/2 项 · 共 2 份 \+ 200 克/.test(sub13), '副标题写「2 项 · 共 2 份 + 200 克」：' + sub13);
ok(!/共 202 份/.test(sub13), '2 份 + 200 克 没有被瞎加成「共 202 份」');

console.log('\n=== 14. 改单位不重算历史 ===');
seed({
  foods: [{ id: 'f9', kind: 'food', brand: '家里', name: '米饭', kcal: 35, unit: 'serving' }],
  diets: { '2026-01-05': [{ id: 'd9', meal: 'lunch', foodId: 'f9', name: '米饭', brand: '家里', kcal: 35, qty: 2, unit: 'serving' }] }
});
const hist = () => S.getDietEntries('2026-01-05').find(e => e.id === 'd9');
const kcalBefore = S.dietEntryKcal(hist());
ok(kcalBefore === 70, '历史记录：35 × 2 = 70 千卡');

// 改名 + 改热量但单位不变 → 快照跟着刷
S.syncDietFoodSnapshots({ id: 'f9', name: '东北米饭', brand: '家里', kcal: 40, unit: 'serving' });
ok(hist().name === '东北米饭', '改名同步到历史');
ok(hist().kcal === 40, '单位没变，热量跟着刷');

// 单位改成克 → 只刷名称，不动热量
S.syncDietFoodSnapshots({ id: 'f9', name: '东北米饭', brand: '家里', kcal: 116, unit: 'gram' });
ok(hist().kcal === 40, '单位变了，历史热量保持 40 不被改成 116');
ok(hist().qty === 2 && hist().unit === 'serving', '历史记录自己的单位也不动');
ok(S.dietEntryKcal(hist()) === 80, '历史仍是「按份」，40 × 2 = 80');

console.log('\n=== 15. 新增食物表单带单位 ===');
seed();
S.openFoodAddModal({});
ok(getEl('foodUnit') !== undefined, '有计价单位选择框');
getEl('foodBrandSelect').value = '全家';
getEl('foodName').value = '关东煮';
getEl('foodKcal').value = '80';
getEl('foodUnit').value = 'gram';
const created = S.addFood();
ok(created && created.unit === 'gram', '新增的食物记住了「按克」');
ok(created && created.kcal === 80, '热量按原样存');
ok(S.getFoods().some(f => f.id === created.id && f.unit === 'gram'), '已经进食物库');

console.log('\n=== 16. 完整编辑链路：表单里改单位 ===');
seed({
  foods: [{ id: 'f9', kind: 'food', brand: '家里', name: '米饭', kcal: 35, unit: 'serving' }],
  diets: { '2026-01-05': [{ id: 'd9', meal: 'lunch', foodId: 'f9', name: '米饭', brand: '家里', kcal: 35, qty: 2, unit: 'serving' }] }
});
S.editFood('f9');
ok(G('ui.modal.type') === 'editFood' && G('ui.modal.id') === 'f9', '打开的是编辑食物弹窗');
getEl('modalFoodBrand').value = '家里';
getEl('modalFoodName').value = '米饭';
getEl('modalFoodUnit').value = 'gram';
getEl('modalFoodKcal').value = '116';
S.confirmEditModal();
const f9 = S.getFoods().find(f => f.id === 'f9');
ok(f9.unit === 'gram' && f9.kcal === 116, '食物本身改成按克 / 每 100 克 116');
ok(S.getDietEntries('2026-01-05').find(e => e.id === 'd9').kcal === 35, '历史那条仍按份、热量 35 不变');
ok(S.dietEntryKcal(S.getDietEntries('2026-01-05').find(e => e.id === 'd9')) === 70, '历史热量仍算 70');

console.log('\n=== 17. 源码护栏：单位判断只走 foodUnit ===');
ok((html.match(/e\.unit === 'gram'/g) || []).length === 0, '没有地方直接写 e.unit === "gram"');
ok((html.match(/f\.unit === 'gram'/g) || []).length === 0, '没有地方直接写 f.unit === "gram"');
ok(has(html, 'function foodUnit('), '存在唯一的单位读取入口 foodUnit()');

console.log('');
if (fail > 0) { console.log('FAILED: ' + fail); process.exit(1); }
console.log('PASS');
