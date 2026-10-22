// 新鲜度测试：每个写操作执行完后，当前 tab 的每个容器都必须是最新的。
//
// 判定方式是「和全量重绘的结果逐字比对」，不需要人工枚举「这个操作该刷新哪几块」：
//   1. 切到目标 tab，全量画一次（预热）
//   2. 执行写操作（内部走 commit，自动重画）
//   3. 记录当前容器快照 A
//   4. 再全量重画一次，记录快照 B（金标准）
//   5. A === B 才算过
//
// 这条断言专门抓「同屏有两块界面，只刷了一块」这类漏刷。
// 第三层之前，勾选打卡项后日历那一格不会更新，这个测试会红。
const fs = require('fs'), vm = require('vm'), path = require('path');
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
    createElement: () => makeEl('c'), addEventListener() {}, body: makeEl('b'),
    documentElement: makeEl('h'), scrollingElement: makeEl('scroller'), visibilityState: 'visible'
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
sandbox.escapeHtml = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// vm 里 let/const 是词法绑定，不会挂到 sandbox 上
const G = expr => vm.runInContext(expr, sandbox);
const S = sandbox;

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };

// 每个 tab 里「重绘会改到」的全部容器，和 TAB_RENDERERS 一一对应
const CONTAINERS = {
  checkin: ['dateValue', 'dayLabel', 'todayBtn', 'progressCount', 'progressBar', 'calendarGrid', 'calMonthLabel', 'checkinList'],
  manage:  ['manageList'],
  foods:   ['foodList', 'foodSearch'],
  stats:   ['statsList', 'statsSummary', 'statsPeriodLabel', 'statsCustomRange']
};
const cell = id => {
  const el = getEl(id);
  return id + '\u0001' + String(el.innerHTML || '') + '\u0001' + String(el.textContent || '') + '\u0001' + String(el.value || '');
};
const snap = tab => (CONTAINERS[tab] || []).map(cell).join('\u0002');

// 固定夹具：两个普通分类（含一个量化项）+ 饮食分类 + 两个食物 + 一条今天的饮食记录
function reset() {
  S.loadDefaultData();
  G('ensureDietCategory(); ensureStateShape();');
  G(`state.categories[0].items.push({ id: 'q1', name: '喝水', archived: false, quant: { unit: '杯', target: 8, compare: 'gte' } })`);
  G(`state.foods.length = 0;
     state.foods.push({ id: 'f1', kind: 'food', brand: '包子铺', name: '肉包', kcal: 300 });
     state.foods.push({ id: 'f2', kind: 'drink', brand: '便利店', name: '豆浆', kcal: 120 });`);
  G(`ui.date = new Date(); ui.calMonth = new Date(); ui.diet.view = 'detail'; ui.diet.meal = 'breakfast'; ui.modal = null;`);
}

const today = () => G('formatDate(new Date())');
const firstPlainItem = () => G('state.categories[0].items.find(i => !i.archived && !i.quant)');
const firstCat = () => G('state.categories[0]');

