// 冒烟测试：把每条界面路径都点一遍，只验证「不抛异常 + 关键容器有内容」。
// 目的不是断言业务细节（那是其他 3 套的事），而是保证重构后没有哪条交互路径被改断。
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
sandbox.escapeHtml = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const S = sandbox;
// vm 里 const/let 是词法绑定，不会挂到 sandbox 上；必须用 runInContext 读
const G = expr => vm.runInContext(expr, sandbox);
const html_ = id => String(getEl(id).innerHTML);

// 反复调用同一个交互，只关心是否抛异常
function act(label, fn, assertFn) {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  if (err) { fail++; console.log(`  ✗ ${label} 抛异常: ${err.message}`); return; }
  if (assertFn) { const r = assertFn(); ok(!!r, label); }
  else ok(true, label);
}

console.log('\n=== 1. 状态容器形状（重构后新增的两组状态）===');
const uiShape = G('typeof ui === "object" && Object.keys(ui).sort().join(",")') || '';
const syncShape = G('typeof sync === "object" && Object.keys(sync).sort().join(",")') || '';
ok(uiShape.indexOf('date') >= 0, '存在 ui 对象');
ok(syncShape.indexOf('user') >= 0, '存在 sync 对象');
ok(uiShape === 'calMonth,calendarOpen,customRange,date,diet,foodFilter,icon,modal,period,statsOffset',
  'ui 键集合符合预期: ' + uiShape);
ok(syncShape === 'inFlight,lastAt,mode,pushTimer,timer,user', 'sync 键集合符合预期: ' + syncShape);
ok(G('Object.keys(ui.diet).sort().join(",")') === 'kw,meal,view', 'ui.diet 三个字段齐备');

console.log('\n=== 2. 本地存储键（TDZ 修复后仍能取到）===');
ok(S.getStorageKey() === G('STORAGE_KEY'), '未登录时用默认键');
G('sync.user = { id: "u-1" }');
ok(S.getStorageKey() === 'checkin_app_data_u-1', '登录后按 user id 分键');
G('sync.user = null');

console.log('\n=== 3. 默认数据 + 四个 tab 全渲染 ===');
S.loadDefaultData();
act('renderCheckin 有内容', () => S.renderCheckin(), () => html_('checkinList').length > 0);
['stats', 'manage', 'foods', 'checkin'].forEach(t => act(`switchTab('${t}')`, () => S.switchTab(t)));
ok(html_('manageList').length > 0, '管理页渲染出分类');
ok(html_('foodList').length > 0, '食物库渲染出条目');

console.log('\n=== 4. 日期与日历导航 ===');
act('toggleCalendar 打开', () => S.toggleCalendar());
ok(G('ui.calendarOpen') === true, 'ui.calendarOpen 被置 true');
act('calendarGrid 有内容', () => S.renderCalendar(), () => html_('calendarGrid').length > 0);
act('changeCalMonth(-1)', () => S.changeCalMonth(-1));
act('changeCalMonth(+1)', () => S.changeCalMonth(1));
const todayKey = S.formatDate(new Date());
act('selectCalDate(今天)', () => S.selectCalDate(todayKey));
act('changeDate(-1)', () => S.changeDate(-1));
act('changeDate(+1)', () => S.changeDate(1));
act('goToday', () => S.goToday());
ok(S.formatDate(G('ui.date')) === todayKey, 'goToday 回到今天');
act('toggleCalendar 关闭', () => S.toggleCalendar());
ok(G('ui.calendarOpen') === false, 'ui.calendarOpen 被置 false');

console.log('\n=== 5. 统计周期切换 ===');
['week', 'month', 'year'].forEach(pd => {
  act(`switchPeriod('${pd}')`, () => S.switchPeriod(pd));
  ok(G('ui.period') === pd, `ui.period === '${pd}'`);
  ok(html_('statsList').length > 0, `${pd} 周期统计页有内容`);
});
act('switchPeriod(custom)', () => S.switchPeriod('custom'));
getEl('statsCustomStart').value = todayKey;
getEl('statsCustomEnd').value = todayKey;
act('applyStatsCustomRange', () => S.applyStatsCustomRange());
act('changeStatsOffset(-1)', () => S.changeStatsOffset(-1));
act('changeStatsOffset(+1)', () => S.changeStatsOffset(1));
act('resetStatsOffset', () => S.resetStatsOffset());
ok(G('ui.statsOffset') === 0, 'resetStatsOffset 归零');
act('回到 week', () => S.switchPeriod('week'));

