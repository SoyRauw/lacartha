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
