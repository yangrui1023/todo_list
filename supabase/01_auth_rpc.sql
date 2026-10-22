-- ============================================================================
-- 01 · 建登录 / 读 / 写 四个函数（不动现有表权限，可以随时执行）
--
-- 在 Supabase Dashboard → SQL Editor 里整段粘贴执行。
-- 执行完这一步，旧版前端仍然正常工作（它还在直连表），新版前端也能用。
-- 等新版前端上线确认没问题后，再执行 02_lockdown.sql 把表关掉。
--
-- 为什么要有这层：原来前端拿 anon key 直接 select app_users 的
-- password_hash / salt / session_token，而 anon key 就写在网页源码里，
-- 等于任何人打开控制台就能读走全站凭据。收进 SECURITY DEFINER 函数后，
-- 客户端只能「提交邮箱密码换会话票」，永远读不到哈希，也读不到别人的 token。
-- ============================================================================

-- pgcrypto 提供 crypt() / gen_salt() / digest()
create extension if not exists pgcrypto with schema extensions;

-- 顺手补一列：内容指纹，用来做「写入前比对」，防止盲推覆盖另一台设备
alter table public.checkin_data add column if not exists fingerprint text;


-- ---------------------------------------------------------------------------
-- 注册
-- 密码在这里用 bcrypt 加盐哈希（原来前端算 sha256，见 app_login 里的兼容分支）
-- ---------------------------------------------------------------------------
create or replace function public.app_register(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_token text;
  v_id    app_users.id%type;
begin
  if position('@' in v_email) < 2 or length(v_email) < 5 then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;
  if length(coalesce(p_password, '')) < 6 then
    return jsonb_build_object('ok', false, 'error', 'weak_password');
  end if;
  if exists (select 1 from app_users where lower(email) = v_email) then
    return jsonb_build_object('ok', false, 'error', 'email_exists');
  end if;

  v_token := gen_random_uuid()::text;

  insert into app_users (email, password_hash, salt, session_token)
  values (v_email, crypt(p_password, gen_salt('bf', 12)), '', v_token)
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'user', jsonb_build_object('id', v_id, 'email', v_email, 'token', v_token)
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'email_exists');
end;
$$;