const CASES = [
  // ---- 打卡页：写操作必须把同屏的日历 / 进度一起刷新 ----
  ['checkin', '勾选打卡项 → 日历当天数字跟着变', () => {
    const it = firstPlainItem();
    S.toggleCheckin(it.id);
  }],
  ['checkin', '取消勾选 → 日历数字回退', () => {
    const it = firstPlainItem();
    S.toggleCheckin(it.id);
    S.toggleCheckin(it.id);
  }],
  ['checkin', '记录量化值 → 进度与日历同时更新', () => S.setQuantValue('q1', 5)],
  ['checkin', '写备注 → 卡片行内小字出现', () => {
    const it = firstPlainItem();
    S.setNote(it.id, '今天很顺利');
  }],
  ['checkin', '改餐次备注 → 饮食行同步', () => S.setDietMealNote(today(), 'breakfast', '吃了两个包子')],
  ['checkin', '弹窗记账 → 卡片 / 进度 / 日历全部更新', () => {
    S.openDietMealModal('breakfast');
    S.addDietByFood('f1');
  }],
  ['checkin', '弹窗删记录 → 同上', () => {
    S.openDietMealModal('breakfast');
    S.addDietByFood('f1');
    const entry = G(`getDietEntries(formatDate(new Date()))[0]`);
    S.removeDietEntry(entry.id);
  }],
  ['checkin', '切换日期 → 日期栏与日历高亮同步', () => S.changeDate(-1)],
  ['checkin', '回到今天 → 同上', () => { S.changeDate(-3); S.goToday(); }],

  // ---- 管理页 ----
  ['manage', '上移分类', () => S.moveCategory(firstCat().id, 1)],
  ['manage', '切换纳入统计', () => S.toggleCountInStats(firstCat().id)],
  ['manage', '切换启用', () => S.toggleCatEnabled(firstCat().id)],
  ['manage', '添加打卡项', () => S.addItem(firstCat().id, { value: '新打卡项' })],
  ['manage', '添加分类', () => {
    getEl('newCatName').value = '临时分类';
    getEl('newCatCountInStats').checked = true;
    S.addCategory();
  }],
  ['manage', '归档打卡项', () => S.archiveItem(firstCat().id, firstPlainItem().id)],
  ['manage', '恢复打卡项', () => {
    const cat = firstCat(); const it = firstPlainItem();
    S.archiveItem(cat.id, it.id);
    S.restoreItem(cat.id, it.id);
  }],
  ['manage', '彻底删除打卡项', () => S.permanentDeleteItem(firstCat().id, firstPlainItem().id)],
  ['manage', '归档分类', () => S.archiveCategory(firstCat().id)],
  ['manage', '恢复分类', () => { const id = firstCat().id; S.archiveCategory(id); S.restoreCategory(id); }],
  ['manage', '彻底删除分类', () => S.permanentDeleteCategory(firstCat().id)],

  // ---- 食物库 ----
  ['foods', '新增食物', () => {
    getEl('foodKind').value = 'food';
    getEl('foodBrandSelect').value = '便利店';
    getEl('foodName').value = '饭团';
    getEl('foodKcal').value = '200';
    S.addFood();
  }],
  ['foods', '删除食物', () => S.deleteFood('f2')],
];

const HEAD = {
  checkin: '=== 打卡页：同屏容器必须一起刷新 ===',
  manage:  '=== 管理页 ===',
  foods:   '=== 食物库 ==='
};

let lastTab = null;
CASES.forEach(([tab, label, act]) => {
  if (tab !== lastTab) { console.log('\n' + HEAD[tab]); lastTab = tab; }
  let err = null;
  reset();
  S.switchTab(tab);          // 预热：全量画一次
  try { act(); } catch (e) { err = e; }
  if (err) { fail++; console.log(`  ✗ ${label}｜抛异常: ${err.message}`); return; }
  const afterWrite = snap(tab);
  S.paintCurrentTab();       // 金标准：再全量画一次
  const gold = snap(tab);

  if (afterWrite === gold) { console.log(`  ✓ ${label}`); return; }

  fail++;
  console.log(`  ✗ ${label}`);
  const ids = CONTAINERS[tab];
  const aParts = afterWrite.split('\u0002'), bParts = gold.split('\u0002');
  ids.forEach((id, i) => {
    if (aParts[i] !== bParts[i]) {
      const a = aParts[i] || '', b = bParts[i] || '';
      let k = 0; while (k < a.length && a[k] === b[k]) k++;
      console.log(`      ${id} 没刷新`);
      console.log(`        现在是  …${a.slice(Math.max(0, k - 40), k + 80).replace(/\s+/g, ' ')}`);
      console.log(`        应该是  …${b.slice(Math.max(0, k - 40), k + 80).replace(/\s+/g, ' ')}`);
    }
  });
});

console.log('\n=== 设计边界（只刷当前 tab，不刷看不见的 tab）===');
reset();
S.switchTab('manage');
S.toggleCountInStats(firstCat().id);
const manageAfter = String(getEl('manageList').innerHTML);
S.switchTab('checkin');
const checkinAfter = String(getEl('checkinList').innerHTML);
S.paintCurrentTab();
ok(checkinAfter === String(getEl('checkinList').innerHTML), '切到打卡页时已重画成最新（不是陈旧缓存）');
ok(manageAfter.length > 0, '管理页容器仍有内容');

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED'));
process.exit(fail === 0 ? 0 : 1);
