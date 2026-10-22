/**
 * 认证与数据读写：全部走 /rpc/app_*，前端不直连表
 *
 * 为什么要有这套：
 * 原来前端拿 anon key 直接 select app_users 的 password_hash / salt / session_token，
 * 而 anon key 就写在网页源码里 —— 任何人打开控制台就能读走全站凭据。
 * 现在改成：客户端只能提交邮箱密码换会话票，读写数据也必须带 token。
 *
 * 这套测试守两件事：
 *   1. 登录 / 注册 / 登出 / token 失效 的行为和提示是对的
 *   2. 源码里不再出现对 app_users / checkin_data 的直连（防止以后又写回去）
 */
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
    createElement: () => makeEl('c'), addEventListener() {}, body: makeEl('b'), documentElement: makeEl('h'), visibilityState: 'visible'
  },
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } },
  navigator: { userAgent: 'node' }, location: { href: 'file:///t' },
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }), text: () => Promise.resolve('') }),
  setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
  console, confirm: () => true, alert() {},
  Blob: class { constructor(p) { this.p = p; } }, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  Intl, Date, Math, JSON, Number, String, Array, Object, Set, Map, RegExp, parseFloat, parseInt, isNaN, isFinite
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox); vm.runInContext(code, sandbox, { filename: 'app.js' });
sandbox.escapeHtml = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  ✗ ' + m); } else console.log('  ✓ ' + m); };
const S = sandbox;
const G = expr => vm.runInContext(expr, sandbox);
const ERR = () => getEl('authError').textContent;
const USER = () => { try { return JSON.parse(store['checkin_user'] || 'null'); } catch (e) { return null; } };

// 记录所有请求。登录成功后 enterApp 会顺手触发一次读取，
// 所以只留「最后一次」会被覆盖，必须按函数名挑。
let calls = [];
let lastCall = null;
function mockRpc(handler) {
  S.fetch = (url, opts) => {
    const body = JSON.parse((opts && opts.body) || '{}');
    lastCall = { url: String(url), body };
    calls.push(lastCall);
    const out = handler(String(url), body);
    if (out instanceof Error) return Promise.reject(out);
    return Promise.resolve({ ok: true, json: () => Promise.resolve(out) });
  };
}
const callTo = name => calls.filter(c => c.url.indexOf('/rpc/' + name) >= 0).pop() || null;
function reset() {
  Object.keys(els).forEach(k => delete els[k]);
  Object.keys(store).forEach(k => delete store[k]);
  G('sync.user = null; sync.conflict = null; sync.inFlight = false; sync.mode = "login";');
  calls = []; lastCall = null;
}
function fill(email, pw) {
  getEl('authEmail').value = email;
  getEl('authPassword').value = pw;
}

