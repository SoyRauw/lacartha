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
