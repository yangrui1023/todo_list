// 安全验收（第 5 层）：用户能写字的地方，只能作为文本出现。
//
// 单文件应用里没有框架帮忙转义，只有两个出口：
//   escapeHtml  文本节点
//   escAttr     属性值（浏览器不会替文本节点转义引号，属性必须自己来）
// 另外还有两条不靠转义的防线：
//   · id 白名单 —— id 会被拼进 onclick="fn('id')"，脏 id 等于凭空多一个事件处理器
//   · CSV 公式前缀 —— Excel 会把 = 开头的格子当公式执行
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
const captured = {};
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
  Blob: class { constructor(p, o) { this.p = p; this.o = o; } },
  URL: { createObjectURL: b => { captured.blob = b; return 'blob:x'; }, revokeObjectURL() {} },
  Intl, Date, Math, JSON, Number, String, Array, Object, Set, Map, RegExp, parseFloat, parseInt, isNaN, isFinite,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox, { filename: 'app.js' });
// 桩里 escapeHtml 依赖 div.textContent→innerHTML，这里换成等价实现。
// 注意必须与浏览器行为一致：文本节点里的引号【不】转义，属性转义由 escAttr 负责。
sandbox.escapeHtml = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const S = sandbox;
const G = expr => vm.runInContext(expr, sandbox);
const MG = () => getEl('manageList').innerHTML;
const CK = () => getEl('checkinList').innerHTML;
const MODAL = () => getEl('editModalBody').innerHTML;

const TODAY = () => S.formatDate(new Date());
const XSS = '</span><img src=x onerror=alert(1)>';
const QUOTE = 'x" onmouseover="alert(1)';

function seed(data) {
  Object.keys(els).forEach(k => delete els[k]);
  store['checkin_app_data'] = JSON.stringify(data);
  S.loadData();
}

console.log('=== 1. 两个转义出口的语义差别 ===');
ok(S.escapeHtml('<b>') === '&lt;b&gt;', 'escapeHtml 转义尖括号');
ok(S.escapeHtml('a"b') === 'a"b', 'escapeHtml 不动引号（文本节点本来就不需要）');
ok(S.escAttr('a"b') === 'a&quot;b', 'escAttr 转义双引号');
ok(S.escAttr("a'b") === 'a&#39;b', 'escAttr 转义单引号');
ok(S.escAttr('<img>') === '&lt;img&gt;', 'escAttr 同时处理尖括号');
ok(S.escAttr(null) === '', 'escAttr 对 null 返回空串而不是 "null"');

console.log('\n=== 2. 名称类字段进属性：值里的引号不能逃出 value=" " ===');
seed({
  categories: [{
    id: 'c1', name: QUOTE, archived: false, countInStats: true,
    items: [{ id: 'i1', name: QUOTE, archived: false }]
  }],
  records: {}
});
S.editCategoryName('c1');
ok(MODAL().indexOf('onmouseover="alert(1)') < 0, '编辑分类弹窗里没有可执行的事件处理器');
ok(MODAL().indexOf('&quot;') >= 0, '引号被转成了 &quot;');
S.editItemConfig('c1', 'i1');
ok(MODAL().indexOf('onmouseover="alert(1)') < 0, '编辑打卡项弹窗同样安全');

console.log('\n=== 3. 文本节点：名字里的标签只能显示，不能生效 ===');
seed({
  categories: [{
    id: 'c1', name: XSS, archived: false, countInStats: true,
    items: [{ id: 'i1', name: XSS, archived: false }]
  }],
  records: {}
});
S.renderManage();
ok(MG().indexOf('<img src=x') < 0, '管理页不出现裸 <img>');
ok(MG().indexOf('&lt;img') >= 0, '标签被转义成文本显示');
S.renderCheckin();
ok(CK().indexOf('<img src=x') < 0, '打卡页不出现裸 <img>');

console.log('\n=== 4. 量化单位（历史真注入点）===');
seed({
  categories: [{
    id: 'c1', name: '健康', archived: false, countInStats: true,
    items: [{ id: 'i1', name: '喝水', archived: false, quant: { unit: XSS, target: 8, compare: 'gte' } }]
  }],
  records: {}
});
S.openQuantInput('i1');
ok(MODAL().indexOf('<img src=x') < 0, '填写数值弹窗里单位不产生标签');
// 单位上限 10 字，XSS 会被截成 "</span><im"，转义后是 &lt;/span&gt;&lt;im
ok(MODAL().indexOf('&lt;/span&gt;&lt;im') >= 0, '单位被完整转义');
S.renderCheckin();
ok(CK().indexOf('<img src=x') < 0, '打卡行徽章里的单位同样安全');

