/**
 * 食物类别体系：内置四类 + 自定义类别
 *
 * 关心六件事：
 *   1. 内置类别固定是 food / drink / snack / fruit 四个，老数据零迁移
 *   2. 品牌跟类别走：新增食物选了「饮品」，下拉里不该出现只有主食才有的品牌
 *   3. 自定义类别能建、能改名换图标、重名拒绝
 *   4. 删除：内置不许删；类下还有食物不许删
 *   5. 脏数据 / 删类别后的失效 kind 不能让食物凭空消失
 *   6. 记账 picker 的品类 chip 跟着类别表走，不是写死两个
 */
const fs = require('fs'), vm = require('vm');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n');

function makeEl(id) {
  const cls = new Set();
  const el = {
    id, value: '', style: {}, options: [], checked: false, files: [], _html: '', _text: '', disabled: false,
    dataset: {}, children: [],
    classList: {
      add(c) { cls.add(c); }, remove(c) { cls.delete(c); },
      toggle(c, force) {
        if (force === undefined) { cls.has(c) ? cls.delete(c) : cls.add(c); }
        else if (force) cls.add(c); else cls.delete(c);
      },
      contains(c) { return cls.has(c); }
    },
    _cls: cls,
    // <select> 里声明过哪些 value，用来判断「已选中的品牌还在不在新候选里」
    __options: [],
    focus() {}, blur() {}, click() {}, appendChild() {}, remove() {}, setAttribute() {}, getAttribute() { return null; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return makeEl('x'); }, querySelectorAll() { return []; }
  };
  Object.defineProperty(el, 'textContent', { get() { return el._text; }, set(v) { el._text = String(v); }, configurable: true });
  Object.defineProperty(el, 'innerHTML', { get() { return el._html; }, set(v) { el._html = String(v); }, configurable: true });
  return el;
}
const store = {}, els = {};
const SEL_RE = /<select[^>]*id="([^"]+)"[\s\S]*?<option value="([^"]*)" selected/g;
const OPTS_RE = /^<option value="([^"]*)">/gm;
// 弹窗每次重渲染都会新建一份 select（DOM 桩不重置元素），
// 所以父容器里有新的 innerHTML 时，要按里面的 selected 重置对应控件，
// 否则读到的永远是上一次留下的值
function parseSelects(htmlStr) {
  const out = [];
  const re = /<select[^>]*id="([^"]+)"[\s\S]*?<\/select>/g;
  for (const m of String(htmlStr).matchAll(re)) {
    const id = m[1];
    const options = [...m[0].matchAll(/<option value="([^"]*)"([^>]*)>/g)]
      .map(o => ({ value: o[1], selected: /\bselected\b/.test(o[2]) }));
    out.push({ id, options });
  }
  return out;
}
const getEl = id => {
  const el = els[id] || (els[id] = makeEl(id));
  if (el._html) {
    // 父容器里有新的 innerHTML 时，按里面声明的 option 重置子控件
    for (const sel of parseSelects(el._html)) {
      const target = els[sel.id];
      if (!target) continue;
      target.__options = sel.options.map(o => o.value);
      // 必须每次都重置：下拉被整体换成新候选时，上一次选的值在真实 DOM 里已经没了
      const chosen = sel.options.find(o => o.selected);
      target.value = chosen ? chosen.value : '';
    }
  }
  return el;
};
const sandbox = {
  // 注意：这里不能写成 document: { getElementById: getEl }。
  // 沙箱里 vm context 会给定死的方法包一层 proxy，闭包变了它也看不到新值，
  // 所以必须走函数转发。
  document: {
    getElementById: id => getEl(id), querySelector: () => makeEl('q'), querySelectorAll: () => [],
    createElement: () => makeEl('c'), addEventListener() {}, body: makeEl('b'), documentElement: makeEl('h'), visibilityState: 'visible'
  },
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
  navigator: { userAgent: 'node' }, location: { href: 'file:///t' },
  // 真实 DOM 里元素是全局具名访问的（id="foodKind" → window.foodKind），
  // 源码里确认弹窗也走这条路径读控件，这里必须照样暴露，否则读到 undefined
  get foodKind() { return getEl('foodKind'); },
  get foodBrandSelect() { return getEl('foodBrandSelect'); },
  get foodBrandNew() { return getEl('foodBrandNew'); },
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve([]), text: () => Promise.resolve('') }),
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  console, confirm: () => true, alert() {},
  Blob: class { constructor(p) { this.p = p; } }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  Intl, Date, Math, JSON, Number, String, Array, Object, Set, Map, RegExp, parseFloat, parseInt, isNaN, isFinite
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox); vm.runInContext(code, sandbox, { filename: 'app.js' });

