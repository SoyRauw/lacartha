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
