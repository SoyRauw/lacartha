-- 001_core.sql
-- La Cartha — base del sistema

create extension if not exists pgcrypto;

-- Perfiles ligados a auth.users
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  role text not null default 'seller' check (role in ('admin', 'seller')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated
before update on public.profiles
for each row execute function public.set_updated_at();

-- Crea el perfil automáticamente al crear un usuario.
-- El primer usuario queda como admin; los siguientes como seller.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  if not exists (select 1 from public.profiles) then
    v_role := 'admin';
  else
    v_role := 'seller';
  end if;

  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    v_role
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Backfill para usuarios que ya existían antes de ejecutar esta migración.
with first_user as (
  select id from auth.users order by created_at limit 1
)
insert into public.profiles (id, email, name, role)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
  case when u.id = (select id from first_user) then 'admin' else 'seller' end
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- Configuración del negocio (fila única)
create table if not exists public.business_settings (
  id integer primary key default 1 check (id = 1),
  business_name text not null default 'La Cartha',
  logo_url text,
  instagram_url text,
  phone text,
  whatsapp_phone text,
  address text,
  delivery_enabled boolean not null default true,
  pickup_enabled boolean not null default true,
  public_menu_enabled boolean not null default true,
  public_rate_source text not null default 'bcv_eur'
    check (public_rate_source in ('bcv_usd', 'bcv_eur', 'usdt', 'manual')),
  public_rate_value numeric(14, 4),
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_business_settings_updated on public.business_settings;
create trigger trg_business_settings_updated
before update on public.business_settings
for each row execute function public.set_updated_at();

insert into public.business_settings (
  id, business_name, instagram_url, phone, whatsapp_phone
)
values (
  1,
  'La Cartha',
  'https://www.instagram.com/lacartha.mcboo/',
  '0424-4315118',
  '584244315118'
)
on conflict (id) do nothing;

-- Medios de pago
create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  currency text not null check (currency in ('USD', 'BS', 'USDT')),
  active boolean not null default true,
  affects_cash boolean not null default false,
  requires_reference boolean not null default false,
  sort_order integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  qr_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_payment_methods_updated on public.payment_methods;
create trigger trg_payment_methods_updated
before update on public.payment_methods
for each row execute function public.set_updated_at();

insert into public.payment_methods (
  code, name, currency, affects_cash, requires_reference, sort_order, details
)
values
  ('efectivo_usd', 'Efectivo USD', 'USD', true, false, 1, '{}'::jsonb),
  ('efectivo_bs', 'Efectivo Bs', 'BS', true, false, 2, '{}'::jsonb),
  ('pago_movil', 'Pago Móvil', 'BS', false, true, 3,
    '{"bank":"Mercantil / Banesco","id":"V.29.986.494","phone":"0424-4315118"}'::jsonb),
  ('punto_venta', 'Punto de venta', 'BS', false, true, 4, '{}'::jsonb),
  ('zelle', 'Zelle', 'USD', false, true, 5, '{}'::jsonb),
  ('binance', 'Binance (USDT)', 'USDT', false, true, 6,
    '{"holder":"valentinach1"}'::jsonb)
on conflict (code) do nothing;

-- Tasas del día
create table if not exists public.rate_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null unique,
  bcv_usd numeric(14, 4),
  bcv_eur numeric(14, 4),
  usdt numeric(14, 4),
  source text,
  fetched_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

-- Aportes y retiros del dueño
create table if not exists public.capital_movements (
  id uuid primary key default gen_random_uuid(),
  movement_date date not null default current_date,
  movement_type text not null check (movement_type in ('aporte', 'retiro')),
  amount numeric(14, 2) not null check (amount >= 0),
  currency text not null check (currency in ('USD', 'BS', 'USDT')),
  amount_usd numeric(14, 2) not null default 0,
  rate_source text,
  rate_value numeric(14, 4),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_capital_movements_date
  on public.capital_movements(movement_date);
-- 002_inventory.sql
-- Materia prima, compras y conteos

create table if not exists public.ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text,
  base_unit text not null check (base_unit in ('g', 'ml', 'unit')),
  purchase_unit text not null default 'unit',
  conversion_factor numeric(14, 4) not null default 1 check (conversion_factor > 0),
  avg_cost_usd numeric(14, 6) not null default 0 check (avg_cost_usd >= 0),
  stock_base numeric(14, 3) not null default 0,
  min_stock_base numeric(14, 3) not null default 0,
  track_stock boolean not null default true,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_ingredients_updated on public.ingredients;
create trigger trg_ingredients_updated
before update on public.ingredients
for each row execute function public.set_updated_at();

create index if not exists idx_ingredients_name on public.ingredients(name);
create index if not exists idx_ingredients_active on public.ingredients(active);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid unique,
  purchase_date date not null default current_date,
  supplier_name text,
  total_usd numeric(14, 2) not null default 0 check (total_usd >= 0),
  total_bs numeric(14, 2) not null default 0 check (total_bs >= 0),
  rate_source text,
  rate_value numeric(14, 4),
  payment_method_id uuid references public.payment_methods(id) on delete set null,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_purchases_date on public.purchases(purchase_date);
create index if not exists idx_purchases_created_at on public.purchases(created_at);

create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_cost_usd numeric(14, 6) not null default 0,
  total_usd numeric(14, 2) not null default 0,
  base_quantity numeric(14, 3) not null default 0,
  unit_cost_base_usd numeric(14, 6) not null default 0
);

create index if not exists idx_purchase_items_purchase
  on public.purchase_items(purchase_id);
create index if not exists idx_purchase_items_ingredient
  on public.purchase_items(ingredient_id);

create table if not exists public.inventory_counts (
  id uuid primary key default gen_random_uuid(),
  count_date date not null default current_date,
  status text not null default 'draft' check (status in ('draft', 'completed')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_inventory_counts_date
  on public.inventory_counts(count_date);

create table if not exists public.inventory_count_items (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references public.inventory_counts(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  theoretical_qty_base numeric(14, 3) not null default 0,
  counted_qty_base numeric(14, 3) not null default 0,
  difference_qty_base numeric(14, 3) not null default 0,
  unit_cost_usd numeric(14, 6) not null default 0,
  difference_usd numeric(14, 2) not null default 0,
  reason text check (reason in ('merma', 'error', 'consumo', 'otro')),
  notes text
);

create index if not exists idx_inventory_count_items_count
  on public.inventory_count_items(count_id);
-- 003_recipes.sql
-- Preparaciones, productos, opciones y recetas

create table if not exists public.preparations (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  yield_quantity numeric(14, 3) not null check (yield_quantity > 0),
  yield_unit text not null default 'portion'
    check (yield_unit in ('portion', 'g', 'ml', 'unit')),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_preparations_updated on public.preparations;
create trigger trg_preparations_updated
before update on public.preparations
for each row execute function public.set_updated_at();

create table if not exists public.preparation_items (
  id uuid primary key default gen_random_uuid(),
  preparation_id uuid not null references public.preparations(id) on delete cascade,
  ingredient_id uuid not null references public.ingredients(id) on delete restrict,
  quantity_base numeric(14, 3) not null check (quantity_base > 0),
  notes text
);

create index if not exists idx_preparation_items_prep
  on public.preparation_items(preparation_id);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null default 'banderilla'
    check (category in ('banderilla', 'bebida', 'postre', 'snack', 'otro')),
  product_type text not null default 'recipe'
    check (product_type in ('recipe', 'simple')),
  price_usd numeric(14, 2) not null default 0 check (price_usd >= 0),
  cost_usd numeric(14, 6) not null default 0 check (cost_usd >= 0),
  stock_base numeric(14, 3) not null default 0,
  base_unit text not null default 'unit'
    check (base_unit in ('g', 'ml', 'unit')),
  track_stock boolean not null default false,
  active boolean not null default true,
  is_public boolean not null default true,
  description text,
  image_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_products_updated on public.products;
create trigger trg_products_updated
before update on public.products
for each row execute function public.set_updated_at();

create index if not exists idx_products_category on public.products(category);
create index if not exists idx_products_active on public.products(active);

create table if not exists public.recipe_items (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  slot text not null default 'otro',
  component_type text not null check (component_type in ('ingredient', 'preparation')),
  ingredient_id uuid references public.ingredients(id) on delete restrict,
  preparation_id uuid references public.preparations(id) on delete restrict,
  quantity numeric(14, 3) not null check (quantity > 0),
  notes text,
  check ((ingredient_id is not null)::int + (preparation_id is not null)::int = 1)
);

create index if not exists idx_recipe_items_product
  on public.recipe_items(product_id);

create table if not exists public.option_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  selection_type text not null default 'single'
    check (selection_type in ('single', 'multiple')),
  min_select integer not null default 0 check (min_select >= 0),
  max_select integer check (max_select is null or max_select >= 0),
  required boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_option_groups_updated on public.option_groups;
create trigger trg_option_groups_updated
before update on public.option_groups
for each row execute function public.set_updated_at();

create table if not exists public.options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.option_groups(id) on delete cascade,
  name text not null,
  price_delta_usd numeric(14, 2) not null default 0,
  active boolean not null default true,
  description text,
  image_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, name)
);

drop trigger if exists trg_options_updated on public.options;
create trigger trg_options_updated
before update on public.options
for each row execute function public.set_updated_at();

create index if not exists idx_options_group on public.options(group_id);

create table if not exists public.option_recipe_items (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.options(id) on delete cascade,
  component_type text not null check (component_type in ('ingredient', 'preparation')),
  ingredient_id uuid references public.ingredients(id) on delete restrict,
  preparation_id uuid references public.preparations(id) on delete restrict,
  quantity numeric(14, 3) not null check (quantity > 0),
  notes text,
  check ((ingredient_id is not null)::int + (preparation_id is not null)::int = 1)
);

create index if not exists idx_option_recipe_items_option
  on public.option_recipe_items(option_id);

-- Movimientos de stock para ingredientes y productos simples
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  item_type text not null check (item_type in ('ingredient', 'product')),
  ingredient_id uuid references public.ingredients(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  movement_type text not null
    check (movement_type in ('initial', 'purchase', 'sale', 'waste', 'adjustment', 'production')),
  quantity_base numeric(14, 3) not null,
  unit_cost_usd numeric(14, 6) not null default 0,
  total_cost_usd numeric(14, 2) not null default 0,
  reference_type text,
  reference_id uuid,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((ingredient_id is not null)::int + (product_id is not null)::int = 1)
);

create index if not exists idx_stock_movements_ingredient
  on public.stock_movements(ingredient_id, created_at desc);
create index if not exists idx_stock_movements_product
  on public.stock_movements(product_id, created_at desc);
create index if not exists idx_stock_movements_reference
  on public.stock_movements(reference_type, reference_id);
-- 004_sales.sql
-- Ventas, pagos, caja y gastos

create table if not exists public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_usd numeric(14, 2) not null default 0,
  opening_bs numeric(14, 2) not null default 0,
  expected_usd numeric(14, 2),
  expected_bs numeric(14, 2),
  counted_usd numeric(14, 2),
  counted_bs numeric(14, 2),
  difference_usd numeric(14, 2),
  difference_bs numeric(14, 2),
  status text not null default 'open' check (status in ('open', 'closed')),
  notes text,
  opened_by uuid references auth.users(id) on delete set null,
  closed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_cash_sessions_updated on public.cash_sessions;
create trigger trg_cash_sessions_updated
before update on public.cash_sessions
for each row execute function public.set_updated_at();

create index if not exists idx_cash_sessions_status
  on public.cash_sessions(status, opened_at desc);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique,
  order_number text unique,
  cash_session_id uuid references public.cash_sessions(id) on delete set null,
  status text not null default 'completed' check (status in ('completed', 'voided')),
  subtotal_usd numeric(14, 2) not null default 0,
  discount_usd numeric(14, 2) not null default 0,
  total_usd numeric(14, 2) not null default 0,
  total_bs numeric(14, 2) not null default 0,
  change_usd numeric(14, 2) not null default 0,
  change_bs numeric(14, 2) not null default 0,
  rate_source text,
  rate_value numeric(14, 4),
  customer_name text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  void_reason text
);

create index if not exists idx_sales_created_at on public.sales(created_at desc);
create index if not exists idx_sales_status on public.sales(status);
create index if not exists idx_sales_session on public.sales(cash_session_id);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price_usd numeric(14, 2) not null default 0,
  unit_cost_usd numeric(14, 6) not null default 0,
  line_total_usd numeric(14, 2) not null default 0,
  config jsonb not null default '{}'::jsonb,
  notes text
);

create index if not exists idx_sale_items_sale on public.sale_items(sale_id);
create index if not exists idx_sale_items_product on public.sale_items(product_id);

create table if not exists public.sale_item_options (
  id uuid primary key default gen_random_uuid(),
  sale_item_id uuid not null references public.sale_items(id) on delete cascade,
  option_id uuid references public.options(id) on delete set null,
  group_name text,
  option_name text not null,
  price_delta_usd numeric(14, 2) not null default 0,
  unit_cost_usd numeric(14, 6) not null default 0
);

create index if not exists idx_sale_item_options_item
  on public.sale_item_options(sale_item_id);
create index if not exists idx_sale_item_options_option
  on public.sale_item_options(option_id);

create table if not exists public.sale_payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  payment_method_id uuid references public.payment_methods(id) on delete set null,
  method_code text not null,
  method_name text not null,
  currency text not null check (currency in ('USD', 'BS', 'USDT')),
  amount numeric(14, 2) not null default 0,
  amount_usd numeric(14, 2) not null default 0,
  rate_source text,
  rate_value numeric(14, 4),
  reference text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sale_payments_sale on public.sale_payments(sale_id);

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  cash_session_id uuid not null references public.cash_sessions(id) on delete cascade,
  movement_type text not null
    check (movement_type in ('opening', 'sale', 'expense', 'withdrawal', 'adjustment', 'closing')),
  payment_method_id uuid references public.payment_methods(id) on delete set null,
  method_code text,
  method_name text,
  affects_cash boolean not null default false,
  currency text not null check (currency in ('USD', 'BS', 'USDT')),
  amount numeric(14, 2) not null default 0,
  amount_usd numeric(14, 2) not null default 0,
  rate_source text,
  rate_value numeric(14, 4),
  reference_type text,
  reference_id uuid,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_cash_movements_session
  on public.cash_movements(cash_session_id, created_at);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category text not null default 'Otros',
  description text,
  amount numeric(14, 2) not null default 0 check (amount >= 0),
  currency text not null default 'USD' check (currency in ('USD', 'BS', 'USDT')),
  amount_usd numeric(14, 2) not null default 0,
  rate_source text,
  rate_value numeric(14, 4),
  payment_method_id uuid references public.payment_methods(id) on delete set null,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_expenses_date on public.expenses(expense_date desc);
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
-- 006_functions.sql
-- RPCs transaccionales para ventas, compras, caja e inventario

create or replace function public.register_sale(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid := nullif(payload->>'client_id', '')::uuid;
  v_existing public.sales%rowtype;
  v_sale_id uuid;
  v_sale_item_id uuid;
  v_order_number text := nullif(payload->>'order_number', '');
  v_cash_session_id uuid := nullif(payload->>'cash_session_id', '')::uuid;
  v_item jsonb;
  v_option jsonb;
  v_payment jsonb;
  v_product public.products%rowtype;
  v_prep public.preparations%rowtype;
  v_recipe public.recipe_items%rowtype;
  v_opt_recipe public.option_recipe_items%rowtype;
  v_prep_item public.preparation_items%rowtype;
  v_product_qty numeric;
  v_qty_base numeric;
  v_unit_cost numeric;
  v_factor numeric;
  v_affects_cash boolean;
begin
  if not public.is_admin() then
    raise exception 'No autorizado';
  end if;

  if v_client_id is null then
    raise exception 'Falta client_id';
  end if;

  select * into v_existing from public.sales where client_id = v_client_id;
  if found then
    return jsonb_build_object(
      'sale_id', v_existing.id,
      'order_number', v_existing.order_number,
      'duplicate', true
    );
  end if;

  if v_order_number is null then
    v_order_number := 'LC-' || to_char(now(), 'YYMMDD-HH24MISS') || '-' ||
      lpad((floor(random() * 1000))::text, 3, '0');
  end if;

  insert into public.sales (
    client_id,
    order_number,
    cash_session_id,
    status,
    subtotal_usd,
    discount_usd,
    total_usd,
    total_bs,
    change_usd,
    change_bs,
    rate_source,
    rate_value,
    customer_name,
    notes,
    created_by,
    created_at
  ) values (
    v_client_id,
    v_order_number,
    v_cash_session_id,
    'completed',
    coalesce((payload->>'subtotal_usd')::numeric, 0),
    coalesce((payload->>'discount_usd')::numeric, 0),
    coalesce((payload->>'total_usd')::numeric, 0),
    coalesce((payload->>'total_bs')::numeric, 0),
    coalesce((payload->>'change_usd')::numeric, 0),
    coalesce((payload->>'change_bs')::numeric, 0),
    payload->>'rate_source',
    nullif(payload->>'rate_value', '')::numeric,
    payload->>'customer_name',
    payload->>'notes',
    auth.uid(),
    coalesce(nullif(payload->>'created_at', '')::timestamptz, now())
  ) returning id into v_sale_id;

  for v_item in select value from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    select * into v_product
    from public.products
    where id = (v_item->>'product_id')::uuid;

    if not found then
      raise exception 'Producto no encontrado: %', v_item->>'product_id';
    end if;

    v_product_qty := coalesce((v_item->>'quantity')::numeric, 0);
    if v_product_qty <= 0 then
      raise exception 'Cantidad inválida en venta';
    end if;

    insert into public.sale_items (
      sale_id,
      product_id,
      product_name,
      quantity,
      unit_price_usd,
      unit_cost_usd,
      line_total_usd,
      config,
      notes
    ) values (
      v_sale_id,
      v_product.id,
      coalesce(v_item->>'product_name', v_product.name),
      v_product_qty,
      coalesce((v_item->>'unit_price_usd')::numeric, 0),
      coalesce((v_item->>'unit_cost_usd')::numeric, 0),
      coalesce((v_item->>'line_total_usd')::numeric, 0),
      coalesce(v_item->'config', '{}'::jsonb),
      v_item->>'notes'
    ) returning id into v_sale_item_id;

    for v_option in select value from jsonb_array_elements(coalesce(v_item->'options', '[]'::jsonb))
    loop
      insert into public.sale_item_options (
        sale_item_id,
        option_id,
        group_name,
        option_name,
        price_delta_usd,
        unit_cost_usd
      ) values (
        v_sale_item_id,
        nullif(v_option->>'option_id', '')::uuid,
        v_option->>'group_name',
        coalesce(v_option->>'option_name', v_option->>'name', 'Opción'),
        coalesce((v_option->>'price_delta_usd')::numeric, 0),
        coalesce((v_option->>'unit_cost_usd')::numeric, 0)
      );
    end loop;

    if v_product.product_type = 'recipe' then
      for v_recipe in
        select * from public.recipe_items where product_id = v_product.id
      loop
        if v_recipe.component_type = 'preparation' then
          select * into v_prep
          from public.preparations
          where id = v_recipe.preparation_id;

          if found and v_prep.yield_quantity > 0 then
            v_factor := (v_recipe.quantity / v_prep.yield_quantity) * v_product_qty;
            for v_prep_item in
              select * from public.preparation_items where preparation_id = v_prep.id
            loop
              select coalesce(avg_cost_usd, 0) into v_unit_cost
              from public.ingredients where id = v_prep_item.ingredient_id;
              v_unit_cost := coalesce(v_unit_cost, 0);
              v_qty_base := v_prep_item.quantity_base * v_factor;

              insert into public.stock_movements (
                item_type, ingredient_id, movement_type, quantity_base,
                unit_cost_usd, total_cost_usd, reference_type, reference_id, notes, created_by
              ) values (
                'ingredient', v_prep_item.ingredient_id, 'sale', -v_qty_base,
                v_unit_cost, -v_qty_base * v_unit_cost,
                'sale', v_sale_id, 'Venta ' || v_order_number, auth.uid()
              );

              update public.ingredients
              set stock_base = stock_base - v_qty_base
              where id = v_prep_item.ingredient_id;
            end loop;
          end if;
        else
          select coalesce(avg_cost_usd, 0) into v_unit_cost
          from public.ingredients where id = v_recipe.ingredient_id;
          v_unit_cost := coalesce(v_unit_cost, 0);
          v_qty_base := v_recipe.quantity * v_product_qty;

          insert into public.stock_movements (
            item_type, ingredient_id, movement_type, quantity_base,
            unit_cost_usd, total_cost_usd, reference_type, reference_id, notes, created_by
          ) values (
            'ingredient', v_recipe.ingredient_id, 'sale', -v_qty_base,
            v_unit_cost, -v_qty_base * v_unit_cost,
            'sale', v_sale_id, 'Venta ' || v_order_number, auth.uid()
          );

          update public.ingredients
          set stock_base = stock_base - v_qty_base
          where id = v_recipe.ingredient_id;
        end if;
      end loop;
    elsif v_product.track_stock then
      insert into public.stock_movements (
        item_type, product_id, movement_type, quantity_base,
        unit_cost_usd, total_cost_usd, reference_type, reference_id, notes, created_by
      ) values (
        'product', v_product.id, 'sale', -v_product_qty,
        coalesce((v_item->>'unit_cost_usd')::numeric, 0),
        -v_product_qty * coalesce((v_item->>'unit_cost_usd')::numeric, 0),
        'sale', v_sale_id, 'Venta ' || v_order_number, auth.uid()
      );

      update public.products
      set stock_base = stock_base - v_product_qty
      where id = v_product.id;
    end if;

    for v_option in select value from jsonb_array_elements(coalesce(v_item->'options', '[]'::jsonb))
    loop
      if nullif(v_option->>'option_id', '') is not null then
        for v_opt_recipe in
          select * from public.option_recipe_items
          where option_id = (v_option->>'option_id')::uuid
        loop
          if v_opt_recipe.component_type = 'preparation' then
            select * into v_prep
            from public.preparations
            where id = v_opt_recipe.preparation_id;

            if found and v_prep.yield_quantity > 0 then
              v_factor := (v_opt_recipe.quantity / v_prep.yield_quantity) * v_product_qty;
              for v_prep_item in
                select * from public.preparation_items where preparation_id = v_prep.id
              loop
                select coalesce(avg_cost_usd, 0) into v_unit_cost
                from public.ingredients where id = v_prep_item.ingredient_id;
                v_unit_cost := coalesce(v_unit_cost, 0);
                v_qty_base := v_prep_item.quantity_base * v_factor;

                insert into public.stock_movements (
                  item_type, ingredient_id, movement_type, quantity_base,
                  unit_cost_usd, total_cost_usd, reference_type, reference_id, notes, created_by
                ) values (
                  'ingredient', v_prep_item.ingredient_id, 'sale', -v_qty_base,
                  v_unit_cost, -v_qty_base * v_unit_cost,
                  'sale', v_sale_id, 'Venta ' || v_order_number, auth.uid()
                );

                update public.ingredients
                set stock_base = stock_base - v_qty_base
                where id = v_prep_item.ingredient_id;
              end loop;
            end if;
          else
            select coalesce(avg_cost_usd, 0) into v_unit_cost
            from public.ingredients where id = v_opt_recipe.ingredient_id;
            v_unit_cost := coalesce(v_unit_cost, 0);
            v_qty_base := v_opt_recipe.quantity * v_product_qty;

            insert into public.stock_movements (
              item_type, ingredient_id, movement_type, quantity_base,
              unit_cost_usd, total_cost_usd, reference_type, reference_id, notes, created_by
            ) values (
              'ingredient', v_opt_recipe.ingredient_id, 'sale', -v_qty_base,
              v_unit_cost, -v_qty_base * v_unit_cost,
              'sale', v_sale_id, 'Venta ' || v_order_number, auth.uid()
            );

            update public.ingredients
            set stock_base = stock_base - v_qty_base
            where id = v_opt_recipe.ingredient_id;
          end if;
        end loop;
      end if;
    end loop;
  end loop;

  for v_payment in select value from jsonb_array_elements(coalesce(payload->'payments', '[]'::jsonb))
  loop
    if v_payment ? 'affects_cash' then
      v_affects_cash := (v_payment->>'affects_cash')::boolean;
    else
      select coalesce(affects_cash, false) into v_affects_cash
      from public.payment_methods
      where id = nullif(v_payment->>'payment_method_id', '')::uuid;
      v_affects_cash := coalesce(v_affects_cash, false);
    end if;

    insert into public.sale_payments (
      sale_id,
      payment_method_id,
      method_code,
      method_name,
      currency,
      amount,
      amount_usd,
      rate_source,
      rate_value,
      reference
    ) values (
      v_sale_id,
      nullif(v_payment->>'payment_method_id', '')::uuid,
      coalesce(v_payment->>'method_code', 'efectivo_usd'),
      coalesce(v_payment->>'method_name', 'Pago'),
      coalesce(v_payment->>'currency', 'USD'),
      coalesce((v_payment->>'amount')::numeric, 0),
      coalesce((v_payment->>'amount_usd')::numeric, 0),
      v_payment->>'rate_source',
      nullif(v_payment->>'rate_value', '')::numeric,
      v_payment->>'reference'
    );

    if v_cash_session_id is not null then
      insert into public.cash_movements (
        cash_session_id,
        movement_type,
        payment_method_id,
        method_code,
        method_name,
        affects_cash,
        currency,
        amount,
        amount_usd,
        rate_source,
        rate_value,
        reference_type,
        reference_id,
        notes
      ) values (
        v_cash_session_id,
        'sale',
        nullif(v_payment->>'payment_method_id', '')::uuid,
        coalesce(v_payment->>'method_code', 'efectivo_usd'),
        coalesce(v_payment->>'method_name', 'Pago'),
        v_affects_cash,
        coalesce(v_payment->>'currency', 'USD'),
        coalesce((v_payment->>'amount')::numeric, 0),
        coalesce((v_payment->>'amount_usd')::numeric, 0),
        v_payment->>'rate_source',
        nullif(v_payment->>'rate_value', '')::numeric,
        'sale',
        v_sale_id,
        'Venta ' || v_order_number
      );
    end if;
  end loop;

  return jsonb_build_object(
    'sale_id', v_sale_id,
    'order_number', v_order_number,
    'duplicate', false
  );
end;
$$;

create or replace function public.register_purchase(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid := nullif(payload->>'client_id', '')::uuid;
  v_existing public.purchases%rowtype;
  v_purchase_id uuid;
  v_item jsonb;
  v_ing public.ingredients%rowtype;
  v_qty numeric;
  v_total numeric;
  v_base_qty numeric;
  v_unit_base numeric;
  v_new_stock numeric;
  v_new_avg numeric;
begin
  if not public.is_admin() then
    raise exception 'No autorizado';
  end if;

  if v_client_id is null then
    raise exception 'Falta client_id';
  end if;

  select * into v_existing from public.purchases where client_id = v_client_id;
  if found then
    return jsonb_build_object('purchase_id', v_existing.id, 'duplicate', true);
  end if;

  insert into public.purchases (
    client_id,
    purchase_date,
    supplier_name,
    total_usd,
    total_bs,
    rate_source,
    rate_value,
    payment_method_id,
    notes,
    created_by
  ) values (
    v_client_id,
    coalesce(nullif(payload->>'purchase_date', '')::date, current_date),
    payload->>'supplier_name',
    coalesce((payload->>'total_usd')::numeric, 0),
    coalesce((payload->>'total_bs')::numeric, 0),
    payload->>'rate_source',
    nullif(payload->>'rate_value', '')::numeric,
    nullif(payload->>'payment_method_id', '')::uuid,
    payload->>'notes',
    auth.uid()
  ) returning id into v_purchase_id;

  for v_item in select value from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    select * into v_ing
    from public.ingredients
    where id = (v_item->>'ingredient_id')::uuid
    for update;

    if not found then
      raise exception 'Ingrediente no encontrado: %', v_item->>'ingredient_id';
    end if;

    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    v_total := coalesce((v_item->>'total_usd')::numeric, 0);

    if v_qty <= 0 then
      raise exception 'Cantidad inválida en compra';
    end if;

    v_base_qty := v_qty * coalesce(v_ing.conversion_factor, 1);
    if v_base_qty <= 0 then
      raise exception 'Conversión inválida para %', v_ing.name;
    end if;

    v_unit_base := v_total / v_base_qty;
    v_new_stock := v_ing.stock_base + v_base_qty;

    if v_ing.stock_base > 0 and v_new_stock > 0 then
      v_new_avg := ((v_ing.stock_base * v_ing.avg_cost_usd) + v_total) / v_new_stock;
    else
      v_new_avg := v_unit_base;
    end if;

    insert into public.purchase_items (
      purchase_id,
      ingredient_id,
      quantity,
      unit_cost_usd,
      total_usd,
      base_quantity,
      unit_cost_base_usd
    ) values (
      v_purchase_id,
      v_ing.id,
      v_qty,
      v_total / v_qty,
      v_total,
      v_base_qty,
      v_unit_base
    );

    update public.ingredients
    set stock_base = v_new_stock,
        avg_cost_usd = v_new_avg
    where id = v_ing.id;

    insert into public.stock_movements (
      item_type, ingredient_id, movement_type, quantity_base,
      unit_cost_usd, total_cost_usd, reference_type, reference_id, notes, created_by
    ) values (
      'ingredient', v_ing.id, 'purchase', v_base_qty,
      v_unit_base, v_total, 'purchase', v_purchase_id, 'Compra', auth.uid()
    );
  end loop;

  return jsonb_build_object('purchase_id', v_purchase_id, 'duplicate', false);
end;
$$;

create or replace function public.close_cash_session(
  p_session_id uuid,
  p_counted_usd numeric,
  p_counted_bs numeric,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.cash_sessions%rowtype;
  v_expected_usd numeric;
  v_expected_bs numeric;
  v_diff_usd numeric;
  v_diff_bs numeric;
begin
  if not public.is_admin() then
    raise exception 'No autorizado';
  end if;

  select * into v_session
  from public.cash_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'Caja no encontrada';
  end if;

  select
    coalesce(sum(case when currency = 'USD' and affects_cash then amount else 0 end), 0),
    coalesce(sum(case when currency = 'BS' and affects_cash then amount else 0 end), 0)
  into v_expected_usd, v_expected_bs
  from public.cash_movements
  where cash_session_id = p_session_id
    and movement_type in ('sale', 'expense', 'withdrawal', 'adjustment');

  v_expected_usd := coalesce(v_session.opening_usd, 0) + v_expected_usd;
  v_expected_bs := coalesce(v_session.opening_bs, 0) + v_expected_bs;
  v_diff_usd := coalesce(p_counted_usd, 0) - v_expected_usd;
  v_diff_bs := coalesce(p_counted_bs, 0) - v_expected_bs;

  update public.cash_sessions
  set status = 'closed',
      closed_at = now(),
      expected_usd = v_expected_usd,
      expected_bs = v_expected_bs,
      counted_usd = coalesce(p_counted_usd, 0),
      counted_bs = coalesce(p_counted_bs, 0),
      difference_usd = v_diff_usd,
      difference_bs = v_diff_bs,
      notes = coalesce(p_notes, notes),
      closed_by = auth.uid()
  where id = p_session_id;

  return jsonb_build_object(
    'session_id', p_session_id,
    'expected_usd', v_expected_usd,
    'expected_bs', v_expected_bs,
    'difference_usd', v_diff_usd,
    'difference_bs', v_diff_bs
  );
end;
$$;

create or replace function public.complete_inventory_count(p_count_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count public.inventory_counts%rowtype;
  v_item public.inventory_count_items%rowtype;
  v_ing public.ingredients%rowtype;
  v_diff numeric;
  v_unit_cost numeric;
begin
  if not public.is_admin() then
    raise exception 'No autorizado';
  end if;

  select * into v_count
  from public.inventory_counts
  where id = p_count_id
  for update;

  if not found then
    raise exception 'Conteo no encontrado';
  end if;

  if v_count.status = 'completed' then
    return jsonb_build_object('count_id', p_count_id, 'duplicate', true);
  end if;

  for v_item in
    select * from public.inventory_count_items where count_id = p_count_id
  loop
    select * into v_ing
    from public.ingredients
    where id = v_item.ingredient_id
    for update;

    if found then
      v_diff := v_item.counted_qty_base - v_item.theoretical_qty_base;
      v_unit_cost := coalesce(v_ing.avg_cost_usd, 0);

      update public.ingredients
      set stock_base = v_item.counted_qty_base
      where id = v_ing.id;

      insert into public.stock_movements (
        item_type, ingredient_id, movement_type, quantity_base,
        unit_cost_usd, total_cost_usd, reference_type, reference_id, notes, created_by
      ) values (
        'ingredient', v_ing.id, 'adjustment', v_diff,
        v_unit_cost, v_diff * v_unit_cost,
        'inventory_count', p_count_id, 'Conteo semanal', auth.uid()
      );

      update public.inventory_count_items
      set difference_qty_base = v_diff,
          unit_cost_usd = v_unit_cost,
          difference_usd = v_diff * v_unit_cost
      where id = v_item.id;

      if v_diff < 0 then
        insert into public.expenses (
          expense_date,
          category,
          description,
          amount,
          currency,
          amount_usd,
          notes,
          created_by
        ) values (
          v_count.count_date,
          'Merma',
          'Diferencia de conteo: ' || v_ing.name,
          abs(v_diff) * v_unit_cost,
          'USD',
          abs(v_diff) * v_unit_cost,
          'Conteo ' || p_count_id,
          auth.uid()
        );
      end if;
    end if;
  end loop;

  update public.inventory_counts
  set status = 'completed',
      completed_at = now()
  where id = p_count_id;

  return jsonb_build_object('count_id', p_count_id, 'duplicate', false);
end;
$$;

create or replace function public.void_sale(p_sale_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales%rowtype;
  v_sm public.stock_movements%rowtype;
  v_cm public.cash_movements%rowtype;
begin
  if not public.is_admin() then
    raise exception 'No autorizado';
  end if;

  select * into v_sale
  from public.sales
  where id = p_sale_id
  for update;

  if not found then
    raise exception 'Venta no encontrada';
  end if;

  if v_sale.status = 'voided' then
    return jsonb_build_object('sale_id', p_sale_id, 'duplicate', true);
  end if;

  for v_sm in
    select * from public.stock_movements
    where reference_type = 'sale' and reference_id = p_sale_id
  loop
    insert into public.stock_movements (
      item_type, ingredient_id, product_id, movement_type, quantity_base,
      unit_cost_usd, total_cost_usd, reference_type, reference_id, notes, created_by
    ) values (
      v_sm.item_type, v_sm.ingredient_id, v_sm.product_id, 'adjustment', -v_sm.quantity_base,
      v_sm.unit_cost_usd, -v_sm.total_cost_usd, 'sale_void', p_sale_id,
      'Anulación ' || coalesce(v_sale.order_number, ''), auth.uid()
    );

    if v_sm.item_type = 'ingredient' then
      update public.ingredients
      set stock_base = stock_base - v_sm.quantity_base
      where id = v_sm.ingredient_id;
    else
      update public.products
      set stock_base = stock_base - v_sm.quantity_base
      where id = v_sm.product_id;
    end if;
  end loop;

  for v_cm in
    select * from public.cash_movements
    where reference_type = 'sale' and reference_id = p_sale_id
  loop
    insert into public.cash_movements (
      cash_session_id, movement_type, payment_method_id, method_code, method_name,
      affects_cash, currency, amount, amount_usd, rate_source, rate_value,
      reference_type, reference_id, notes
    ) values (
      v_cm.cash_session_id, 'adjustment', v_cm.payment_method_id, v_cm.method_code, v_cm.method_name,
      v_cm.affects_cash, v_cm.currency, -v_cm.amount, -v_cm.amount_usd,
      v_cm.rate_source, v_cm.rate_value, 'sale_void', p_sale_id,
      'Anulación ' || coalesce(v_sale.order_number, '')
    );
  end loop;

  update public.sales
  set status = 'voided',
      voided_at = now(),
      void_reason = p_reason
  where id = p_sale_id;

  return jsonb_build_object('sale_id', p_sale_id, 'duplicate', false);
end;
$$;

grant execute on function public.register_sale(jsonb) to authenticated;
grant execute on function public.register_purchase(jsonb) to authenticated;
grant execute on function public.close_cash_session(uuid, numeric, numeric, text) to authenticated;
grant execute on function public.complete_inventory_count(uuid) to authenticated;
grant execute on function public.void_sale(uuid, text) to authenticated;
-- 007_seed.sql
-- Menú inicial de La Cartha. Todo queda editable desde la app.

insert into public.ingredients (
  name, category, base_unit, purchase_unit, conversion_factor, track_stock
)
values
  ('Harina leudante', 'masa', 'g', 'kg', 1000, true),
  ('Huevo', 'masa', 'unit', 'unit', 1, true),
  ('Levadura', 'masa', 'g', 'g', 1, true),
  ('Sal', 'masa', 'g', 'g', 1, true),
  ('Azúcar', 'masa', 'g', 'g', 1, true),
  ('Agua', 'masa', 'ml', 'ml', 1, true),
  ('Salchicha', 'proteina', 'unit', 'unit', 1, true),
  ('Queso', 'proteina', 'g', 'kg', 1000, true),
  ('Dorito', 'topping', 'g', 'g', 1, true),
  ('Flamin Hot', 'topping', 'g', 'g', 1, true),
  ('Ramen', 'topping', 'g', 'g', 1, true),
  ('Corn Flake', 'topping', 'g', 'g', 1, true),
  ('Tocineta', 'salsa', 'g', 'g', 1, true),
  ('Mayonesa', 'salsa', 'g', 'g', 1, true),
  ('Salsa de tomate', 'salsa', 'g', 'g', 1, true),
  ('Mostaza', 'salsa', 'g', 'g', 1, true),
  ('BBQ', 'salsa', 'g', 'g', 1, true),
  ('Cheddar', 'salsa', 'g', 'g', 1, true),
  ('Palillos', 'empaque', 'unit', 'unit', 1, true),
  ('Empaque', 'empaque', 'unit', 'unit', 1, true),
  ('Refresco', 'bebida', 'ml', 'botella 1L', 1000, true),
  ('Agua embotellada', 'bebida', 'unit', 'unit', 1, true)
on conflict (name) do nothing;

-- Masa: rinde 12 banderillas
insert into public.preparations (name, yield_quantity, yield_unit, notes)
values ('Masa', 12, 'portion', 'Rinde aproximadamente 12 banderillas')
on conflict (name) do nothing;

do $$
declare
  v_prep uuid;
  v_ing uuid;
begin
  select id into v_prep from public.preparations where name = 'Masa';

  if v_prep is not null and not exists (
    select 1 from public.preparation_items where preparation_id = v_prep
  ) then
    select id into v_ing from public.ingredients where name = 'Harina leudante';
    insert into public.preparation_items (preparation_id, ingredient_id, quantity_base)
    values (v_prep, v_ing, 1000);

    select id into v_ing from public.ingredients where name = 'Huevo';
    insert into public.preparation_items (preparation_id, ingredient_id, quantity_base)
    values (v_prep, v_ing, 1);

    select id into v_ing from public.ingredients where name = 'Levadura';
    insert into public.preparation_items (preparation_id, ingredient_id, quantity_base)
    values (v_prep, v_ing, 30);

    select id into v_ing from public.ingredients where name = 'Sal';
    insert into public.preparation_items (preparation_id, ingredient_id, quantity_base)
    values (v_prep, v_ing, 1);

    select id into v_ing from public.ingredients where name = 'Azúcar';
    insert into public.preparation_items (preparation_id, ingredient_id, quantity_base)
    values (v_prep, v_ing, 1);

    select id into v_ing from public.ingredients where name = 'Agua';
    insert into public.preparation_items (preparation_id, ingredient_id, quantity_base)
    values (v_prep, v_ing, 500);
  end if;
end;
$$;

-- Productos iniciales
insert into public.products (
  name, category, product_type, price_usd, base_unit, track_stock, is_public, sort_order, description
)
values
  ('Salchicha entera', 'banderilla', 'recipe', 3.50, 'unit', false, true, 1,
   'Banderilla coreana con salchicha entera. Incluye 1 topping y salsas ilimitadas.'),
  ('Mixta', 'banderilla', 'recipe', 3.50, 'unit', false, true, 2,
   'Banderilla coreana mixta: salchicha y queso. Incluye 1 topping y salsas ilimitadas.'),
  ('Solo queso', 'banderilla', 'recipe', 4.00, 'unit', false, true, 3,
   'Banderilla coreana rellena de queso. Incluye 1 topping y salsas ilimitadas.'),
  ('Refresco', 'bebida', 'recipe', 1.00, 'ml', false, true, 10,
   'Vaso de refresco de 250 ml.'),
  ('Agua', 'bebida', 'simple', 1.00, 'unit', true, true, 11,
   'Agua embotellada.'),
  ('Postre', 'postre', 'simple', 3.00, 'unit', true, true, 20,
   'Postre del día.'),
  ('Nuggets', 'snack', 'simple', 2.50, 'unit', true, true, 30,
   'Porción de nuggets.'),
  ('Papitas', 'snack', 'simple', 2.50, 'unit', true, true, 31,
   'Porción de papitas.')
on conflict (name) do nothing;

-- Recetas base de las banderillas
do $$
declare
  v_product uuid;
  v_prep uuid;
  v_ing uuid;
begin
  select id into v_prep from public.preparations where name = 'Masa';

  -- Salchicha entera
  select id into v_product from public.products where name = 'Salchicha entera';
  if v_product is not null and not exists (
    select 1 from public.recipe_items where product_id = v_product
  ) then
    insert into public.recipe_items (product_id, slot, component_type, preparation_id, quantity)
    values (v_product, 'masa', 'preparation', v_prep, 1);

    select id into v_ing from public.ingredients where name = 'Salchicha';
    insert into public.recipe_items (product_id, slot, component_type, ingredient_id, quantity)
    values (v_product, 'salchicha', 'ingredient', v_ing, 1);

    select id into v_ing from public.ingredients where name = 'Palillos';
    insert into public.recipe_items (product_id, slot, component_type, ingredient_id, quantity)
    values (v_product, 'palillo', 'ingredient', v_ing, 1);

    select id into v_ing from public.ingredients where name = 'Empaque';
    insert into public.recipe_items (product_id, slot, component_type, ingredient_id, quantity)
    values (v_product, 'empaque', 'ingredient', v_ing, 1);
  end if;

  -- Mixta
  select id into v_product from public.products where name = 'Mixta';
  if v_product is not null and not exists (
    select 1 from public.recipe_items where product_id = v_product
  ) then
    insert into public.recipe_items (product_id, slot, component_type, preparation_id, quantity)
    values (v_product, 'masa', 'preparation', v_prep, 1);

    select id into v_ing from public.ingredients where name = 'Salchicha';
    insert into public.recipe_items (product_id, slot, component_type, ingredient_id, quantity)
    values (v_product, 'salchicha', 'ingredient', v_ing, 0.5);

    select id into v_ing from public.ingredients where name = 'Queso';
    insert into public.recipe_items (product_id, slot, component_type, ingredient_id, quantity)
    values (v_product, 'queso', 'ingredient', v_ing, 30);

    select id into v_ing from public.ingredients where name = 'Palillos';
    insert into public.recipe_items (product_id, slot, component_type, ingredient_id, quantity)
    values (v_product, 'palillo', 'ingredient', v_ing, 1);

    select id into v_ing from public.ingredients where name = 'Empaque';
    insert into public.recipe_items (product_id, slot, component_type, ingredient_id, quantity)
    values (v_product, 'empaque', 'ingredient', v_ing, 1);
  end if;

  -- Solo queso
  select id into v_product from public.products where name = 'Solo queso';
  if v_product is not null and not exists (
    select 1 from public.recipe_items where product_id = v_product
  ) then
    insert into public.recipe_items (product_id, slot, component_type, preparation_id, quantity)
    values (v_product, 'masa', 'preparation', v_prep, 1);

    select id into v_ing from public.ingredients where name = 'Queso';
    insert into public.recipe_items (product_id, slot, component_type, ingredient_id, quantity)
    values (v_product, 'queso', 'ingredient', v_ing, 60);

    select id into v_ing from public.ingredients where name = 'Palillos';
    insert into public.recipe_items (product_id, slot, component_type, ingredient_id, quantity)
    values (v_product, 'palillo', 'ingredient', v_ing, 1);

    select id into v_ing from public.ingredients where name = 'Empaque';
    insert into public.recipe_items (product_id, slot, component_type, ingredient_id, quantity)
    values (v_product, 'empaque', 'ingredient', v_ing, 1);
  end if;

  -- Refresco por vaso
  select id into v_product from public.products where name = 'Refresco';
  if v_product is not null and not exists (
    select 1 from public.recipe_items where product_id = v_product
  ) then
    select id into v_ing from public.ingredients where name = 'Refresco';
    insert into public.recipe_items (product_id, slot, component_type, ingredient_id, quantity)
    values (v_product, 'bebida', 'ingredient', v_ing, 250);
  end if;
end;
$$;

-- Grupos de opciones
insert into public.option_groups (
  name, slug, selection_type, min_select, max_select, required, sort_order
)
values
  ('Topping', 'topping', 'single', 1, 1, true, 1),
  ('Salsas', 'salsas', 'multiple', 0, null, false, 2)
on conflict (slug) do nothing;

-- Opciones
do $$
declare
  v_topping uuid;
  v_salsas uuid;
  v_option uuid;
  v_ing uuid;
begin
  select id into v_topping from public.option_groups where slug = 'topping';
  select id into v_salsas from public.option_groups where slug = 'salsas';

  insert into public.options (group_id, name, sort_order)
  values
    (v_topping, 'Dorito', 1),
    (v_topping, 'Flamin Hot', 2),
    (v_topping, 'Ramen', 3),
    (v_topping, 'Corn Flake', 4),
    (v_salsas, 'Tocineta', 1),
    (v_salsas, 'Mayonesa', 2),
    (v_salsas, 'Salsa de tomate', 3),
    (v_salsas, 'Mostaza', 4),
    (v_salsas, 'BBQ', 5),
    (v_salsas, 'Cheddar', 6)
  on conflict (group_id, name) do nothing;

  -- Toppings: 20 g por banderilla
  select id into v_option from public.options where group_id = v_topping and name = 'Dorito';
  select id into v_ing from public.ingredients where name = 'Dorito';
  if v_option is not null and not exists (
    select 1 from public.option_recipe_items where option_id = v_option
  ) then
    insert into public.option_recipe_items (option_id, component_type, ingredient_id, quantity)
    values (v_option, 'ingredient', v_ing, 20);
  end if;

  select id into v_option from public.options where group_id = v_topping and name = 'Flamin Hot';
  select id into v_ing from public.ingredients where name = 'Flamin Hot';
  if v_option is not null and not exists (
    select 1 from public.option_recipe_items where option_id = v_option
  ) then
    insert into public.option_recipe_items (option_id, component_type, ingredient_id, quantity)
    values (v_option, 'ingredient', v_ing, 20);
  end if;

  select id into v_option from public.options where group_id = v_topping and name = 'Ramen';
  select id into v_ing from public.ingredients where name = 'Ramen';
  if v_option is not null and not exists (
    select 1 from public.option_recipe_items where option_id = v_option
  ) then
    insert into public.option_recipe_items (option_id, component_type, ingredient_id, quantity)
    values (v_option, 'ingredient', v_ing, 20);
  end if;

  select id into v_option from public.options where group_id = v_topping and name = 'Corn Flake';
  select id into v_ing from public.ingredients where name = 'Corn Flake';
  if v_option is not null and not exists (
    select 1 from public.option_recipe_items where option_id = v_option
  ) then
    insert into public.option_recipe_items (option_id, component_type, ingredient_id, quantity)
    values (v_option, 'ingredient', v_ing, 20);
  end if;

  -- Salsas: 15 g por porción
  select id into v_option from public.options where group_id = v_salsas and name = 'Tocineta';
  select id into v_ing from public.ingredients where name = 'Tocineta';
  if v_option is not null and not exists (
    select 1 from public.option_recipe_items where option_id = v_option
  ) then
    insert into public.option_recipe_items (option_id, component_type, ingredient_id, quantity)
    values (v_option, 'ingredient', v_ing, 15);
  end if;

  select id into v_option from public.options where group_id = v_salsas and name = 'Mayonesa';
  select id into v_ing from public.ingredients where name = 'Mayonesa';
  if v_option is not null and not exists (
    select 1 from public.option_recipe_items where option_id = v_option
  ) then
    insert into public.option_recipe_items (option_id, component_type, ingredient_id, quantity)
    values (v_option, 'ingredient', v_ing, 15);
  end if;

  select id into v_option from public.options where group_id = v_salsas and name = 'Salsa de tomate';
  select id into v_ing from public.ingredients where name = 'Salsa de tomate';
  if v_option is not null and not exists (
    select 1 from public.option_recipe_items where option_id = v_option
  ) then
    insert into public.option_recipe_items (option_id, component_type, ingredient_id, quantity)
    values (v_option, 'ingredient', v_ing, 15);
  end if;

  select id into v_option from public.options where group_id = v_salsas and name = 'Mostaza';
  select id into v_ing from public.ingredients where name = 'Mostaza';
  if v_option is not null and not exists (
    select 1 from public.option_recipe_items where option_id = v_option
  ) then
    insert into public.option_recipe_items (option_id, component_type, ingredient_id, quantity)
    values (v_option, 'ingredient', v_ing, 15);
  end if;

  select id into v_option from public.options where group_id = v_salsas and name = 'BBQ';
  select id into v_ing from public.ingredients where name = 'BBQ';
  if v_option is not null and not exists (
    select 1 from public.option_recipe_items where option_id = v_option
  ) then
    insert into public.option_recipe_items (option_id, component_type, ingredient_id, quantity)
    values (v_option, 'ingredient', v_ing, 15);
  end if;

  select id into v_option from public.options where group_id = v_salsas and name = 'Cheddar';
  select id into v_ing from public.ingredients where name = 'Cheddar';
  if v_option is not null and not exists (
    select 1 from public.option_recipe_items where option_id = v_option
  ) then
    insert into public.option_recipe_items (option_id, component_type, ingredient_id, quantity)
    values (v_option, 'ingredient', v_ing, 15);
  end if;
end;
$$;
-- 008_storage.sql
-- Buckets para fotos, marca y QR de pago

insert into storage.buckets (id, name, public)
values
  ('product-images', 'product-images', true),
  ('brand', 'brand', true),
  ('payment-qr', 'payment-qr', false)
on conflict (id) do nothing;

drop policy if exists "lc_public_read_images" on storage.objects;
create policy "lc_public_read_images"
on storage.objects
for select
to anon, authenticated
using (bucket_id in ('product-images', 'brand'));

drop policy if exists "lc_admin_all_images" on storage.objects;
create policy "lc_admin_all_images"
on storage.objects
for all
to authenticated
using (
  public.is_admin()
  and bucket_id in ('product-images', 'brand', 'payment-qr')
)
with check (
  public.is_admin()
  and bucket_id in ('product-images', 'brand', 'payment-qr')
);

drop policy if exists "lc_admin_read_payment_qr" on storage.objects;
create policy "lc_admin_read_payment_qr"
on storage.objects
for select
to authenticated
using (public.is_admin() and bucket_id = 'payment-qr');

-- ===== 009_public_orders.sql =====

-- 009_public_orders.sql
-- Pedidos del menÃº pÃºblico y tablero de comandas

create table if not exists public.public_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  customer_name text not null,
  customer_phone text not null,
  customer_phone_normalized text not null,
  fulfillment text not null default 'pickup'
    check (fulfillment in ('pickup', 'delivery')),
  address text,
  notes text,
  status text not null default 'nuevo'
    check (status in ('nuevo', 'preparando', 'listo', 'entregado', 'cancelado')),
  subtotal_usd numeric(14, 2) not null default 0,
  total_usd numeric(14, 2) not null default 0,
  total_bs numeric(14, 2) not null default 0,
  rate_source text,
  rate_value numeric(14, 4),
  sale_id uuid references public.sales(id) on delete set null,
  paid_at timestamptz,
  accepted_at timestamptz,
  ready_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_public_orders_updated on public.public_orders;
create trigger trg_public_orders_updated
before update on public.public_orders
for each row execute function public.set_updated_at();

create index if not exists idx_public_orders_status
  on public.public_orders(status, created_at desc);
create index if not exists idx_public_orders_phone
  on public.public_orders(customer_phone_normalized, created_at desc);
create index if not exists idx_public_orders_sale
  on public.public_orders(sale_id);
create index if not exists idx_public_orders_created
  on public.public_orders(created_at desc);

create table if not exists public.public_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.public_orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price_usd numeric(14, 2) not null default 0,
  line_total_usd numeric(14, 2) not null default 0,
  config jsonb not null default '{}'::jsonb,
  notes text
);

create index if not exists idx_public_order_items_order
  on public.public_order_items(order_id);

create table if not exists public.public_order_item_options (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.public_order_items(id) on delete cascade,
  option_id uuid references public.options(id) on delete set null,
  group_id uuid references public.option_groups(id) on delete set null,
  group_name text,
  option_name text not null,
  price_delta_usd numeric(14, 2) not null default 0
);

create index if not exists idx_public_order_item_options_item
  on public.public_order_item_options(order_item_id);

-- RLS: solo administradores pueden leer y actualizar comandas.
alter table public.public_orders enable row level security;
alter table public.public_order_items enable row level security;
alter table public.public_order_item_options enable row level security;

drop policy if exists admin_all on public.public_orders;
create policy admin_all on public.public_orders
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists admin_all on public.public_order_items;
create policy admin_all on public.public_order_items
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists admin_all on public.public_order_item_options;
create policy admin_all on public.public_order_item_options
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke all on public.public_orders from anon;
revoke all on public.public_order_items from anon;
revoke all on public.public_order_item_options from anon;

grant select, insert, update, delete on public.public_orders to authenticated;
grant select, insert, update, delete on public.public_order_items to authenticated;
grant select, insert, update, delete on public.public_order_item_options to authenticated;

-- Realtime para que el tablero reciba los pedidos al instante.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'public_orders'
  ) then
    alter publication supabase_realtime add table public.public_orders;
  end if;
end $$;

create or replace function public.create_public_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business public.business_settings%rowtype;
  v_order_id uuid;
  v_order_number text;
  v_item jsonb;
  v_product public.products%rowtype;
  v_option public.options%rowtype;
  v_group public.option_groups%rowtype;
  v_option_ids uuid[];
  v_option_id uuid;
  v_qty numeric;
  v_unit_price numeric;
  v_line_total numeric;
  v_total numeric := 0;
  v_item_id uuid;
  v_name text;
  v_phone text;
  v_phone_norm text;
  v_fulfillment text;
  v_address text;
  v_notes text;
  v_rate_source text;
  v_rate_value numeric;
  v_recent_count integer;
  v_active_count integer;
  v_item_count integer;
  v_selected integer;
  v_min_select integer;
  v_sauces jsonb;
  v_topping text;
begin
  select * into v_business from public.business_settings where id = 1;
  if not found or v_business.public_menu_enabled is not true then
    raise exception 'El menÃº pÃºblico estÃ¡ cerrado';
  end if;

  v_name := trim(coalesce(payload->>'customer_name', ''));
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'Escribe un nombre vÃ¡lido';
  end if;

  v_phone := trim(coalesce(payload->>'customer_phone', ''));
  v_phone_norm := regexp_replace(v_phone, '[^0-9]', '', 'g');
  if length(v_phone_norm) < 7 or length(v_phone_norm) > 15 then
    raise exception 'Escribe un telÃ©fono vÃ¡lido';
  end if;

  v_fulfillment := coalesce(nullif(payload->>'fulfillment', ''), 'pickup');
  if v_fulfillment not in ('pickup', 'delivery') then
    raise exception 'Tipo de entrega invÃ¡lido';
  end if;
  if v_fulfillment = 'delivery' and v_business.delivery_enabled is not true then
    raise exception 'El delivery estÃ¡ desactivado';
  end if;
  if v_fulfillment = 'pickup' and v_business.pickup_enabled is not true then
    raise exception 'El pickup estÃ¡ desactivado';
  end if;

  v_address := nullif(trim(coalesce(payload->>'address', '')), '');
  if v_fulfillment = 'delivery' and (v_address is null or length(v_address) < 5) then
    raise exception 'Escribe una direcciÃ³n para el delivery';
  end if;
  if v_address is not null and length(v_address) > 300 then
    raise exception 'La direcciÃ³n es demasiado larga';
  end if;

  v_notes := nullif(trim(coalesce(payload->>'notes', '')), '');
  if v_notes is not null and length(v_notes) > 500 then
    raise exception 'Las notas son demasiado largas';
  end if;

  -- LÃ­mite anti-spam por telÃ©fono.
  select count(*) into v_recent_count
  from public.public_orders
  where customer_phone_normalized = v_phone_norm
    and created_at > now() - interval '10 minutes';
  if v_recent_count >= 5 then
    raise exception 'Demasiados pedidos seguidos. Espera unos minutos o escrÃ­benos por WhatsApp';
  end if;

  select count(*) into v_active_count
  from public.public_orders
  where customer_phone_normalized = v_phone_norm
    and status in ('nuevo', 'preparando', 'listo');
  if v_active_count >= 3 then
    raise exception 'Ya tienes varios pedidos activos. EscrÃ­benos por WhatsApp para agregar otro';
  end if;

  v_item_count := jsonb_array_length(coalesce(payload->'items', '[]'::jsonb));
  if v_item_count = 0 then
    raise exception 'El pedido estÃ¡ vacÃ­o';
  end if;
  if v_item_count > 30 then
    raise exception 'El pedido tiene demasiados artÃ­culos';
  end if;

  v_rate_source := coalesce(nullif(payload->>'rate_source', ''), 'bcv_eur');
  if v_rate_source not in ('bcv_usd', 'bcv_eur', 'usdt', 'manual') then
    v_rate_source := 'bcv_eur';
  end if;

  v_rate_value := nullif(payload->>'rate_value', '')::numeric;
  if v_rate_value is null or v_rate_value <= 0 then
    select coalesce(bcv_eur, bcv_usd, usdt, 0)
    into v_rate_value
    from public.rate_snapshots
    order by snapshot_date desc
    limit 1;
  end if;
  v_rate_value := coalesce(v_rate_value, 0);

  v_order_number := 'C-' ||
    to_char(now() at time zone 'America/Caracas', 'YYMMDD-HH24MISS') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));

  insert into public.public_orders (
    order_number,
    customer_name,
    customer_phone,
    customer_phone_normalized,
    fulfillment,
    address,
    notes,
    status,
    rate_source,
    rate_value
  ) values (
    v_order_number,
    v_name,
    v_phone,
    v_phone_norm,
    v_fulfillment,
    v_address,
    v_notes,
    'nuevo',
    v_rate_source,
    v_rate_value
  ) returning id into v_order_id;

  for v_item in
    select value from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    select * into v_product
    from public.products
    where id = nullif(v_item->>'product_id', '')::uuid
      and active = true
      and is_public = true;

    if not found then
      raise exception 'Producto no disponible';
    end if;

    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    if v_qty <= 0 or v_qty > 50 or v_qty <> floor(v_qty) then
      raise exception 'Cantidad invÃ¡lida en %', v_product.name;
    end if;

    v_option_ids := array(
      select distinct value::uuid
      from jsonb_array_elements_text(
        coalesce(v_item->'option_ids', '[]'::jsonb)
      ) as value
      where value is not null and value <> ''
    );

    if v_product.category <> 'banderilla' and coalesce(array_length(v_option_ids, 1), 0) > 0 then
      raise exception '% no lleva toppings ni salsas', v_product.name;
    end if;

    -- Valida que cada opciÃ³n exista, estÃ© activa y pertenezca a un grupo activo.
    foreach v_option_id in array v_option_ids
    loop
      select o.* into v_option
      from public.options o
      join public.option_groups g on g.id = o.group_id
      where o.id = v_option_id
        and o.active = true
        and g.active = true;

      if not found then
        raise exception 'Una de las opciones seleccionadas no estÃ¡ disponible';
      end if;
    end loop;

    -- Valida mÃ­nimos, mÃ¡ximos y selecciÃ³n Ãºnica por grupo.
    for v_group in
      select * from public.option_groups where active = true
    loop
      select count(*) into v_selected
      from public.options o
      where o.group_id = v_group.id
        and o.id = any(v_option_ids)
        and o.active = true;

      v_min_select := greatest(
        coalesce(v_group.min_select, 0),
        case when v_group.required then 1 else 0 end
      );

      if v_selected < v_min_select then
        raise exception 'Falta seleccionar %', v_group.name;
      end if;
      if v_group.max_select is not null and v_selected > v_group.max_select then
        raise exception 'Demasiadas opciones en %', v_group.name;
      end if;
      if v_group.selection_type = 'single' and v_selected > 1 then
        raise exception 'Solo puedes elegir una opciÃ³n en %', v_group.name;
      end if;
    end loop;

    select coalesce(sum(o.price_delta_usd), 0)
    into v_unit_price
    from public.options o
    where o.id = any(v_option_ids);

    v_unit_price := coalesce(v_product.price_usd, 0) + v_unit_price;
    v_line_total := v_unit_price * v_qty;

    v_topping := (
      select o.name
      from public.options o
      join public.option_groups g on g.id = o.group_id
      where o.id = any(v_option_ids)
        and g.slug = 'topping'
      limit 1
    );

    select coalesce(jsonb_agg(o.name order by o.sort_order, o.name), '[]'::jsonb)
    into v_sauces
    from public.options o
    join public.option_groups g on g.id = o.group_id
    where o.id = any(v_option_ids)
      and g.slug = 'salsas';

    insert into public.public_order_items (
      order_id,
      product_id,
      product_name,
      quantity,
      unit_price_usd,
      line_total_usd,
      config,
      notes
    ) values (
      v_order_id,
      v_product.id,
      v_product.name,
      v_qty,
      v_unit_price,
      v_line_total,
      jsonb_build_object(
        'topping', v_topping,
        'sauces', v_sauces,
        'options', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'option_id', o.id,
            'group_name', g.name,
            'option_name', o.name,
            'price_delta_usd', o.price_delta_usd
          ) order by g.sort_order, o.sort_order), '[]'::jsonb)
          from public.options o
          join public.option_groups g on g.id = o.group_id
          where o.id = any(v_option_ids)
        )
      ),
      nullif(trim(coalesce(v_item->>'notes', '')), '')
    ) returning id into v_item_id;

    insert into public.public_order_item_options (
      order_item_id,
      option_id,
      group_id,
      group_name,
      option_name,
      price_delta_usd
    )
    select
      v_item_id,
      o.id,
      g.id,
      g.name,
      o.name,
      o.price_delta_usd
    from public.options o
    join public.option_groups g on g.id = o.group_id
    where o.id = any(v_option_ids)
    order by g.sort_order, o.sort_order;

    v_total := v_total + v_line_total;
  end loop;

  update public.public_orders
  set subtotal_usd = v_total,
      total_usd = v_total,
      total_bs = round(v_total * v_rate_value, 2)
  where id = v_order_id;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'total_usd', v_total,
    'total_bs', round(v_total * v_rate_value, 2),
    'rate_source', v_rate_source,
    'rate_value', v_rate_value
  );
