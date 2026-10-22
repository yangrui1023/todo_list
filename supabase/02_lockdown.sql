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