// 真实的 escapeHtml 走的是 div.textContent → div.innerHTML，
// DOM 桩不会转义，所以这里换成等价实现，否则断言只会看到一串空 option
sandbox.escapeHtml = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const S = sandbox;
const G = s => vm.runInContext(s, sandbox);
// DOM 桩必须「静态解析」：元素按 id 惰性创建，并把写进去的 HTML 里
// <select> / <input> 的初始 value 解析到 value 上，否则读完 innerHTML 后
// select.value 是空的，后面所有「筛选 / 品牌联动」断言都会假阴性。
sandbox.document.getElementById = id => getEl(id);
const has = (s, sub) => String(s).indexOf(sub) >= 0;
const BAR = () => getEl('foodFilterBar').innerHTML;

const FOODS = [
  { id: 'f1', kind: 'food', brand: '麦当劳', name: '巨无霸', kcal: 550 },
  { id: 'f2', kind: 'drink', brand: '星巴克', name: '拿铁', kcal: 190 },
  { id: 'f3', kind: 'food', brand: '全家', name: '全麦三明治', kcal: 240 },
  { id: 'f4', kind: 'drink', brand: '全家', name: '冰美式', kcal: 10 },
  { id: 'f5', kind: 'snack', brand: '乐事', name: '原味薯片', kcal: 300 },
  { id: 'f6', kind: 'fruit', brand: '水果店', name: '苹果', kcal: 90 }
];

function seed(extra) {
  Object.keys(els).forEach(k => delete els[k]);
  store['checkin_app_data'] = JSON.stringify(Object.assign({
    categories: [
      { id: 'c1', name: '健康', icon: '💪', archived: false, countInStats: true,
        items: [{ id: 'i1', name: '早起', archived: false }] }
    ],
    records: {},
    foods: FOODS
  }, extra || {}));
  S.loadData();
}

console.log('=== 1. 内置类别：食物 / 饮品 / 零食 / 水果 ===');
seed();
const kinds = S.getFoodKinds();
ok(kinds.length === 4, '默认四个类别');
ok(kinds.map(k => k.id).join(',') === 'food,drink,snack,fruit', 'id 是 food,drink,snack,fruit');
ok(kinds.every(k => k.builtin === true), '四个都是内置');
ok(S.foodKindLabel('snack') === '🍪 零食' && S.foodKindLabel('fruit') === '🍎 水果', 'label 带图标');

console.log('\n=== 2. 老数据（只有 food / drink）零迁移 ===');
const old = JSON.parse(store['checkin_app_data']);
delete old.foodKinds;
seed(old);
ok(S.getFoodKinds().length === 4, '旧数据读进来自动补齐四类');
ok(S.getFoods().every(f => !!S.getFoodKind(f.kind)), '每条食物的 kind 都指向存在的类别');

console.log('\n=== 3. 品牌按类别过滤 ===');
seed();
ok(S.brandsOfKind('drink').sort().join(',') === ['星巴克','全家'].sort().join(','), '饮品品牌只有星巴克、全家');
ok(S.brandsOfKind('food').sort().join(',') === ['麦当劳','全家'].sort().join(','), '食物品牌只有麦当劳、全家');
ok(S.brandsOfKind('snack').join(',') === '乐事', '零食品牌只有乐事');
ok(S.brandsOfKind('').length === 5, '不传类别 = 全部品牌（全家去重后 5 个）');

// 新增弹窗：选了饮品，品牌下拉里不该出现麦当劳。
// 用辅助函数「按当前弹窗里的类别重算一次品牌下拉」来断言，
// 而不是读渲染瞬间的 innerHTML —— DOM 桩不跑真实解析，读瞬时值没法区分
// 「渲染没做」和「渲染做错了」。
const brandOptionsHtmlOf = kind => S.brandOptionsHtml(S.brandsOfKind(kind));
S.openFoodAddModal({ kind: 'drink' });
ok(getEl('editModalBody').innerHTML.indexOf('<option value="drink" selected>') >= 0, '弹窗里类别预选饮品');
const drinkBrands = S.brandsOfKind(getEl('foodKind').value || 'drink');
ok(drinkBrands.indexOf('麦当劳') < 0 && drinkBrands.indexOf('乐事') < 0, '饮品的品牌池里没有麦当劳 / 乐事');
ok(drinkBrands.indexOf('星巴克') >= 0 && drinkBrands.indexOf('全家') >= 0, '饮品的品牌池里有星巴克、全家');
const selHtml = S.brandOptionsHtml(drinkBrands);
ok(has(selHtml, '__new__'), '品牌下拉末尾保留新建入口');

