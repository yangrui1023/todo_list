-- ============================================================================
-- 02 · 关掉表对匿名角色的直接访问（等新版前端上线、登录同步都正常后再执行）
--
-- 执行完这一步之后：
--   · 浏览器拿 anon key 直接 GET /rest/v1/app_users 会返回空数组或 401
--   · 所有读写只能走 01 里建的 5 个函数，函数内部校验 token
--   · 数据库后台（service_role）不受影响，照样能看到全表
--
-- ⚠️ 执行后旧版前端会立刻无法登录/同步。确认线上的 index.html 已经是
--    走 RPC 的版本，再跑这段。
-- ============================================================================

-- 0) 预检：函数的属主必须能读到这两张表。
--    security definer 函数是以「属主身份」执行的，属主 = 表属主才能绕过 RLS
--    和 revoke。正常情况下两个 owner 都是 postgres，三列值应完全一致。
--    如果 func_owner 与表 owner 不同，**先停下**，别执行第 1 步之后的内容。
select p.proname                    as func,
       r.rolname                    as func_owner,
       t_app.tableowner              as app_users_owner,
       t_ck.tableowner               as checkin_data_owner
  from pg_proc p
  join pg_roles r on r.oid = p.proowner
  cross join (select tableowner from pg_tables
               where schemaname = 'public' and tablename = 'app_users') t_app
  cross join (select tableowner from pg_tables
               where schemaname = 'public' and tablename = 'checkin_data') t_ck
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('app_register','app_login','app_logout','app_read_data','app_write_data')
 order by 1;

-- 1) 确保 RLS 是开的
alter table public.app_users    enable row level security;
alter table public.checkin_data enable row level security;

-- 2) 清掉所有已有策略。留着任何一条 `using (true)`，
--    上面那些 revoke 都白做 —— RLS 策略是「额外放行」，不是「额外限制」。
do $$
declare p record;
begin
  for p in select policyname, tablename from pg_policies
            where schemaname = 'public'
              and tablename in ('app_users', 'checkin_data')
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
    raise notice 'dropped policy %.% ', p.tablename, p.policyname;
  end loop;
end $$;

-- 3) 收回表级权限（anon = 网页里那个 key 的身份）
revoke all on table public.app_users    from anon, authenticated;
revoke all on table public.checkin_data from anon, authenticated;

-- 4) 表权限收干净之后，再用同一个身份把函数权限授回去
--    （第 3 步只动表，不动函数，这里重复一次是为了防止顺序问题）
grant execute on function public.app_register(text, text)                to anon, authenticated;
grant execute on function public.app_login(text, text)                   to anon, authenticated;
grant execute on function public.app_logout(text)                        to anon, authenticated;
grant execute on function public.app_read_data(text)                     to anon, authenticated;
grant execute on function public.app_write_data(text, jsonb, text, text) to anon, authenticated;

-- 5) 自检：这两张表对 anon 应该都没有任何权限
select table_name,
       grantee,
       string_agg(privilege_type, ', ' order by privilege_type) as privs
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('app_users', 'checkin_data')
   and grantee in ('anon', 'authenticated')
 group by table_name, grantee;
-- 期望：0 行。有行就说明还有权限残留。

-- ----------------------------------------------------------------------------
-- 回滚（只在「执行完登录立刻失败」时用，平时不用管，保持注释状态）
--
-- 判断依据：执行后打开线上页面登录，如果提示的是「密码错误」「账号不存在」，
-- 说明函数正常工作、只是密码不对，**不要回滚**。
-- 如果提示「同步失败」「操作失败」并且后端日志报 permission denied，
-- 说明函数属主没有表权限 → 取消下面两行注释执行，恢复到跑 02 之前的状态。
-- ----------------------------------------------------------------------------
-- grant select, insert, update, delete on table public.app_users    to anon, authenticated;
-- grant select, insert, update, delete on table public.checkin_data to anon, authenticated;

