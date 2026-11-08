-- 005_rls.sql
-- Seguridad, políticas y vistas públicas

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and active = true
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Perfiles
alter table public.profiles enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
for select to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

-- Resto de tablas: solo administradores
do $$
declare
  t text;
  tables text[] := array[
    'business_settings',
    'payment_methods',
    'rate_snapshots',
    'capital_movements',
    'ingredients',
    'purchases',
    'purchase_items',
    'inventory_counts',
    'inventory_count_items',
    'preparations',
    'preparation_items',
    'products',
    'recipe_items',
    'option_groups',
    'options',
    'option_recipe_items',
    'stock_movements',
    'cash_sessions',
    'sales',
    'sale_items',
    'sale_item_options',
    'sale_payments',
    'cash_movements',
    'expenses'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists admin_all on public.%I', t);
    execute format(
      'create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t
    );
  end loop;
end;
$$;

-- Permisos base
revoke all on all tables in schema public from anon;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Vistas públicas del menú
create or replace view public.public_business_settings as
select
  id,
  business_name,
  logo_url,
  instagram_url,
  phone,
  whatsapp_phone,
  address,
  delivery_enabled,
  pickup_enabled,
  public_menu_enabled,
  public_rate_source,
  public_rate_value,
  currency
from public.business_settings
where id = 1;

create or replace view public.public_menu_products as
select
  id,
  name,
  category,
  product_type,
  price_usd,
  description,
  image_url,
  sort_order,
  base_unit
from public.products
where active = true
  and is_public = true
order by sort_order, name;

create or replace view public.public_menu_option_groups as
select
  id,
  name,
  slug,
  selection_type,
  min_select,
  max_select,
  required,
  sort_order
from public.option_groups
where active = true
order by sort_order;

create or replace view public.public_menu_options as
select
  id,
  group_id,
  name,
  price_delta_usd,
  description,
  image_url,
  sort_order
from public.options
where active = true
order by sort_order;

create or replace view public.public_rate_latest as
select
  bcv_usd,
  bcv_eur,
  usdt,
  snapshot_date,
  fetched_at
from public.rate_snapshots
order by snapshot_date desc
limit 1;

grant select on
  public.public_business_settings,
  public.public_menu_products,
  public.public_menu_option_groups,
  public.public_menu_options,
  public.public_rate_latest
to anon, authenticated;
