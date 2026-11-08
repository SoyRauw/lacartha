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
