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
