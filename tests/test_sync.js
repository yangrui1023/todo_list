// 同步判定（第 5 层）：从「谁的时间戳新听谁的」改成三方比较，
// 两边都改过时不再静默覆盖，而是交给用户裁决。
const fs = require('fs'), vm = require('vm'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n');

function makeEl(id) {
  const cls = new Set();
  const el = {
    id, value: '', style: {}, options: [], checked: false, files: [], _html: '', _text: '', disabled: false,
    classList: { add(c) { cls.add(c); }, remove(c) { cls.delete(c); }, toggle() {}, contains(c) { return cls.has(c); } },
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
const BAR = () => getEl('syncConflictBar');

const LOCAL = { categories: [{ id: 'c1', name: '本机分类', items: [] }], records: {} };
const CLOUD = { categories: [{ id: 'c1', name: '云端分类', items: [] }], records: {} };
const THIRD = { categories: [{ id: 'c1', name: '第三份', items: [] }], records: {} };

console.log('=== 1. 内容指纹 ===');
const fp = o => S.stateFingerprint(o);
ok(fp(LOCAL) === fp(JSON.parse(JSON.stringify(LOCAL))), '同内容 → 同指纹');
ok(fp({ categories: [], records: {} }) === fp({ records: {}, categories: [] }),
  'key 顺序不影响指纹（云端 JSON 解析顺序和本地不同，必须稳定）');
ok(fp({ ...LOCAL, _rev: 9 }) === fp({ ...LOCAL, _rev: 1 }), '_rev 不参与指纹');
ok(fp({ ...LOCAL, _updated_at: '2026-10-01T00:00:00Z' }) === fp({ ...LOCAL, _updated_at: '2020-01-01T00:00:00Z' }),
  '_updated_at 不参与指纹');
ok(fp({ ...LOCAL, schemaVersion: 1 }) === fp({ ...LOCAL, schemaVersion: 9 }), 'schemaVersion 不参与指纹');
ok(fp(LOCAL) !== fp(CLOUD), '内容不同 → 指纹不同');
ok(fp(LOCAL) !== fp(THIRD) && fp(CLOUD) !== fp(THIRD), '三份数据三个指纹');

console.log('\n=== 2. 空状态识别 ===');
ok(S.isEmptyState({ categories: [], records: {} }) === true, '空分类空记录 = 空状态');
ok(S.isEmptyState({ categories: [{ id: 'c1' }], records: {} }) === false, '用户自建了分类就不是空');
ok(S.isEmptyState({ categories: [], records: { '2026-10-01': [{ id: 'i1' }] } }) === false, '有记录就不是空');
ok(S.isEmptyState(null) === true, 'null 视为空');
// 关键：ensureDietCategory 会给空状态塞一个内置饮食分类，
// 不能因为 categories 非空就认为「本机有数据」
ok(S.isEmptyState({ categories: [{ id: 'builtin_diet', builtin: 'diet', items: [] }], records: {} }) === true,
  '只有内置饮食分类、没有任何记录 → 仍然是空状态');
ok(S.isEmptyState({ categories: [{ id: 'c1', items: [{ id: 'i1' }] }], records: {} }) === false,
  '分类里已经有打卡项就不是空');

console.log('\n=== 3. 三方比较矩阵 ===');
const A = 'fpA', B = 'fpB', C = 'fpC';
ok(S.decideSync(A, A, A, false) === 'equal', '三方一致 → equal');
ok(S.decideSync(A, A, C, false) === 'equal', '内容一致就够了，基线过期也 equal');
ok(S.decideSync(A, B, A, false) === 'pull', '本地没动、云端动了 → pull');
ok(S.decideSync(A, B, B, false) === 'push', '云端没动、本地动了 → push');
ok(S.decideSync(A, B, C, false) === 'conflict', '两边都动过 → conflict');
ok(S.decideSync(A, B, '', true) === 'pull', '本地是空的（新设备）→ pull，绝不覆盖云端');
ok(S.decideSync(A, B, '', false) === 'conflict', '没有基线但本地有内容 → 交给用户');
ok(S.decideSync(A, B, B, true) === 'pull', '本地空 + 云端与基线一致 → pull');

console.log('\n=== 4. 场景：云端更新，本机没动 → 自动拉取 ===');
let pulls = 0, pushes = 0;

// 数据进来都要过 ensureStateShape（补饮食分类、版本号…），
// 所以基线指纹必须取「整形后」的内容，不能用原始字面量算
const fpOfState = () => G('stateFingerprint(state)');

function setup(localData, cloudData, baseKind) {
  Object.keys(els).forEach(k => delete els[k]);
  store['checkin_app_data_u1'] = JSON.stringify(localData);
  G("sync.user = { id: 'u1', email: 'a@b.c' }; sync.conflict = null; sync.inFlight = false;");
  S.loadData();
  const localFp = fpOfState();
  const localSnapshot = G('JSON.stringify(state)');

  // 云端那份也要整形后才能比：临时应用一次取指纹，再还原
  G('applyCloudState(' + JSON.stringify(cloudData) + ')');
  const cloudFp = fpOfState();
  G('state = ' + localSnapshot + '; ensureStateShape();');
  store['checkin_app_data_u1'] = localSnapshot;

  const baseMap = { local: localFp, cloud: cloudFp, third: 'fp-third-nonexistent', none: '' };
  const baseFp = baseMap[baseKind];
  if (baseFp) store['checkin_sync_base_u1'] = baseFp; else delete store['checkin_sync_base_u1'];
  G('sync.baseFp = loadBaseFp();');

  pulls = 0; pushes = 0;
  S.fetch = (url, opts) => {
    if (opts && opts.method === 'POST') { pushes++; return Promise.resolve({ ok: true, json: () => Promise.resolve([]) }); }
    pulls++;
    return Promise.resolve({ ok: true, json: () => Promise.resolve([{ data: cloudData, updated_at: '2026-10-22T03:00:00Z' }]) });
  };
}
const run = () => new Promise(r => { S.syncFromCloud().then(r); });

(async () => {
  setup(LOCAL, CLOUD, 'local');
  await run();
  ok(G('state.categories[0].name') === '云端分类', '本机内容被云端替换');
  ok(pushes === 0, '没有反向推送');
  ok(G('sync.conflict') === null, '不产生冲突');

  console.log('\n=== 5. 场景：云端没动，本机改过 → 自动推送 ===');
  setup(LOCAL, CLOUD, 'cloud');
  await run();
  ok(G('state.categories[0].name') === '本机分类', '本机内容保留');
  ok(pushes === 1, '推送了一次');
  ok(store['checkin_sync_base_u1'] === fpOfState(), '基线更新为本机这一版');

  console.log('\n=== 6. 场景：两边都改过 → 不覆盖，弹冲突条 ===');
  setup(LOCAL, CLOUD, 'third');
  await run();
  ok(G('state.categories[0].name') === '本机分类', '本机数据没被静默覆盖');
  ok(pushes === 0, '也没有把云端冲掉');
  ok(G('sync.conflict') !== null, '进入冲突状态');
  ok(BAR().style.display === 'flex', '冲突条显示出来');
  ok(BAR().innerHTML.indexOf('用云端的') >= 0 && BAR().innerHTML.indexOf('用本机的') >= 0, '给了两个明确选项');

  console.log('\n=== 7. 冲突期间不再自动推送 ===');
  const before = pushes;
  G('scheduleCloudPush()');
  ok(pushes === before, '冲突未裁决时不推（否则会把另一台设备的改动冲掉）');

  console.log('\n=== 8. 裁决：用云端的 ===');
  await S.resolveSyncConflict('cloud');
  ok(G('state.categories[0].name') === '云端分类', '本机被云端覆盖');
  ok(G('sync.conflict') === null, '冲突状态清空');
  ok(BAR().style.display === 'none', '冲突条收起');
  ok(store['checkin_sync_base_u1'] === fpOfState(), '基线指向云端这一版');

  console.log('\n=== 9. 裁决：用本机的 ===');
  setup(LOCAL, CLOUD, 'third');
  await run();
  await S.resolveSyncConflict('local');
  ok(pushes >= 1, '强制推了一次');
  ok(G('state.categories[0].name') === '本机分类', '本机数据保留');
  ok(store['checkin_sync_base_u1'] === fpOfState(), '基线更新');

  console.log('\n=== 10. 场景：登出重登（本地空、云端有）→ 拉取，绝不清空云端 ===');
  setup({ categories: [], records: {} }, CLOUD, 'none');
  await run();
  ok(pushes === 0, '本地空的时候一次都没推');
  ok(G('state.categories[0].name') === '云端分类', '从云端恢复数据');

  console.log('\n=== 11. 网络失败不能当成「云端没数据」 ===');
  setup(LOCAL, CLOUD, 'local');
  S.fetch = () => Promise.reject(new Error('offline'));
  const pushesBefore = pushes;
  await run();
  ok(pushes === pushesBefore, '断网时不推送本地旧数据');
  ok(G('state.categories[0].name') === '本机分类', '本地数据保持不动');

  console.log('');
  if (fail > 0) { console.log(`${fail} FAILED`); process.exit(1); }
  console.log('PASS');
})();