console.log('=== 1. 登录成功：只调函数，拿回会话票 ===');
reset();
mockRpc(() => ({ ok: true, user: { id: 'u1', email: 'a@b.c', token: 'tk-1' } }));
fill('a@b.c', '123456');
S.handleAuth().then(() => {
  const c = callTo('app_login');
  ok(!!c, '打到 app_login 函数');
  ok(c && c.body.p_email === 'a@b.c' && c.body.p_password === '123456', '只传邮箱和密码');
  ok(c && !('password_hash' in c.body) && !('salt' in c.body), '请求里没有任何哈希字段');
  ok(USER() && USER().token === 'tk-1', '会话票存进本地');
  ok(G('sync.user.token') === 'tk-1', '内存里的会话同步了');

  console.log('\n=== 2. 密码错误 / 账号不存在 → 给出人话 ===');
  reset();
  mockRpc(() => ({ ok: false, error: 'bad_password' }));
  fill('a@b.c', '000000');
  return S.handleAuth();
}).then(() => {
  ok(ERR() === '密码错误', '错误码翻译成「密码错误」');
  ok(getEl('authBtn').disabled === false, '按钮恢复可用（能再试一次）');

  reset();
  mockRpc(() => ({ ok: false, error: 'no_user' }));
  fill('x@b.c', '123456');
  return S.handleAuth();
}).then(() => {
  ok(ERR() === '账号不存在，请先注册', 'no_user 的提示');

  console.log('\n=== 3. 服务器还没建函数（404）→ 说清楚要做什么 ===');
  reset();
  S.fetch = () => Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve('') });
  fill('a@b.c', '123456');
  return S.handleAuth();
}).then(() => {
  ok(ERR().indexOf('01_auth_rpc.sql') >= 0, '直接告诉用户去跑哪份脚本');

  console.log('\n=== 4. 注册成功：服务端负责哈希 ===');
  reset();
  G('sync.mode = "register";');
  mockRpc(() => ({ ok: true, user: { id: 'u2', email: 'n@b.c', token: 'tk-2' } }));
  fill('n@b.c', 'abcdef');
  return S.handleAuth();
}).then(() => {
  ok(!!callTo('app_register'), '打到 app_register 函数');
  ok(USER() && USER().id === 'u2', '注册后直接进应用');

  console.log('\n=== 5. 邮箱重复 ===');
  reset();
  G('sync.mode = "register";');
  mockRpc(() => ({ ok: false, error: 'email_exists' }));
  fill('a@b.c', '123456');
  return S.handleAuth();
}).then(() => {
  ok(ERR() === '该邮箱已被注册', 'email_exists 的提示');

  console.log('\n=== 6. 读写数据必须带 token ===');
  reset();
  G("sync.user = { id: 'u1', email: 'a@b.c', token: 'tk-1' };");
  mockRpc((url) => {
    if (url.indexOf('app_read_data') >= 0) return { ok: true, row: null };
    if (url.indexOf('app_write_data') >= 0) return { ok: true, fingerprint: 'fp-x' };
    return { ok: true };
  });
  return S.fetchCloudData().then((r) => {
    const rd = callTo('app_read_data');
    ok(r.ok === true && r.row === null, '读数据走 app_read_data');
    ok(rd && rd.body.p_token === 'tk-1', '带上会话票');
    ok(rd && rd.url.indexOf('user_key') < 0, '不再用 user_key 当访问控制');
    return S.pushCloudData();
  }).then(() => {
    const wr = callTo('app_write_data');
    ok(!!wr, '写数据走 app_write_data');
    ok(wr && wr.body.p_token === 'tk-1', '写也带会话票');
    ok(wr && typeof wr.body.p_fp === 'string' && wr.body.p_fp.length > 0, '带上本次内容指纹');
    ok(wr && 'p_base_fp' in wr.body, '带上基线指纹（服务端据此判断要不要拒写）');

    console.log('\n=== 7. token 失效（在别处重新登录过）===');
    reset();
    G("sync.user = { id: 'u1', email: 'a@b.c', token: 'tk-stale' };");
    mockRpc(() => ({ ok: false, error: 'auth' }));
    return S.syncFromCloud();
  }).then(() => {
    ok(getEl('syncText').textContent.indexOf('登录已失效') >= 0, '提示登录失效，而不是笼统的「同步失败」');

    console.log('\n=== 8. 登出：作废服务端会话 + 清本地 ===');
    reset();
    G("sync.user = { id: 'u1', email: 'a@b.c', token: 'tk-1' }; sync.baseFp = 'fp1';");
    store['checkin_session'] = 'tk-1';
    store['checkin_user'] = JSON.stringify({ id: 'u1', email: 'a@b.c', token: 'tk-1' });
    store['checkin_app_data_u1'] = '{"categories":[]}';
    store['checkin_sync_base_u1'] = 'fp1';
    mockRpc(() => ({ ok: true }));
    return S.signOutUser().then(() => {
      const lo = callTo('app_logout');
      ok(!!lo, '调了 app_logout 让 token 作废');
      ok(lo && lo.body.p_token === 'tk-1', '传的是自己的 token');
      ok(!store['checkin_session'] && !store['checkin_user'], '本地会话清掉');
      ok(!store['checkin_app_data_u1'], '本地缓存清掉');
      ok(!store['checkin_sync_base_u1'], '基线指纹清掉（否则重登会用空数据盖云端）');

      console.log('\n=== 9. 源码护栏：不许再直连表 ===');
      ok(html.indexOf('/rest/v1/app_users') < 0, '没有对 app_users 的直连');
      ok(html.indexOf('/rest/v1/checkin_data') < 0, '没有对 checkin_data 的直连');
      ok(html.indexOf('/rest/v1/rpc/') >= 0, '所有请求都走 /rpc/');
      ok(html.indexOf('password_hash') < 0 || html.indexOf('password_hash') === html.lastIndexOf('password_hash'),
        '前端源码里不再出现 password_hash（除了注释里说明历史）');
      const raw = [...html.matchAll(/authHeaders\(\)/g)].length;
      ok(raw >= 1, '只有 supabaseRpc 在构造请求头');

      console.log('');
      if (fail > 0) { console.log(`${fail} FAILED`); process.exit(1); }
      console.log('PASS');
    });
  });
});