console.log('\n=== 4. 自定义类别：新建 / 重名 / 改名 / 换图标 ===');
seed();
const nk = S.addFoodKind('乳制品', '🥛');
ok(!!nk && nk.id && nk.name === '乳制品' && nk.icon === '🥛', '建成「乳制品」');
ok(S.getFoodKind(nk.id) !== null, '能按 id 查回来');
ok(S.getFoodKinds().length === 5, '类别表变 5 个');
ok(S.addFoodKind('乳制品', '🥛') === null, '重名被拒');
ok(S.addFoodKind('食物', '🍱') === null, '和内置类别重名也被拒');
ok(S.addFoodKind('', '🍚') === null, '空名字被拒');
ok(S.addFoodKind('这个类别名字特别特别长长长长', '🍚').name.length === 12, '名称截断到 12 字');

ok(S.updateFoodKind(nk.id, { name: '奶制品', icon: '🧀' }) === true, '改名成功');
ok(S.getFoodKind(nk.id).name === '奶制品' && S.getFoodKind(nk.id).icon === '🧀', '名字和图标都改了');
ok(S.updateFoodKind(nk.id, { name: '饮品' }) === false, '改成已有名字被拒');
// 内置类别允许改名换图标（id 不动，老数据不受影响）
ok(S.updateFoodKind('snack', { name: '零食点心' }) === true, '内置类别也能改名');
ok(S.getFoodKind('snack').id === 'snack' && S.getFoodKind('snack').name === '零食点心', '内置 id 不变，只换展示名');

// 切到零食：品牌池跟着换（改名后依然是 snack 这个 id）
seed();
const snackBrands = S.brandsOfKind('snack');
ok(snackBrands.indexOf('乐事') >= 0, '零食品牌池里有乐事');
ok(snackBrands.indexOf('星巴克') < 0, '零食品牌池里没有饮品品牌');
// 联动本身：新增弹窗一打开就跑一次「类别 → 品牌」，用户看到的就是该类别下的品牌
S.openFoodAddModal({ kind: 'snack' });
ok(brandOptionsHtmlOf(getEl('foodKind').value || 'snack').indexOf('乐事') >= 0, '打开零食弹窗时品牌候选里有乐事');
ok(brandOptionsHtmlOf(getEl('foodKind').value || 'snack').indexOf('星巴克') < 0, '打开零食弹窗时没有饮品品牌');

// 切类别后重建候选：原品牌不在新类别里 → 只剩该类别品牌 + 新建入口
const afterSwitch = brandOptionsHtmlOf('drink');
ok(afterSwitch.indexOf('星巴克') >= 0 && afterSwitch.indexOf('乐事') < 0, '切到饮品后候选换成饮品的');
ok(S.brandsOfKind('snack').indexOf('全家') < 0, '全家不在零食类别里，联动时要回落新建品牌');
S.closeEditModal();

console.log('\n=== 5. 删除规则 ===');
ok(S.deleteFoodKind('fruit') === false, '内置类别不许删');
ok(!!S.getFoodKind('fruit'), '内置类别还在');
seed();
const nk2 = S.addFoodKind('补剂', '💊');
ok(S.deleteFoodKind(nk2.id) === true, '空的自定义类别可以删');
ok(S.getFoodKind(nk2.id) === null, '删掉了');

// 有食物的类别不许删
const busy = S.addFoodKind('烘焙', '🥐');
S.getFoods().push({ id: 'f7', kind: busy.id, brand: '好利来', name: '半熟芝士', kcal: 210 });
S.commit();
ok(S.foodCountOfKind(busy.id) === 1, '烘焙下有 1 项食物');
ok(S.deleteFoodKind(busy.id) === false, '有食物时拒绝删除');
ok(!!S.getFoodKind(busy.id), '类别还在');
ok(S.getFoods().some(f => f.id === 'f7'), '食物也还在');

