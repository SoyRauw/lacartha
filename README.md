# La Cartha — Administración

Sistema administrativo para **La Cartha by Valentina Castro** (banderillas coreanas).

## Stack

- React 19 + Vite 8
- React Router 7
- Supabase (Postgres, Auth, RLS)
- Dexie + IndexedDB para el POS offline
- PWA con `vite-plugin-pwa`
- CSS Modules + design system propio
- Recharts, Lucide, Framer Motion
- jsPDF + XLSX
- GitHub Pages (principal) + Firebase Hosting (alternativa)

## Qué incluye

- **Hoy**: ventas, costo, ganancia, gastos, efectivo y alertas.
- **Vender**: POS táctil con banderillas configurables (1 topping + salsas ilimitadas), pagos mixtos y modo offline.
- **La banderilla**: constructor visual de la receta con flechas a masa, salchicha, queso, topping, salsas, palillo y empaque.
- **Materia prima**: ingredientes, unidades, costos, stock y mínimos.
- **Preparaciones**: masa y salsas caseras con rendimiento.
- **Productos**: banderillas, bebidas, postres, nuggets y papitas.
- **Compras**: actualiza stock y costo promedio en USD.
- **Inventario**: stock teórico diario y conteo semanal con merma.
- **Gastos**: categorías, moneda y medio de pago.
- **Caja**: apertura, cierre, arqueo y diferencia.
- **Reportes**: ventas, márgenes, top productos, medios de pago y punto de equilibrio.
- **Menú público** (`/menu`): carrito, precios USD/Bs y pedido por WhatsApp.
- **Recibos PDF** descargables.

## Tasa BCV automática

La app usa la misma API que elitestore:

```text
https://ve.dolarapi.com/v1/cotizaciones
```

- Toma las tasas oficiales **BCV USD** y **BCV EUR**.
- Deja **BCV EUR** como tasa por defecto.
- Al iniciar sesión, si no hay tasa del día, la consulta y la guarda en `rate_snapshots`.
- El POS permite cobrar en USD sin tasa; para Bs pide la tasa.
- El menú público consulta la API en vivo y usa el último snapshot como respaldo.
- El botón **Ajustes → Consultar tasas** fuerza una actualización manual.

## Configuración local

```bash
npm install
npm run dev
```

Si PowerShell bloquea `npm` por la política de ejecución, usa `npm.cmd run dev`.

El archivo `.env.local` ya tiene:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

La anon key es pública; la seguridad real está en RLS. **Nunca** pongas la `service_role` key en el frontend ni la subas al repositorio.

## Base de datos

Ejecuta las migraciones en el **SQL Editor** de Supabase, en este orden:

1. `supabase/migrations/001_core.sql`
2. `supabase/migrations/002_inventory.sql`
3. `supabase/migrations/003_recipes.sql`
4. `supabase/migrations/004_sales.sql`
5. `supabase/migrations/005_rls.sql`
6. `supabase/migrations/006_functions.sql`
7. `supabase/migrations/007_seed.sql`
8. `supabase/migrations/008_storage.sql`

Atajo manual: `supabase/000_all_manual.sql` contiene las 8 migraciones en orden; puedes pegarlo de una sola vez en el SQL Editor. Está fuera de `supabase/migrations` para que el CLI no lo ejecute por duplicado.

Las migraciones fueron probadas contra PostgreSQL 15, incluyendo venta, compra, anulación, conteo y cierre de caja.

### Migraciones con el CLI

Si usas el CLI, el proyecto ya está linkeado y las migraciones aplicadas. Para cambios futuros:

```bash
npx supabase db push --remote=postgresql://postgres.srsgmnnrsvhqlgwmtene:[PASSWORD]@aws-1-us-west-2.pooler.supabase.com:5432/postgres --include-all
```

Usa la cadena **Session pooler** (puerto 5432) del dashboard. La conexión directa de Supabase es IPv6 y puede no funcionar en todas las redes.

Después:

1. Ve a **Authentication → Users → Add user**.
2. Crea el usuario de Valentina con su correo y contraseña, con **Auto Confirm** activado.
3. El primer usuario queda como `admin`; los siguientes como `seller`.
4. Si el usuario existía antes de las migraciones, el backfill de `001_core.sql` le crea el perfil.

La app no tiene registro público: solo entran usuarios creados en Supabase Auth.

## Primeros pasos dentro de la app

1. **Ajustes → Tasas**: revisa BCV USD/EUR; se actualizan automáticamente. Puedes forzarlas con “Consultar tasas”.
2. **Materia prima**: carga el precio de compra y el stock de cada ingrediente.
3. **La banderilla**: ajusta masa, queso, salchicha, toppings y salsas.
4. **Compras**: registra una compra inicial si ya tienes inventario.
5. **Caja**: abre la caja con el efectivo inicial.
6. **Ajustes → Menú público**: activa el menú y descarga el QR.

## POS offline

- El catálogo se descarga a IndexedDB cuando hay internet.
- Las ventas y la caja funcionan sin conexión.
- Al volver la señal, se sincronizan con Supabase.
- En iPhone la sincronización es al abrir la app (iOS no tiene background sync).
- Si el teléfono se pierde antes de sincronizar, se pierden las ventas pendientes. Sincroniza con frecuencia.

## Menú público

- URL: `/menu`.
- No muestra costos, stock ni datos de pago.
- El cliente arma el pedido y se abre WhatsApp con el resumen.
- Valentina comparte los datos de pago manualmente por WhatsApp.
- El QR se genera desde **Ajustes**.

## Deploy en GitHub Pages

El proyecto está preparado para publicarse en:

```text
https://soyrauw.github.io/lacartha/
```

- Admin: `https://soyrauw.github.io/lacartha/admin`
- Menú público: `https://soyrauw.github.io/lacartha/menu`

El workflow `.github/workflows/deploy.yml` compila y publica en Pages con `VITE_BASE=/lacartha/`. Los secretos del repo son:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Para un build local de Pages:

```powershell
$env:VITE_BASE='/lacartha/'
npm.cmd run build
Copy-Item dist/index.html dist/404.html
```

## Deploy alternativo en Firebase

```bash
npm run build
firebase login
firebase use --add
firebase deploy --only hosting
```

Para Firebase se usa `base: '/'` (sin `VITE_BASE`). No mezcles ambos builds: GitHub Pages necesita `/lacartha/` y Firebase usa la raíz.

## Tests

```bash
npm test
```

## Notas

- La moneda de cuenta es **USD**. Los precios se guardan en USD y el Bs se recalcula con la tasa elegida.
- Las compras actualizan el costo promedio ponderado en USD.
- El costo de venta se congela al momento de vender.
- El conteo semanal ajusta el stock real y registra la diferencia como merma.
- La marca La Cartha (nombre, logo y colores) es fija; los datos operativos son editables.
