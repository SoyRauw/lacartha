-- 013_sale_customer_phone.sql
-- Guarda el teléfono del cliente en las ventas del POS.

alter table public.sales
  add column if not exists customer_phone text;

do $$
begin
  if exists (
    select 1
    from pg_proc
    where proname = 'register_sale'
      and pronamespace = 'public'::regnamespace
  ) and not exists (
    select 1
    from pg_proc
    where proname = 'register_sale_core'
      and pronamespace = 'public'::regnamespace
  ) then
    alter function public.register_sale(jsonb) rename to register_sale_core;
  end if;
end $$;

revoke all on function public.register_sale_core(jsonb) from public, anon, authenticated;

create or replace function public.register_sale(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_sale_id uuid;
begin
  v_result := public.register_sale_core(payload);
  v_sale_id := nullif(v_result->>'sale_id', '')::uuid;

  if v_sale_id is not null then
    update public.sales
    set customer_phone = nullif(trim(coalesce(payload->>'customer_phone', '')), '')
    where id = v_sale_id;
  end if;

  return v_result;
end;
$$;

revoke all on function public.register_sale(jsonb) from public;
grant execute on function public.register_sale(jsonb) to authenticated;
