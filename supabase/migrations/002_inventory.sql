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