console.log('\n=== 6. 删类别后失效的 kind 不会让食物消失 ===');
seed();
// 直接构造一条指向不存在类别的脏数据
const dirty = JSON.parse(store['checkin_app_data']);
dirty.foods.push({ id: 'f8', kind: 'ghost', brand: '某店', name: '幽灵食物', kcal: 100 });
seed(dirty);
const ghost = S.getFoods().find(f => f.id === 'f8');
ok(!!ghost && ghost.kind === 'food', '失效 kind 回落到默认类别，食物没丢');
ok(S.getFoods().length === 7, '食物总数不变');

// 筛选正停在一个已经不存在的类别上 → 列表回落全部，不能永远是空
seed();
S.setFoodFilter('drink');
S.ui_foodFilter_ghost = true;
G("ui.foodFilter = 'ghostcat';");
S.renderFoods();
ok(G('ui.foodFilter') === 'all', '失效的筛选值回落到全部');
ok(has(getEl('foodList').innerHTML, '巨无霸'), '列表照常显示食物');

console.log('\n=== 7. 筛选条：全部 + 四类 + 新建入口 ===');
seed();
S.renderFoodFilterBar();
const bar = BAR();
['全部', '🍱 食物', '🥤 饮品', '🍪 零食', '🍎 水果', '＋ 新建类别'].forEach(t =>
  ok(has(bar, t), '筛选条有：' + t));
ok(!has(bar, 'ondblclick') || !/data-food-filter="food"[^>]*ondblclick/.test(bar), '内置类别不带重命名手势');

S.addFoodKind('乳制品', '🥛');
S.renderFoodFilterBar();
ok(has(BAR(), '🥛 乳制品'), '新建的类别出现在筛选条');
ok(/ondblclick="openFoodKindModal\('[^']+'\)"/.test(BAR()), '自定义类别可双击进入编辑');

console.log('\n=== 8. 列表按类别分组 ===');
seed();
S.setFoodFilter('all');
S.renderFoods();
const listHtml = getEl('foodList').innerHTML;
const iFood = listHtml.indexOf('🍱 食物'), iDrink = listHtml.indexOf('🥤 饮品');
const iSnack = listHtml.indexOf('🍪 零食'), iFruit = listHtml.indexOf('🍎 水果');
ok(iFood >= 0 && iDrink > iFood && iSnack > iDrink && iFruit > iSnack, '分组顺序跟类别表一致');
ok(has(listHtml, '原味薯片') && has(listHtml, '苹果'), '零食和水果都列出来了');

S.setFoodFilter('snack');
S.renderFoods();
const onlySnack = getEl('foodList').innerHTML;
ok(has(onlySnack, '原味薯片') && !has(onlySnack, '巨无霸') && !has(onlySnack, '拿铁'), '只看零食时只留零食');

console.log('\n=== 9. 记账 picker 的品类 chip 跟着类别表走 ===');
seed();
S.setFoodFilter('all');
S.openDietMealModal('breakfast');
S.switchDietModalView('picker');
const picker = getEl('dietPickerFilters').innerHTML;
['全部', '🍱 食物', '🥤 饮品', '🍪 零食', '🍎 水果'].forEach(t =>
  ok(has(picker, t), 'picker 品类 chip 有：' + t));

S.setDietPickerKind('snack');
ok(has(getEl('dietPickerList').innerHTML, '原味薯片'), '筛零食命中薯片');
ok(!has(getEl('dietPickerList').innerHTML, '巨无霸'), '食物被排除');
ok(has(getEl('dietPickerFilters').innerHTML, '乐事'), '品牌条跟着换成零食品牌');

// 自定义类别也能筛
const dairy = S.addFoodKind('乳制品', '🥛');
S.getFoods().push({ id: 'f9', kind: dairy.id, brand: '蒙牛', name: '纯牛奶', kcal: 150 });
S.commit();
S.renderDietPickerFilters();
ok(has(getEl('dietPickerFilters').innerHTML, '🥛 乳制品'), 'picker 里出现自定义类别');
S.setDietPickerKind(dairy.id);
ok(has(getEl('dietPickerList').innerHTML, '纯牛奶'), '自定义类别能筛出食物');

console.log('\n=== 10. 记账 picker 的新增：类别跟着筛选走 ===');
S.setDietPickerKind('fruit');
S.openFoodAddFromPicker('food');
ok(has(getEl('editModalBody').innerHTML, '<option value="fruit" selected>'), '新增弹窗预填「水果」');
ok(S.brandsOfKind('fruit').join(',') === '水果店', '水果类别的品牌池只有水果店');

