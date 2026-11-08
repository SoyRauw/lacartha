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