end;
$$;

revoke all on function public.create_public_order(jsonb) from public;
grant execute on function public.create_public_order(jsonb) to anon, authenticated;


-- ===== 010_cash_bills.sql =====

-- 010_cash_bills.sql
-- Caja por billetes de dÃ³lar, vuelto y mÃ©todos de pago

alter table public.cash_sessions
  add column if not exists exchange_rate numeric(14, 4),
  add column if not exists expected_total_usd numeric(14, 2);

alter table public.sale_payments
  add column if not exists received_amount numeric(14, 2),
  add column if not exists received_usd numeric(14, 2),
  add column if not exists change_usd numeric(14, 2) not null default 0,
  add column if not exists change_bs numeric(14, 2) not null default 0,
  add column if not exists change_pm_amount numeric(14, 2) not null default 0,
  add column if not exists change_pm_reference text,
  add column if not exists bills jsonb,
  add column if not exists change_bills jsonb;

alter table public.cash_movements
  add column if not exists received_amount numeric(14, 2),
  add column if not exists change_usd numeric(14, 2) not null default 0,
  add column if not exists change_bs numeric(14, 2) not null default 0,
  add column if not exists change_pm_amount numeric(14, 2) not null default 0;

create table if not exists public.cash_bill_movements (
  id uuid primary key default gen_random_uuid(),
  cash_session_id uuid not null references public.cash_sessions(id) on delete cascade,
  sale_id uuid references public.sales(id) on delete set null,
  type text not null
    check (type in ('apertura', 'venta', 'vuelto', 'ajuste', 'cierre', 'gasto', 'retiro')),
  denomination numeric(14, 2) not null
    check (denomination in (100, 50, 20, 10, 5, 2, 1)),
  quantity integer not null check (quantity > 0),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_cash_bill_movements_session
  on public.cash_bill_movements(cash_session_id, created_at);
create index if not exists idx_cash_bill_movements_sale
  on public.cash_bill_movements(sale_id);
create index if not exists idx_cash_bill_movements_type
  on public.cash_bill_movements(cash_session_id, type);

alter table public.cash_bill_movements enable row level security;

drop policy if exists admin_all on public.cash_bill_movements;
create policy admin_all on public.cash_bill_movements
for all to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke all on public.cash_bill_movements from anon;
grant select, insert, update, delete on public.cash_bill_movements to authenticated;


-- ===== 011_functions_orders_cash.sql =====

-- 011_functions_orders_cash.sql
-- register_sale, close_cash_session y void_sale con comandas, billetes y vuelto

create or replace function public.register_sale(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid := nullif(payload->>'client_id', '')::uuid;
  v_existing public.sales%rowtype;
  v_sale_id uuid;
  v_sale_item_id uuid;
  v_order_number text := nullif(payload->>'order_number', '');
  v_cash_session_id uuid := nullif(payload->>'cash_session_id', '')::uuid;
  v_public_order_id uuid := nullif(payload->>'public_order_id', '')::uuid;
  v_item jsonb;
  v_option jsonb;
  v_payment jsonb;
  v_product public.products%rowtype;
  v_prep public.preparations%rowtype;
  v_recipe public.recipe_items%rowtype;
  v_opt_recipe public.option_recipe_items%rowtype;
  v_prep_item public.preparation_items%rowtype;
  v_product_qty numeric;
  v_qty_base numeric;
  v_unit_cost numeric;
  v_factor numeric;
  v_affects_cash boolean;
  v_paid_usd numeric;
  v_sale_rate numeric := nullif(payload->>'rate_value', '')::numeric;
  v_received_amount numeric;
  v_received_usd numeric;
  v_change_usd numeric;
  v_change_bs numeric;
  v_change_pm numeric;
  v_change_pm_ref text;
  v_bills jsonb;
  v_change_bills jsonb;
  v_bill_denom numeric;
  v_bill_qty numeric;
  v_cash_amount numeric;
  v_cash_amount_usd numeric;
begin
  if not public.is_admin() then
    raise exception 'No autorizado';
  end if;

  if v_client_id is null then
    raise exception 'Falta client_id';
  end if;

  select * into v_existing from public.sales where client_id = v_client_id;
  if found then
    return jsonb_build_object(
      'sale_id', v_existing.id,
      'order_number', v_existing.order_number,
      'duplicate', true
    );
  end if;

  if v_public_order_id is not null then
    perform 1
    from public.public_orders
    where id = v_public_order_id
    for update;

    if not found then
      raise exception 'Comanda no encontrada';
    end if;

    if exists (
      select 1 from public.public_orders
      where id = v_public_order_id and sale_id is not null
    ) then
      raise exception 'La comanda ya fue cobrada';
    end if;
  end if;

  if v_order_number is null then
    v_order_number := 'LC-' || to_char(now(), 'YYMMDD-HH24MISS') || '-' ||
      lpad((floor(random() * 1000))::text, 3, '0');
  end if;

  select coalesce(sum(coalesce((value->>'amount_usd')::numeric, 0)), 0)
  into v_paid_usd
  from jsonb_array_elements(coalesce(payload->'payments', '[]'::jsonb));

  if abs(v_paid_usd - coalesce((payload->>'total_usd')::numeric, 0)) > 0.02 then
    raise exception 'Los pagos no cuadran con el total de la venta';
  end if;

  insert into public.sales (
    client_id,
    order_number,
    cash_session_id,
    status,
    subtotal_usd,
    discount_usd,
    total_usd,
    total_bs,
    change_usd,
    change_bs,
    rate_source,
    rate_value,
    customer_name,
    notes,
    created_by,
    created_at
  ) values (
    v_client_id,
    v_order_number,
    v_cash_session_id,
    'completed',
    coalesce((payload->>'subtotal_usd')::numeric, 0),
    coalesce((payload->>'discount_usd')::numeric, 0),
    coalesce((payload->>'total_usd')::numeric, 0),
    coalesce((payload->>'total_bs')::numeric, 0),
    coalesce((payload->>'change_usd')::numeric, 0),
    coalesce((payload->>'change_bs')::numeric, 0),
    payload->>'rate_source',
    v_sale_rate,
    payload->>'customer_name',
    payload->>'notes',
    auth.uid(),
    coalesce(nullif(payload->>'created_at', '')::timestamptz, now())
  ) returning id into v_sale_id;

  for v_item in select value from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    select * into v_product
    from public.products
    where id = (v_item->>'product_id')::uuid;

    if not found then
      raise exception 'Producto no encontrado: %', v_item->>'product_id';
    end if;

    v_product_qty := coalesce((v_item->>'quantity')::numeric, 0);
    if v_product_qty <= 0 then
      raise exception 'Cantidad invÃ¡lida en venta';
    end if;

    insert into public.sale_items (
      sale_id,
      product_id,
      product_name,
      quantity,
      unit_price_usd,
      unit_cost_usd,
      line_total_usd,
      config,
      notes
    ) values (
      v_sale_id,
      v_product.id,
      coalesce(v_item->>'product_name', v_product.name),
      v_product_qty,
      coalesce((v_item->>'unit_price_usd')::numeric, 0),
      coalesce((v_item->>'unit_cost_usd')::numeric, 0),
      coalesce((v_item->>'line_total_usd')::numeric, 0),
      coalesce(v_item->'config', '{}'::jsonb),
      v_item->>'notes'
    ) returning id into v_sale_item_id;

    for v_option in select value from jsonb_array_elements(coalesce(v_item->'options', '[]'::jsonb))
    loop
      insert into public.sale_item_options (
        sale_item_id,
        option_id,
        group_name,
        option_name,
        price_delta_usd,
        unit_cost_usd
      ) values (
        v_sale_item_id,
        nullif(v_option->>'option_id', '')::uuid,
        v_option->>'group_name',
        coalesce(v_option->>'option_name', v_option->>'name', 'OpciÃ³n'),
        coalesce((v_option->>'price_delta_usd')::numeric, 0),
        coalesce((v_option->>'unit_cost_usd')::numeric, 0)
      );
    end loop;

    if v_product.product_type = 'recipe' then
      for v_recipe in
        select * from public.recipe_items where product_id = v_product.id
      loop
        if v_recipe.component_type = 'preparation' then
          select * into v_prep
          from public.preparations
          where id = v_recipe.preparation_id;

          if found and v_prep.yield_quantity > 0 then
            v_factor := (v_recipe.quantity / v_prep.yield_quantity) * v_product_qty;
            for v_prep_item in
              select * from public.preparation_items where preparation_id = v_prep.id
            loop
              select coalesce(avg_cost_usd, 0) into v_unit_cost
              from public.ingredients where id = v_prep_item.ingredient_id;
              v_unit_cost := coalesce(v_unit_cost, 0);
              v_qty_base := v_prep_item.quantity_base * v_factor;

              insert into public.stock_movements (
                item_type, ingredient_id, movement_type, quantity_base,
                unit_cost_usd, total_cost_usd, reference_type, reference_id, notes, created_by
              ) values (
                'ingredient', v_prep_item.ingredient_id, 'sale', -v_qty_base,
                v_unit_cost, -v_qty_base * v_unit_cost,
                'sale', v_sale_id, 'Venta ' || v_order_number, auth.uid()
              );

              update public.ingredients
              set stock_base = stock_base - v_qty_base
              where id = v_prep_item.ingredient_id;
            end loop;
          end if;
        else
          select coalesce(avg_cost_usd, 0) into v_unit_cost
          from public.ingredients where id = v_recipe.ingredient_id;
          v_unit_cost := coalesce(v_unit_cost, 0);
          v_qty_base := v_recipe.quantity * v_product_qty;

          insert into public.stock_movements (
            item_type, ingredient_id, movement_type, quantity_base,
            unit_cost_usd, total_cost_usd, reference_type, reference_id, notes, created_by
          ) values (
            'ingredient', v_recipe.ingredient_id, 'sale', -v_qty_base,
            v_unit_cost, -v_qty_base * v_unit_cost,
            'sale', v_sale_id, 'Venta ' || v_order_number, auth.uid()
          );

          update public.ingredients
          set stock_base = stock_base - v_qty_base
          where id = v_recipe.ingredient_id;
        end if;
      end loop;
    elsif v_product.track_stock then
      insert into public.stock_movements (
        item_type, product_id, movement_type, quantity_base,
        unit_cost_usd, total_cost_usd, reference_type, reference_id, notes, created_by
      ) values (
        'product', v_product.id, 'sale', -v_product_qty,
        coalesce((v_item->>'unit_cost_usd')::numeric, 0),
        -v_product_qty * coalesce((v_item->>'unit_cost_usd')::numeric, 0),
        'sale', v_sale_id, 'Venta ' || v_order_number, auth.uid()
      );

      update public.products
      set stock_base = stock_base - v_product_qty
      where id = v_product.id;
    end if;

    for v_option in select value from jsonb_array_elements(coalesce(v_item->'options', '[]'::jsonb))
    loop
      if nullif(v_option->>'option_id', '') is not null then
        for v_opt_recipe in
          select * from public.option_recipe_items
          where option_id = (v_option->>'option_id')::uuid
        loop
          if v_opt_recipe.component_type = 'preparation' then
            select * into v_prep
            from public.preparations
            where id = v_opt_recipe.preparation_id;

            if found and v_prep.yield_quantity > 0 then
              v_factor := (v_opt_recipe.quantity / v_prep.yield_quantity) * v_product_qty;
              for v_prep_item in
                select * from public.preparation_items where preparation_id = v_prep.id
              loop
                select coalesce(avg_cost_usd, 0) into v_unit_cost
                from public.ingredients where id = v_prep_item.ingredient_id;
                v_unit_cost := coalesce(v_unit_cost, 0);
                v_qty_base := v_prep_item.quantity_base * v_factor;

                insert into public.stock_movements (
                  item_type, ingredient_id, movement_type, quantity_base,
                  unit_cost_usd, total_cost_usd, reference_type, reference_id, notes, created_by
                ) values (
                  'ingredient', v_prep_item.ingredient_id, 'sale', -v_qty_base,
                  v_unit_cost, -v_qty_base * v_unit_cost,
                  'sale', v_sale_id, 'Venta ' || v_order_number, auth.uid()
                );

                update public.ingredients
                set stock_base = stock_base - v_qty_base
                where id = v_prep_item.ingredient_id;
              end loop;
            end if;
          else
            select coalesce(avg_cost_usd, 0) into v_unit_cost
            from public.ingredients where id = v_opt_recipe.ingredient_id;
            v_unit_cost := coalesce(v_unit_cost, 0);
            v_qty_base := v_opt_recipe.quantity * v_product_qty;

            insert into public.stock_movements (
              item_type, ingredient_id, movement_type, quantity_base,
              unit_cost_usd, total_cost_usd, reference_type, reference_id, notes, created_by
            ) values (
              'ingredient', v_opt_recipe.ingredient_id, 'sale', -v_qty_base,
              v_unit_cost, -v_qty_base * v_unit_cost,
              'sale', v_sale_id, 'Venta ' || v_order_number, auth.uid()
            );

            update public.ingredients
            set stock_base = stock_base - v_qty_base
            where id = v_opt_recipe.ingredient_id;
          end if;
        end loop;
      end if;
    end loop;
  end loop;

  for v_payment in select value from jsonb_array_elements(coalesce(payload->'payments', '[]'::jsonb))
  loop
    if v_payment ? 'affects_cash' then
      v_affects_cash := (v_payment->>'affects_cash')::boolean;
    else
      select coalesce(affects_cash, false) into v_affects_cash
      from public.payment_methods
      where id = nullif(v_payment->>'payment_method_id', '')::uuid;
      v_affects_cash := coalesce(v_affects_cash, false);
    end if;

    v_received_amount := coalesce(
      (v_payment->>'received_amount')::numeric,
      (v_payment->>'amount')::numeric,
      0
    );
    v_received_usd := coalesce(
      (v_payment->>'received_usd')::numeric,
      (v_payment->>'amount_usd')::numeric,
      0
    );
    v_change_usd := coalesce((v_payment->>'change_usd')::numeric, 0);
    v_change_bs := coalesce((v_payment->>'change_bs')::numeric, 0);
    v_change_pm := coalesce((v_payment->>'change_pm_amount')::numeric, 0);
    v_change_pm_ref := nullif(v_payment->>'change_pm_reference', '');
    v_bills := nullif(v_payment->'bills', 'null'::jsonb);
    v_change_bills := nullif(v_payment->'change_bills', 'null'::jsonb);

    if v_affects_cash and v_received_usd > 0 and v_sale_rate > 0 then
      if abs(
        (v_received_usd - coalesce((v_payment->>'amount_usd')::numeric, 0)) -
        (v_change_usd + (v_change_bs / v_sale_rate) + v_change_pm)
      ) > 0.06 then
        raise exception 'El vuelto no cuadra con el pago';
      end if;
    end if;

    insert into public.sale_payments (
      sale_id,
      payment_method_id,
      method_code,
      method_name,
      currency,
      amount,
      amount_usd,
      received_amount,
      received_usd,
      change_usd,
      change_bs,
      change_pm_amount,
      change_pm_reference,
      bills,
      change_bills,
      rate_source,
      rate_value,
      reference
    ) values (
      v_sale_id,
      nullif(v_payment->>'payment_method_id', '')::uuid,
      coalesce(v_payment->>'method_code', 'efectivo_usd'),
      coalesce(v_payment->>'method_name', 'Pago'),
      coalesce(v_payment->>'currency', 'USD'),
      coalesce((v_payment->>'amount')::numeric, 0),
      coalesce((v_payment->>'amount_usd')::numeric, 0),
      v_received_amount,
      v_received_usd,
      v_change_usd,
      v_change_bs,
      v_change_pm,
      v_change_pm_ref,
      v_bills,
      v_change_bills,
      v_payment->>'rate_source',
      nullif(v_payment->>'rate_value', '')::numeric,
      v_payment->>'reference'
    );

    v_cash_amount := case
      when v_affects_cash then v_received_amount
      else coalesce((v_payment->>'amount')::numeric, 0)
    end;
    v_cash_amount_usd := case
      when v_affects_cash then v_received_usd
      else coalesce((v_payment->>'amount_usd')::numeric, 0)
    end;

    if v_cash_session_id is not null then
      insert into public.cash_movements (
        cash_session_id,
        movement_type,
        payment_method_id,
        method_code,
        method_name,
        affects_cash,
        currency,
        amount,
        amount_usd,
        received_amount,
        change_usd,
        change_bs,
        change_pm_amount,
        rate_source,
        rate_value,
        reference_type,
        reference_id,
        notes
      ) values (
        v_cash_session_id,
        'sale',
        nullif(v_payment->>'payment_method_id', '')::uuid,
        coalesce(v_payment->>'method_code', 'efectivo_usd'),
        coalesce(v_payment->>'method_name', 'Pago'),
        v_affects_cash,
        coalesce(v_payment->>'currency', 'USD'),
        v_cash_amount,
        v_cash_amount_usd,
        v_received_amount,
        v_change_usd,
        v_change_bs,
        v_change_pm,
        v_payment->>'rate_source',
        nullif(v_payment->>'rate_value', '')::numeric,
        'sale',
        v_sale_id,
        'Venta ' || v_order_number
      );

      if v_affects_cash and v_bills is not null then
        for v_bill_denom, v_bill_qty in
          select key::numeric, value::numeric from jsonb_each_text(v_bills)
        loop
          if v_bill_qty > 0 then
            if v_bill_qty <> floor(v_bill_qty) then
              raise exception 'Cantidad de billetes invÃ¡lida';
            end if;
            if v_bill_denom not in (100, 50, 20, 10, 5, 2, 1) then
              raise exception 'DenominaciÃ³n de billete invÃ¡lida';
            end if;

            insert into public.cash_bill_movements (
              cash_session_id, sale_id, type, denomination, quantity, note
            ) values (
              v_cash_session_id, v_sale_id, 'venta', v_bill_denom, v_bill_qty::integer,
              'Venta ' || v_order_number
            );
          end if;
        end loop;
      end if;

      if v_affects_cash and v_change_bills is not null then
        for v_bill_denom, v_bill_qty in
          select key::numeric, value::numeric from jsonb_each_text(v_change_bills)
        loop
          if v_bill_qty > 0 then
            if v_bill_qty <> floor(v_bill_qty) then
              raise exception 'Cantidad de billetes invÃ¡lida';
            end if;
            if v_bill_denom not in (100, 50, 20, 10, 5, 2, 1) then
              raise exception 'DenominaciÃ³n de billete invÃ¡lida';
            end if;

            insert into public.cash_bill_movements (
              cash_session_id, sale_id, type, denomination, quantity, note
            ) values (
              v_cash_session_id, v_sale_id, 'vuelto', v_bill_denom, v_bill_qty::integer,
              'Vuelto ' || v_order_number
            );
          end if;
        end loop;
      end if;
    end if;
  end loop;

  if v_public_order_id is not null then
    update public.public_orders
    set sale_id = v_sale_id,
        paid_at = now(),
        status = 'entregado',
        delivered_at = now(),
        updated_at = now()
    where id = v_public_order_id
      and sale_id is null;

    if not found then
      raise exception 'La comanda ya fue cobrada';
    end if;
  end if;

  return jsonb_build_object(
    'sale_id', v_sale_id,
    'order_number', v_order_number,
    'public_order_id', v_public_order_id,
    'duplicate', false
  );
end;
$$;

create or replace function public.close_cash_session(
  p_session_id uuid,
  p_counted_usd numeric,
  p_counted_bs numeric,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.cash_sessions%rowtype;
  v_cash_usd numeric;
  v_cash_bs numeric;
  v_change_usd numeric;
  v_change_bs numeric;
  v_expected_usd numeric;
  v_expected_bs numeric;
  v_expected_total_usd numeric;
  v_diff_usd numeric;
  v_diff_bs numeric;
begin
  if not public.is_admin() then
    raise exception 'No autorizado';
  end if;

  select * into v_session
  from public.cash_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'Caja no encontrada';
  end if;

  select
    coalesce(sum(case when currency = 'USD' and affects_cash then amount else 0 end), 0),
    coalesce(sum(case when currency = 'BS' and affects_cash then amount else 0 end), 0),
    coalesce(sum(case when affects_cash then change_usd else 0 end), 0),
    coalesce(sum(case when affects_cash then change_bs else 0 end), 0)
  into v_cash_usd, v_cash_bs, v_change_usd, v_change_bs
  from public.cash_movements
  where cash_session_id = p_session_id
    and movement_type in ('sale', 'expense', 'withdrawal', 'adjustment');

  v_expected_usd := coalesce(v_session.opening_usd, 0) + v_cash_usd - v_change_usd;
  v_expected_bs := coalesce(v_session.opening_bs, 0) + v_cash_bs - v_change_bs;
  v_expected_total_usd := v_expected_usd +
    case
      when coalesce(v_session.exchange_rate, 0) > 0
        then v_expected_bs / v_session.exchange_rate
      else 0
    end;

  v_diff_usd := coalesce(p_counted_usd, 0) - v_expected_usd;
  v_diff_bs := coalesce(p_counted_bs, 0) - v_expected_bs;

  update public.cash_sessions
  set status = 'closed',
      closed_at = now(),
      expected_usd = v_expected_usd,
      expected_bs = v_expected_bs,
      expected_total_usd = v_expected_total_usd,
      counted_usd = coalesce(p_counted_usd, 0),
      counted_bs = coalesce(p_counted_bs, 0),
      difference_usd = v_diff_usd,
      difference_bs = v_diff_bs,
      notes = coalesce(p_notes, notes),
      closed_by = auth.uid()
  where id = p_session_id;

  return jsonb_build_object(
    'session_id', p_session_id,
    'expected_usd', v_expected_usd,
    'expected_bs', v_expected_bs,
    'expected_total_usd', v_expected_total_usd,
    'difference_usd', v_diff_usd,
    'difference_bs', v_diff_bs
  );
end;
$$;

create or replace function public.void_sale(p_sale_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales%rowtype;
  v_sm public.stock_movements%rowtype;
  v_cm public.cash_movements%rowtype;
  v_bill public.cash_bill_movements%rowtype;
begin
  if not public.is_admin() then
    raise exception 'No autorizado';
  end if;

  select * into v_sale
  from public.sales
  where id = p_sale_id
  for update;

  if not found then
    raise exception 'Venta no encontrada';
  end if;

  if v_sale.status = 'voided' then
    return jsonb_build_object('sale_id', p_sale_id, 'duplicate', true);
  end if;

  for v_sm in
    select * from public.stock_movements
    where reference_type = 'sale' and reference_id = p_sale_id
  loop
    insert into public.stock_movements (
      item_type, ingredient_id, product_id, movement_type, quantity_base,
      unit_cost_usd, total_cost_usd, reference_type, reference_id, notes, created_by
    ) values (
      v_sm.item_type, v_sm.ingredient_id, v_sm.product_id, 'adjustment', -v_sm.quantity_base,
      v_sm.unit_cost_usd, -v_sm.total_cost_usd, 'sale_void', p_sale_id,
      'AnulaciÃ³n ' || coalesce(v_sale.order_number, ''), auth.uid()
    );

    if v_sm.item_type = 'ingredient' then
      update public.ingredients
      set stock_base = stock_base - v_sm.quantity_base
      where id = v_sm.ingredient_id;
    else
      update public.products
      set stock_base = stock_base - v_sm.quantity_base
      where id = v_sm.product_id;
    end if;
  end loop;

  for v_cm in
    select * from public.cash_movements
    where reference_type = 'sale' and reference_id = p_sale_id
  loop
    insert into public.cash_movements (
      cash_session_id, movement_type, payment_method_id, method_code, method_name,
      affects_cash, currency, amount, amount_usd, received_amount,
      change_usd, change_bs, change_pm_amount,
      rate_source, rate_value, reference_type, reference_id, notes
    ) values (
      v_cm.cash_session_id, 'adjustment', v_cm.payment_method_id, v_cm.method_code, v_cm.method_name,
      v_cm.affects_cash, v_cm.currency, -v_cm.amount, -v_cm.amount_usd, -coalesce(v_cm.received_amount, 0),
      -coalesce(v_cm.change_usd, 0), -coalesce(v_cm.change_bs, 0), -coalesce(v_cm.change_pm_amount, 0),
      v_cm.rate_source, v_cm.rate_value, 'sale_void', p_sale_id,
      'AnulaciÃ³n ' || coalesce(v_sale.order_number, '')
    );
  end loop;

  for v_bill in
    select * from public.cash_bill_movements
    where sale_id = p_sale_id and type in ('venta', 'vuelto')
  loop
    insert into public.cash_bill_movements (
      cash_session_id, sale_id, type, denomination, quantity, note
    ) values (
      v_bill.cash_session_id,
      p_sale_id,
      case when v_bill.type = 'venta' then 'vuelto' else 'venta' end,
      v_bill.denomination,
      v_bill.quantity,
      'AnulaciÃ³n ' || coalesce(v_sale.order_number, '')
    );
  end loop;

  update public.public_orders
  set sale_id = null,
      paid_at = null,
      delivered_at = null,
      status = 'listo',
      updated_at = now()
  where sale_id = p_sale_id
    and status <> 'cancelado';

  update public.sales
  set status = 'voided',
      voided_at = now(),
      void_reason = p_reason
  where id = p_sale_id;

  return jsonb_build_object('sale_id', p_sale_id, 'duplicate', false);
end;
$$;

grant execute on function public.register_sale(jsonb) to authenticated;
grant execute on function public.close_cash_session(uuid, numeric, numeric, text) to authenticated;
grant execute on function public.void_sale(uuid, text) to authenticated;


-- ===== 012_fix_public_order_options.sql =====

-- 012_fix_public_order_options.sql
-- Las bebidas y productos simples no llevan toppings ni salsas.

create or replace function public.create_public_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business public.business_settings%rowtype;
  v_order_id uuid;
  v_order_number text;
  v_item jsonb;
  v_product public.products%rowtype;
  v_option public.options%rowtype;
  v_group public.option_groups%rowtype;
  v_option_ids uuid[];
  v_option_id uuid;
  v_qty numeric;
  v_unit_price numeric;
  v_line_total numeric;
  v_total numeric := 0;
  v_item_id uuid;
  v_name text;
  v_phone text;
  v_phone_norm text;
  v_fulfillment text;
  v_address text;
  v_notes text;
  v_rate_source text;
  v_rate_value numeric;
  v_recent_count integer;
  v_active_count integer;
  v_item_count integer;
  v_selected integer;
  v_min_select integer;
  v_sauces jsonb;
  v_topping text;
begin
  select * into v_business from public.business_settings where id = 1;
  if not found or v_business.public_menu_enabled is not true then
    raise exception 'El menÃº pÃºblico estÃ¡ cerrado';
  end if;

  v_name := trim(coalesce(payload->>'customer_name', ''));
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'Escribe un nombre vÃ¡lido';
  end if;

  v_phone := trim(coalesce(payload->>'customer_phone', ''));
  v_phone_norm := regexp_replace(v_phone, '[^0-9]', '', 'g');
  if length(v_phone_norm) < 7 or length(v_phone_norm) > 15 then
    raise exception 'Escribe un telÃ©fono vÃ¡lido';
  end if;

  v_fulfillment := coalesce(nullif(payload->>'fulfillment', ''), 'pickup');
  if v_fulfillment not in ('pickup', 'delivery') then
    raise exception 'Tipo de entrega invÃ¡lido';
  end if;
  if v_fulfillment = 'delivery' and v_business.delivery_enabled is not true then
    raise exception 'El delivery estÃ¡ desactivado';
  end if;
  if v_fulfillment = 'pickup' and v_business.pickup_enabled is not true then
    raise exception 'El pickup estÃ¡ desactivado';
  end if;

  v_address := nullif(trim(coalesce(payload->>'address', '')), '');
  if v_fulfillment = 'delivery' and (v_address is null or length(v_address) < 5) then
    raise exception 'Escribe una direcciÃ³n para el delivery';
  end if;
  if v_address is not null and length(v_address) > 300 then
    raise exception 'La direcciÃ³n es demasiado larga';
  end if;

  v_notes := nullif(trim(coalesce(payload->>'notes', '')), '');
  if v_notes is not null and length(v_notes) > 500 then
    raise exception 'Las notas son demasiado largas';
  end if;

  -- LÃ­mite anti-spam por telÃ©fono.
  select count(*) into v_recent_count
  from public.public_orders
  where customer_phone_normalized = v_phone_norm
    and created_at > now() - interval '10 minutes';
  if v_recent_count >= 5 then
    raise exception 'Demasiados pedidos seguidos. Espera unos minutos o escrÃ­benos por WhatsApp';
  end if;

  select count(*) into v_active_count
  from public.public_orders
  where customer_phone_normalized = v_phone_norm
    and status in ('nuevo', 'preparando', 'listo');
  if v_active_count >= 3 then
    raise exception 'Ya tienes varios pedidos activos. EscrÃ­benos por WhatsApp para agregar otro';
  end if;

  v_item_count := jsonb_array_length(coalesce(payload->'items', '[]'::jsonb));
  if v_item_count = 0 then
    raise exception 'El pedido estÃ¡ vacÃ­o';
  end if;
  if v_item_count > 30 then
    raise exception 'El pedido tiene demasiados artÃ­culos';
  end if;

  v_rate_source := coalesce(nullif(payload->>'rate_source', ''), 'bcv_eur');
  if v_rate_source not in ('bcv_usd', 'bcv_eur', 'usdt', 'manual') then
    v_rate_source := 'bcv_eur';
  end if;

  v_rate_value := nullif(payload->>'rate_value', '')::numeric;
  if v_rate_value is null or v_rate_value <= 0 then
    select coalesce(bcv_eur, bcv_usd, usdt, 0)
    into v_rate_value
    from public.rate_snapshots
    order by snapshot_date desc
    limit 1;
  end if;
  v_rate_value := coalesce(v_rate_value, 0);

  v_order_number := 'C-' ||
    to_char(now() at time zone 'America/Caracas', 'YYMMDD-HH24MISS') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));

  insert into public.public_orders (
    order_number,
    customer_name,
    customer_phone,
    customer_phone_normalized,
    fulfillment,
    address,
    notes,
    status,
    rate_source,
    rate_value
  ) values (
    v_order_number,
    v_name,
    v_phone,
    v_phone_norm,
    v_fulfillment,
    v_address,
    v_notes,
    'nuevo',
    v_rate_source,
    v_rate_value
  ) returning id into v_order_id;

  for v_item in
    select value from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb))
  loop
    select * into v_product
    from public.products
    where id = nullif(v_item->>'product_id', '')::uuid
      and active = true
      and is_public = true;

    if not found then
      raise exception 'Producto no disponible';
    end if;

    v_qty := coalesce((v_item->>'quantity')::numeric, 0);
    if v_qty <= 0 or v_qty > 50 or v_qty <> floor(v_qty) then
      raise exception 'Cantidad invÃ¡lida en %', v_product.name;
    end if;

    v_option_ids := array(
      select distinct value::uuid
      from jsonb_array_elements_text(
        coalesce(v_item->'option_ids', '[]'::jsonb)
      ) as value
      where value is not null and value <> ''
    );

    if v_product.category <> 'banderilla' and coalesce(array_length(v_option_ids, 1), 0) > 0 then
      raise exception '% no lleva toppings ni salsas', v_product.name;
    end if;

    -- Valida que cada opciÃ³n exista, estÃ© activa y pertenezca a un grupo activo.
    foreach v_option_id in array v_option_ids
    loop
      select o.* into v_option
      from public.options o
      join public.option_groups g on g.id = o.group_id
      where o.id = v_option_id
        and o.active = true
        and g.active = true;

      if not found then
        raise exception 'Una de las opciones seleccionadas no estÃ¡ disponible';
      end if;
    end loop;

    if v_product.category = 'banderilla' then
      -- Valida mÃ­nimos, mÃ¡ximos y selecciÃ³n Ãºnica por grupo.
      for v_group in
      select * from public.option_groups where active = true
    loop
      select count(*) into v_selected
      from public.options o
      where o.group_id = v_group.id
        and o.id = any(v_option_ids)
        and o.active = true;

      v_min_select := greatest(
        coalesce(v_group.min_select, 0),
        case when v_group.required then 1 else 0 end
      );

      if v_selected < v_min_select then
        raise exception 'Falta seleccionar %', v_group.name;
      end if;
      if v_group.max_select is not null and v_selected > v_group.max_select then
        raise exception 'Demasiadas opciones en %', v_group.name;
      end if;
      if v_group.selection_type = 'single' and v_selected > 1 then
        raise exception 'Solo puedes elegir una opciÃ³n en %', v_group.name;
      end if;
      end loop;
    end if;

    select coalesce(sum(o.price_delta_usd), 0)
    into v_unit_price
    from public.options o
    where o.id = any(v_option_ids);

    v_unit_price := coalesce(v_product.price_usd, 0) + v_unit_price;
    v_line_total := v_unit_price * v_qty;

    v_topping := (
      select o.name
      from public.options o
      join public.option_groups g on g.id = o.group_id
      where o.id = any(v_option_ids)
        and g.slug = 'topping'
      limit 1
    );

    select coalesce(jsonb_agg(o.name order by o.sort_order, o.name), '[]'::jsonb)
    into v_sauces
    from public.options o
    join public.option_groups g on g.id = o.group_id
    where o.id = any(v_option_ids)
      and g.slug = 'salsas';

    insert into public.public_order_items (
      order_id,
      product_id,
      product_name,
      quantity,
      unit_price_usd,
      line_total_usd,
      config,
      notes
    ) values (
      v_order_id,
      v_product.id,
      v_product.name,
      v_qty,
      v_unit_price,
      v_line_total,
      jsonb_build_object(
        'topping', v_topping,
        'sauces', v_sauces,
        'options', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'option_id', o.id,
            'group_name', g.name,
            'option_name', o.name,
            'price_delta_usd', o.price_delta_usd
          ) order by g.sort_order, o.sort_order), '[]'::jsonb)
          from public.options o
          join public.option_groups g on g.id = o.group_id
          where o.id = any(v_option_ids)
        )
      ),
      nullif(trim(coalesce(v_item->>'notes', '')), '')
    ) returning id into v_item_id;

    insert into public.public_order_item_options (
      order_item_id,
      option_id,
      group_id,
      group_name,
      option_name,
      price_delta_usd
    )
    select
      v_item_id,
      o.id,
      g.id,
      g.name,
      o.name,
      o.price_delta_usd
    from public.options o
    join public.option_groups g on g.id = o.group_id
    where o.id = any(v_option_ids)
    order by g.sort_order, o.sort_order;

    v_total := v_total + v_line_total;
  end loop;

  update public.public_orders
  set subtotal_usd = v_total,
      total_usd = v_total,
      total_bs = round(v_total * v_rate_value, 2)
  where id = v_order_id;

  return jsonb_build_object(
    'order_id', v_order_id,
    'order_number', v_order_number,
    'total_usd', v_total,
    'total_bs', round(v_total * v_rate_value, 2),
    'rate_source', v_rate_source,
    'rate_value', v_rate_value
  );
end;
$$;

revoke all on function public.create_public_order(jsonb) from public;
grant execute on function public.create_public_order(jsonb) to anon, authenticated;


-- ===== 013_sale_customer_phone.sql =====

-- 013_sale_customer_phone.sql
-- Guarda el telÃ©fono del cliente en las ventas del POS.

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