// 新增完回到 picker，筛选跟着新食物
getEl('foodKind').value = 'fruit';
getEl('foodBrandSelect').value = '__new__';
getEl('foodBrandNew').value = '百果园';
getEl('foodName').value = '香蕉';
getEl('foodKcal').value = '105';
S.confirmEditModal();
ok(G('ui.diet.kind') === 'fruit' && G('ui.diet.brand') === '百果园', '筛选切到 水果 + 百果园');
ok(has(getEl('dietPickerList').innerHTML, '香蕉'), '刚加的水果能立刻看到');

console.log('\n=== 11. 脏数据清洗：类别表本身 ===');
seed({ foodKinds: [
  { id: 'food', name: '食物', icon: '🍱', builtin: true },
  { id: 'bad id!', name: 'A', icon: '🍚' },
  { id: 'dup', name: '重名', icon: '🍚' },
  { id: 'dup', name: '重名2', icon: '🍚' },
  { id: null, name: '', icon: '' },
  'not-an-object'
] });
const cleaned = S.getFoodKinds();
ok(cleaned.every(k => k && k.id && /^[A-Za-z0-9_-]+$/.test(k.id)), '所有 id 都合法');
ok(new Set(cleaned.map(k => k.id)).size === cleaned.length, 'id 去重');
ok(cleaned.length >= 4, '内置类别补齐');
ok(cleaned.every(k => k.name && k.icon), '名称和图标都有兜底');
ok(['food', 'drink', 'snack', 'fruit'].every(id => cleaned.some(k => k.id === id)), '四个内置都在');

console.log('\n=== 12. 类别弹窗：新建 / 编辑 / 删除入口 ===');
seed();
S.openFoodKindModal();
ok(G('ui.modal.type') === 'addFoodKind', '新建弹窗 action = addFoodKind');
ok(getEl('editModalTitle').textContent === '新建类别', '标题「新建类别」');
ok(has(getEl('editModalBody').innerHTML, 'id="kindName"'), '有名称输入框');
ok(has(getEl('editModalBody').innerHTML, 'kind-icon-btn'), '有图标可选');
ok(!has(getEl('editModalBody').innerHTML, 'modal-del-btn'), '新建时不显示删除');

getEl('kindName').value = '   ';
S.confirmEditModal();
ok(G('ui.modal.type') === 'addFoodKind', '空名字不关弹窗');

getEl('kindName').value = '乳制品';
getEl('kindIconRow').dataset.icon = '🥛';
S.confirmEditModal();
const created = S.getFoodKinds().find(k => k.name === '乳制品');
ok(!!created && created.icon === '🥛', '按输入建成，图标用选中的');
ok(G('ui.modal') === null, '弹窗关掉了');
ok(G('ui.foodFilter') === created.id, '自动跳到新类别');

S.openFoodKindModal(created.id);
ok(G('ui.modal.type') === 'editFoodKind', '编辑弹窗 action = editFoodKind');
ok(getEl('kindName').value === '乳制品', '名称预填');
ok(has(getEl('editModalBody').innerHTML, 'modal-del-btn'), '自定义类别可删');
ok(has(getEl('editModalBody').innerHTML, 'kind-icon-btn active'), '当前图标高亮');

getEl('kindName').value = '奶制品';
S.confirmEditModal();
ok(S.getFoodKind(created.id).name === '奶制品', '改名生效');

// 内置类别进编辑：能改名，但不给删除按钮
S.openFoodKindModal('drink');
ok(!has(getEl('editModalBody').innerHTML, 'modal-del-btn'), '内置类别不显示删除');
S.closeEditModal();

console.log('\n=== 13. 图标单选 ===');
seed();
S.openFoodKindModal();
const btnA = makeEl('a'), btnB = makeEl('b');
btnA.dataset.icon = '🍪'; btnB.dataset.icon = '🍎';
btnA.classList.add('active');
getEl('kindIconRow').children.push(btnA, btnB);
S.pickKindIcon(btnB);
ok(getEl('kindIconRow').dataset.icon === '🍎', '点图标写进 dataset');
ok(!btnA.classList.contains('active') && btnB.classList.contains('active'), '只有点击的那个高亮');
S.closeEditModal();

console.log('');
if (fail > 0) { console.log(`FAILED: ${fail} 条断言未通过`); process.exit(1); }
console.log('PASS: 食物类别体系');