console.log('\n=== 5. 备注：title 属性里的引号 ===');
seed({
  categories: [{ id: 'c1', name: '健康', archived: false, countInStats: true, items: [{ id: 'i1', name: '早起', archived: false }] }],
  records: { [TODAY()]: [{ id: 'i1', value: 1, note: QUOTE }] }
});
S.renderCheckin();
ok(CK().indexOf('<span class="checkin-note" title="x" onmouseover="alert(1)">') < 0, '备注 title 没有被引号截断');
ok(CK().indexOf('&quot;') >= 0, '备注里的引号被转义');

console.log('\n=== 6. id 白名单：脏 id 不能拼进 onclick ===');
const BAD_ID = "i1'); alert(1); ('";
seed({
  categories: [{
    id: "c1'); alert(1); ('", name: '健康', archived: false, countInStats: true,
    items: [{ id: BAD_ID, name: '早起', archived: false }]
  }],
  records: { [TODAY()]: [BAD_ID] }
});
const ids = G('state.categories.map(c => c.id).concat(state.categories[0].items.map(i => i.id))');
ok(ids.every(id => /^[A-Za-z0-9_-]{1,64}$/.test(id)), '加载后所有 id 都符合白名单: ' + ids.length + ' 个');
ok(ids.indexOf(BAD_ID) < 0, '脏 id 已被替换');
ok(S.getDayRecords(TODAY()).length === 1, '记录没有因为换 id 而丢失');
ok(S.getDayCheckedIds(TODAY()).length === 1, '换 id 后记录仍然指向新打卡项');
S.renderCheckin();
ok(CK().indexOf("alert(1)") < 0, '渲染出的属性里没有注入代码');
ok(/onclick="toggleCheckin\('[A-Za-z0-9_-]+'\)"/.test(CK()), 'onclick 只剩合法的函数调用');

console.log('\n=== 7. CSV：文本列防公式注入，数值列不许乱加前缀 ===');
ok(S.csvTextCell('=1+1') === "'=1+1", '等号开头加单引号前缀');
ok(S.csvTextCell('+86') === "'+86", '加号开头同样处理');
ok(S.csvTextCell('-5') === "'-5", '文本列里的负号也要防（-5 作为文本不是数字）');
ok(S.csvCell(-5) === '-5', '数值列保持 -5 原样，不能被前缀破坏');
ok(S.csvCell('a,b') === '"a,b"', '含逗号仍然加引号');

seed({
  categories: [{
    id: 'c1', name: '健康', archived: false, countInStats: true,
    items: [{ id: 'i1', name: '=cmd|calc', archived: false, quant: { unit: '杯', target: 8, compare: 'gte' } }]
  }],
  records: { [TODAY()]: [{ id: 'i1', value: 3 }] }
});
const d = new Date(), s0 = new Date(d); s0.setDate(s0.getDate() - 2);
S.exportQuantCsv(s0, d, ['i1']);
const csv = String(captured.blob ? captured.blob.p[0] : '');
ok(csv.charCodeAt(0) === 0xFEFF, '导出带 BOM');
ok(csv.indexOf("'=cmd|calc") >= 0, '导出表头里危险名字被前缀化');
ok(csv.indexOf(',=cmd|calc') < 0, '没有未前缀的公式单元格');

console.log('\n=== 8. 源码护栏：属性里不许再出现裸 escapeHtml ===');
// 注释里举反例不算违规，统计前先剥注释（块注释 + 行首行注释）
const codeOnly = html
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
const attrRaw = [...codeOnly.matchAll(/value="\$\{escapeHtml\(/g)];
ok(attrRaw.length === 0, 'value="${escapeHtml(...)}" 已全部换成 escAttr（剩余 ' + attrRaw.length + ' 处）');

console.log('');
if (fail > 0) { console.log(`${fail} FAILED`); process.exit(1); }
console.log('PASS');