-- ---------------------------------------------------------------------------
-- 登录
-- 老数据是前端算的 sha256(salt || password)，新数据是 bcrypt。
-- 老用户第一次登录时用老哈希验过，再顺手升级成 bcrypt —— 用户无感。
-- ---------------------------------------------------------------------------
create or replace function public.app_login(p_email text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  u       app_users%rowtype;
  v_ok    boolean := false;
  v_token text;
begin
  select * into u from app_users where lower(email) = v_email limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_user');
  end if;

  if coalesce(u.password_hash, '') like '$2%' then
    -- bcrypt
    v_ok := (crypt(p_password, u.password_hash) = u.password_hash);
  else
    -- 老格式：前端 TextEncoder(salt + password) → SHA-256 → hex
    v_ok := (encode(digest(coalesce(u.salt, '') || coalesce(p_password, ''), 'sha256'), 'hex')
             = coalesce(u.password_hash, ''));
    if v_ok then
      update app_users
         set password_hash = crypt(p_password, gen_salt('bf', 12)),
             salt = ''
       where id = u.id;
    end if;
  end if;

  if not v_ok then
    return jsonb_build_object('ok', false, 'error', 'bad_password');
  end if;

  v_token := gen_random_uuid()::text;
  update app_users set session_token = v_token where id = u.id;

  return jsonb_build_object(
    'ok', true,
    'user', jsonb_build_object('id', u.id, 'email', u.email, 'token', v_token)
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 登出：把这个 token 作废
-- ---------------------------------------------------------------------------
create or replace function public.app_logout(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update app_users set session_token = null
   where p_token is not null and session_token = p_token;
  return jsonb_build_object('ok', true);
end;
$$;


-- ---------------------------------------------------------------------------
-- 读数据：token 换用户，只返回这个用户自己的那份
-- 注意 user_key::text 与 id::text 比较：两张表的列类型不一定一致，
-- 直接 = 可能在类型不同时抛错。用户量小，不走索引无所谓。
-- ---------------------------------------------------------------------------
create or replace function public.app_read_data(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid app_users.id%type;
  r     record;
begin
  select id into v_uid from app_users
   where p_token is not null and session_token = p_token limit 1;
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'auth');
  end if;

  select data, updated_at, fingerprint into r
    from checkin_data where user_key::text = v_uid::text limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'row', null);
  end if;

  return jsonb_build_object('ok', true, 'row', jsonb_build_object(
    'data', r.data,
    'updated_at', r.updated_at,
    'fingerprint', r.fingerprint
  ));
end;
$$;


-- ---------------------------------------------------------------------------
-- 写数据（带「写入前比对」）
--   p_fp       这次要写的这版内容的指纹
--   p_base_fp  这台设备上次同步时看到的云端指纹；传 null = 强制覆盖
--
-- 云端已经有内容、且和这台设备上次看到的不一样 → 不写，把云端那版交回去，
-- 由前端弹冲突条让用户选。这样就不会出现「手机上的改动被电脑盲推冲掉」。
-- ---------------------------------------------------------------------------
create or replace function public.app_write_data(
  p_token   text,
  p_data    jsonb,
  p_fp      text,
  p_base_fp text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_uid      app_users.id%type;
  v_key_type text;
  v_sql      text;
  r          record;
begin
  select id into v_uid from app_users
   where p_token is not null and session_token = p_token limit 1;
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'auth');
  end if;

  if p_data is null then
    return jsonb_build_object('ok', false, 'error', 'empty');
  end if;

  select data, updated_at, fingerprint into r
    from checkin_data where user_key::text = v_uid::text limit 1;

  if found and r.fingerprint is not null and p_base_fp is not null
     and r.fingerprint <> p_base_fp then
    return jsonb_build_object(
      'ok', false,
      'conflict', true,
      'data', r.data,
      'updated_at', r.updated_at,
      'fingerprint', r.fingerprint
    );
  end if;

  -- checkin_data.user_key 与 app_users.id 的类型不一定一致（uuid / text 都有可能），
  -- 直接插会在类型不同的那一边报错。先读出实际类型，再显式 cast。
  select format_type(a.atttypid, a.atttypmod) into v_key_type
    from pg_attribute a
   where a.attrelid = 'public.checkin_data'::regclass
     and a.attname = 'user_key'
     and a.attnum > 0;

  v_sql := 'insert into public.checkin_data (user_key, data, updated_at, fingerprint) '
        || 'values ($1::' || coalesce(v_key_type, 'text') || ', $2, now(), $3) '
        || 'on conflict (user_key) do update '
        || 'set data = excluded.data, updated_at = excluded.updated_at, '
        || '    fingerprint = excluded.fingerprint';
  execute v_sql using v_uid::text, p_data, p_fp;

  return jsonb_build_object('ok', true, 'fingerprint', p_fp, 'updated_at', now());
end;
$$;


-- ---------------------------------------------------------------------------
-- 只允许匿名角色「调用函数」，不允许它碰函数里的任何表
-- ---------------------------------------------------------------------------
revoke all on function public.app_register(text, text)          from public;
revoke all on function public.app_login(text, text)             from public;
revoke all on function public.app_logout(text)                  from public;
revoke all on function public.app_read_data(text)               from public;
revoke all on function public.app_write_data(text, jsonb, text, text) from public;

grant execute on function public.app_register(text, text)          to anon, authenticated;
grant execute on function public.app_login(text, text)             to anon, authenticated;
grant execute on function public.app_logout(text)                  to anon, authenticated;
grant execute on function public.app_read_data(text)               to anon, authenticated;
grant execute on function public.app_write_data(text, jsonb, text, text) to anon, authenticated;

-- PostgREST 会缓存函数清单，新建完喊它刷一下，否则前端可能一直拿到 404
notify pgrst, 'reload schema';

-- 自检：应该能看到 5 行，全部 security definer
select proname,
       prosecdef as security_definer
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname like 'app\_%'
 order by proname;
