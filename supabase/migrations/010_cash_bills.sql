-- 010_cash_bills.sql
-- Caja por billetes de dólar, vuelto y métodos de pago

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
