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
    raise exception 'El menú público está cerrado';
  end if;

  v_name := trim(coalesce(payload->>'customer_name', ''));
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'Escribe un nombre válido';
  end if;

  v_phone := trim(coalesce(payload->>'customer_phone', ''));
  v_phone_norm := regexp_replace(v_phone, '[^0-9]', '', 'g');
  if length(v_phone_norm) < 7 or length(v_phone_norm) > 15 then
    raise exception 'Escribe un teléfono válido';
  end if;

  v_fulfillment := coalesce(nullif(payload->>'fulfillment', ''), 'pickup');
  if v_fulfillment not in ('pickup', 'delivery') then
    raise exception 'Tipo de entrega inválido';
  end if;
  if v_fulfillment = 'delivery' and v_business.delivery_enabled is not true then
    raise exception 'El delivery está desactivado';
  end if;
  if v_fulfillment = 'pickup' and v_business.pickup_enabled is not true then
    raise exception 'El pickup está desactivado';
  end if;

  v_address := nullif(trim(coalesce(payload->>'address', '')), '');
  if v_fulfillment = 'delivery' and (v_address is null or length(v_address) < 5) then
    raise exception 'Escribe una dirección para el delivery';
  end if;
  if v_address is not null and length(v_address) > 300 then
    raise exception 'La dirección es demasiado larga';
  end if;

  v_notes := nullif(trim(coalesce(payload->>'notes', '')), '');
  if v_notes is not null and length(v_notes) > 500 then
    raise exception 'Las notas son demasiado largas';
  end if;

  -- Límite anti-spam por teléfono.
  select count(*) into v_recent_count
  from public.public_orders
  where customer_phone_normalized = v_phone_norm
    and created_at > now() - interval '10 minutes';
  if v_recent_count >= 5 then
    raise exception 'Demasiados pedidos seguidos. Espera unos minutos o escríbenos por WhatsApp';
  end if;

  select count(*) into v_active_count
  from public.public_orders
  where customer_phone_normalized = v_phone_norm
    and status in ('nuevo', 'preparando', 'listo');
  if v_active_count >= 3 then
    raise exception 'Ya tienes varios pedidos activos. Escríbenos por WhatsApp para agregar otro';
  end if;

  v_item_count := jsonb_array_length(coalesce(payload->'items', '[]'::jsonb));
  if v_item_count = 0 then
    raise exception 'El pedido está vacío';
  end if;
  if v_item_count > 30 then
    raise exception 'El pedido tiene demasiados artículos';
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
      raise exception 'Cantidad inválida en %', v_product.name;
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

    -- Valida que cada opción exista, esté activa y pertenezca a un grupo activo.
    foreach v_option_id in array v_option_ids
    loop
      select o.* into v_option
      from public.options o
      join public.option_groups g on g.id = o.group_id
      where o.id = v_option_id
        and o.active = true
        and g.active = true;

      if not found then
        raise exception 'Una de las opciones seleccionadas no está disponible';
      end if;
    end loop;

    if v_product.category = 'banderilla' then
      -- Valida mínimos, máximos y selección única por grupo.
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
        raise exception 'Solo puedes elegir una opción en %', v_group.name;
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
