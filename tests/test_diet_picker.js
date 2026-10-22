/**
 * 打卡页记账 picker：品类 / 品牌筛选 + 就地新增食物
 *
 * 关心四件事：
 *   1. 筛选条真的能筛（品类一层、品牌一层，是「且」不是「或」）
 *   2. 筛空了也要有出路（直接弹新增，不用退到食物热量页）
 *   3. 新增完自动回到 picker 并加一份，筛选跟着新食物走
 *   4. 品牌名是用户输入，不能拼进 onclick 的字符串字面量
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

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const S = sandbox;
const G = s => vm.runInContext(s, sandbox);
const FILTERS = () => getEl('dietPickerFilters').innerHTML;
const LIST = () => getEl('dietPickerList').innerHTML;
const has = (s, sub) => String(s).indexOf(sub) >= 0;

const FOODS = [
  { id: 'f1', kind: 'food', brand: '麦当劳', name: '巨无霸', kcal: 550 },
  { id: 'f2', kind: 'drink', brand: '星巴克', name: '拿铁', kcal: 190 },
  { id: 'f3', kind: 'food', brand: '全家', name: '全麦三明治', kcal: 240 },
  { id: 'f4', kind: 'drink', brand: '全家', name: '冰美式', kcal: 10 }
];

function seed() {
  Object.keys(els).forEach(k => delete els[k]);
  store['checkin_app_data'] = JSON.stringify({
    categories: [
      { id: 'c1', name: '健康', icon: '💪', archived: false, countInStats: true,
        items: [{ id: 'i1', name: '早起', archived: false }] }
    ],
    records: {},
    foods: FOODS
  });
  S.loadData();
  S.openDietMealModal('breakfast');
  S.switchDietModalView('picker');
}

console.log('=== 1. 默认：全部品类、全部品牌 ===');
seed();
ok(has(FILTERS(), '>全部<') && has(FILTERS(), '🥤 饮品') && has(FILTERS(), '🍱 食物'), '品类三个筛选都在');
ok(has(FILTERS(), '全部品牌'), '有「全部品牌」');
['麦当劳', '星巴克', '全家'].forEach(b => ok(has(FILTERS(), b), '品牌 chip 出现：' + b));
ok(has(LIST(), '巨无霸') && has(LIST(), '拿铁') && has(LIST(), '冰美式'), '默认列出全部食物');
ok(G('ui.diet.kind') === 'all' && G('ui.diet.brand') === '', '默认不设品类 / 品牌筛选');

console.log('\n=== 2. 品类筛选 ===');
S.setDietPickerKind('drink');
ok(G('ui.diet.kind') === 'drink', '品类切到饮品');
ok(has(LIST(), '拿铁') && has(LIST(), '冰美式'), '饮品都留下');
ok(!has(LIST(), '巨无霸') && !has(LIST(), '全麦三明治'), '食物被排除');
ok(!has(FILTERS(), '>麦当劳<'), '品牌条只保留该品类下的品牌');

S.setDietPickerKind('food');
ok(has(LIST(), '巨无霸') && has(LIST(), '全麦三明治') && !has(LIST(), '拿铁'), '切到食物只剩食物');

console.log('\n=== 3. 品牌筛选（与品类是「且」的关系）===');
S.setDietPickerKind('all');
const brands = S.dietPickerBrands('all');
const idxQuan = brands.indexOf('全家') + 1;
S.setDietPickerBrand(idxQuan);
ok(G('ui.diet.brand') === '全家', '品牌切到全家');
ok(has(LIST(), '全麦三明治') && has(LIST(), '冰美式'), '全家两个品类都显示');
ok(!has(LIST(), '巨无霸'), '其它品牌被排除');

S.setDietPickerKind('drink');
ok(has(LIST(), '冰美式') && !has(LIST(), '全麦三明治'), '全家 + 饮品 = 只剩冰美式');
ok(has(LIST(), '已加') === false, '还没加过，不显示「已加」');

console.log('\n=== 4. 搜索与筛选叠加 ===');
S.setDietPickerKind('all');
S.setDietPickerBrand(0);
S.onDietPickerSearch('拿铁');
ok(has(LIST(), '拿铁') && !has(LIST(), '巨无霸'), '搜索命中');
S.onDietPickerSearch('麦当劳');
ok(has(LIST(), '巨无霸') && !has(LIST(), '拿铁'), '按品牌名也能搜到');
S.onDietPickerSearch('');

console.log('\n=== 5. 筛空 / 搜空时，就地给新增入口 ===');
S.onDietPickerSearch('这个不存在');
const emptyList = LIST();
ok(has(emptyList, '没找到'), '给出「没找到」提示');
ok(has(emptyList, '＋ 新增食物'), '列表里直接有「新增食物」按钮');
ok(has(getEl('dietPickerSum').innerHTML, '早餐'), '底部合计仍然在');

S.onDietPickerSearch('');
S.setDietPickerBrand(0);
S.setDietPickerKind('all');

console.log('\n=== 6. 品牌名里有单引号也不会把 onclick 截断 ===');
S.getFoods().push({ id: 'f9', kind: 'food', brand: "Bob's", name: '汉堡', kcal: 400 });
S.renderDietPickerFilters();
const bad = FILTERS().match(/setDietPickerBrand\('[^)]*\)/g) || [];
ok(bad.length === 0, '品牌一律按索引传参，没有拼字符串字面量');
ok(has(FILTERS(), 'Bob&#39;s'), '品牌名做了 HTML 转义');

console.log('\n=== 7. 「＋ 新建品牌」直接打开新增表单 ===');
S.setDietPickerKind('drink');
S.openFoodAddFromPicker('brand');
ok(getEl('foodBrandSelect').value === '__new__', '品牌下拉切到「新建品牌」');
ok(getEl('foodBrandNew').style.display === 'block', '新建品牌输入框展开');
ok(G('ui.modal.type') === 'addFood' && G('ui.modal.fromDiet') === true, '记住来源是记账弹窗');
ok(has(getEl('editModalBody').innerHTML, '<option value="drink" selected>'), '分类预填为当前筛选的饮品');

console.log('\n=== 8. 新增食物 → 自动加一份到当前餐，并回到 picker ===');
getEl('foodKind').value = 'drink';
getEl('foodBrandSelect').value = '__new__';
getEl('foodBrandNew').value = '瑞幸';
getEl('foodName').value = '生椰拿铁';
getEl('foodKcal').value = '180';
S.confirmEditModal();

const newFood = S.getFoods().find(f => f.name === '生椰拿铁');
ok(!!newFood, '食物进库了');
ok(newFood && newFood.brand === '瑞幸' && newFood.kind === 'drink' && newFood.kcal === 180, '分类 / 品牌 / 热量都写对了');

const today = S.formatDate(new Date());
const bfEntries = S.dietEntriesOf(S.getDietEntries(today), 'breakfast');
ok(bfEntries.some(e => e.foodId === newFood.id && e.qty === 1), '自动加了一份进早餐');

ok(G('ui.diet.view') === 'picker', '回到 picker，不是停在详情');
ok(getEl('editModal').classList.contains('diet-modal'), '弹窗回到记账样式');
ok(getEl('editModal').classList.contains('show'), '弹窗仍然是打开状态');

console.log('\n=== 9. 新增后筛选跟着新食物走，能立刻看到它 ===');
ok(G('ui.diet.kind') === 'drink' && G('ui.diet.brand') === '瑞幸', '筛选切到 饮品 + 瑞幸');
ok(has(LIST(), '生椰拿铁'), '刚加的食物出现在列表里');
ok(has(LIST(), '已加'), '并标了「已加」');
ok(S.dietTotalKcal(bfEntries) === 180, '本餐热量 = 180');

console.log('\n=== 10. 食物热量页的新增入口不受影响 ===');
S.closeEditModal();
S.openFoodAddModal();
ok(G('ui.modal.type') === 'addFood' && G('ui.modal.fromDiet') === false, '从食物库进来时 fromDiet 为 false');
ok(getEl('editModalTitle').textContent === '新增食物记录', '标题仍是「新增食物记录」');
ok(!getEl('editModal').classList.contains('diet-modal'), '没有沿用记账样式');

console.log('\n=== 11. 打开记账弹窗时清空筛选（下次进来是干净的）===');
S.setDietPickerKind('drink');
S.setDietPickerBrand(1);
S.openDietMealModal('lunch');
ok(G('ui.diet.kind') === 'all' && G('ui.diet.brand') === '' && G('ui.diet.kw') === '', '重新打开某一餐时筛选复位');

console.log('');
if (fail > 0) { console.log(`FAILED: ${fail} 条断言未通过`); process.exit(1); }
console.log('PASS: 记账 picker 筛选与就地新增');