console.log('\n=== 6. 食物库筛选与搜索 ===');
['drink', 'food', 'all'].forEach(f => {
  act(`setFoodFilter('${f}')`, () => S.setFoodFilter(f));
  ok(G('ui.foodFilter') === f, `ui.foodFilter === '${f}'`);
});
getEl('foodSearch').value = '咖啡';
act('搜索 renderFoods', () => S.renderFoods());
getEl('foodSearch').value = '';

console.log('\n=== 7. 通用弹窗：打开 / 关闭 / 各分支 ===');
act('openEditModal', () => S.openEditModal('标题', '副标题', '<div>x</div>', { type: 'editCat' }, '确定'));
ok(G('ui.modal') && G('ui.modal').type === 'editCat', 'ui.modal 记住上下文');
act('closeEditModal', () => S.closeEditModal());
ok(G('ui.modal') === null, '关闭后 ui.modal 归 null');
S.loadDefaultData();
const firstItem = G('state').categories.flatMap(c => c.items || []).filter(S.isQuantItem)[0];
act('openQuantInput(首个量化项)', () => { if (firstItem) S.openQuantInput(firstItem.id); });
act('closeEditModal', () => S.closeEditModal());
act('openNoteModal', () => { if (firstItem) S.openNoteModal(firstItem.id); });
act('clearNoteNow', () => S.clearNoteNow());

console.log('\n=== 8. 分类菜单与折叠 ===');
const cat = G('state').categories.filter(c => !c.archived)[0];
act('toggleCatMenu', () => S.toggleCatMenu(cat.id));
act('closeAllMenus', () => S.closeAllMenus());

console.log('\n=== 9. 饮食：记账弹窗两视图 ===');
S.loadDefaultData();
act('openDietMealModal(breakfast)', () => S.openDietMealModal('breakfast'));
ok(G('ui.diet.meal') === 'breakfast', 'ui.diet.meal 跟随');
ok(G('ui.diet.view') === 'detail', '默认 detail 视图');
act('切到 picker', () => S.switchDietModalView('picker'));
ok(G('ui.diet.view') === 'picker', 'ui.diet.view 切到 picker');
act('picker 搜索', () => { getEl('dietPickerSearch') || getEl('dietSearch'); S.onDietPickerSearch('牛奶'); });
ok(G('ui.diet.kw') === '牛奶', 'ui.diet.kw 记住搜索词');
const anyFood = { id: 'f-smoke', kind: 'food', brand: '测试', name: '米饭', kcal: 200 };
G('state').foods.push(anyFood);
act('addDietByFood 加一份', () => { if (anyFood) S.addDietByFood(anyFood.id); });
act('切回 detail', () => S.switchDietModalView('detail'));
const entries = S.getDietEntries(todayKey);
ok(entries.length > 0, '饮食记录已写入 diets');
if (entries.length) {
  act('changeDietQty(+1)', () => S.changeDietQty(entries[0].id, 1));
  act('removeDietEntry', () => S.removeDietEntry(entries[0].id));
}
act('closeEditModal', () => S.closeEditModal());
act('openDietGoalModal', () => S.openDietGoalModal());
ok(html_('editModalBody').indexOf('早餐') >= 0, '目标弹窗有早餐行');
act('closeEditModal', () => S.closeEditModal());

console.log('\n=== 10. 趋势图入口：普通项与饮食伪项 ===');
S.loadDefaultData();
G('state').foods.push({ id: 'f-smoke2', kind: 'food', brand: '测试', name: '面条', kcal: 350 });
S.addDietByFood('f-smoke2');
const dietItem = S.dietTrendItem('lunch');
act('openTrendModal(饮食午餐)', () => S.openTrendModal(dietItem.id));
ok(html_('editModalBody').indexOf('<svg') >= 0, '大图有 svg');
act('closeEditModal', () => S.closeEditModal());
const qItem = G('state').categories.flatMap(c => c.items || []).filter(S.isQuantItem)[0];
act('openTrendModal(普通量化项)', () => { if (qItem) S.openTrendModal(qItem.id); });
act('closeEditModal', () => S.closeEditModal());
['week', 'month', 'year', 'custom'].forEach(pd => {
  const r = S.getPeriodRange(pd, 0);
  ok(r && r.start && r.end, `getPeriodRange('${pd}') 正常`);
});

console.log('\n=== 11. 量化导出：饮食 4 项也在列 ===');
const qi = S.collectQuantItems();
ok(qi.length >= 4, `收集到 ${qi.length} 个量化指标`);
ok(qi.some(o => o.item && o.item.dietMeal === 'breakfast'), '含早餐');
ok(qi.some(o => o.item && o.item.dietMeal === 'total'), '含全天合计');

console.log('\n' + (fail === 0 ? 'ALL PASS' : fail + ' FAILED'));
process.exit(fail === 0 ? 0 : 1);
