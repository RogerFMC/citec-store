-- Citec Store — esquema Supabase (proyecto `citec-store`, ref rqrbgjzdcvieqbpexgen, sa-east-1, Postgres 17)
-- Reconstruido a partir del estado real de la base de datos el 2026-08-12
-- (el repo de GitHub estaba vacío; este archivo es una copia fiel de lo aplicado vía migraciones).
-- Fuente de verdad: el proyecto Supabase. Si hay diferencias con este archivo, confiar en la base de datos.

create extension if not exists pg_trgm;

-- =========================================================
-- categories
-- =========================================================
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  margin_pct numeric not null check (margin_pct >= 0 and margin_pct <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.categories is 'Margen comercial por categoría. Editable sin tocar código.';

-- =========================================================
-- suppliers
-- =========================================================
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_type text not null check (source_type in ('web', 'pdf', 'photo')),
  website_url text,
  prices_include_igv boolean not null default false,
  is_pilot boolean not null default false,
  is_active boolean not null default true,
  sync_frequency interval not null default '04:00:00',
  last_synced_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  pricing_mode text not null default 'wholesale_cost'
    check (pricing_mode in ('wholesale_cost', 'final_price'))
);
comment on table public.suppliers is 'Un registro por proveedor mayorista. source_type=web usa el motor de sincronización; pdf/photo usa el motor de ingesta de documentos.';
comment on column public.suppliers.pricing_mode is 'wholesale_cost = se aplica IGV (si falta) + margen por categoría. final_price = el precio ya viene listo, se usa tal cual (ej. catálogo propio de Citec).';

-- =========================================================
-- warehouses
-- =========================================================
create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null,
  max_lead_days integer not null default 3,
  created_at timestamptz not null default now(),
  supplier_id uuid references public.suppliers(id),
  notes text
);
comment on table public.warehouses is 'Ciudades desde donde se puede despachar. supplier_id nulo = punto propio de cobertura de CIACITEC (coordinación de pedidos, no stock físico salvo el catálogo propio). supplier_id no nulo = sucursal/almacén conocido de ese proveedor.';
comment on column public.warehouses.max_lead_days is 'Plazo por defecto en días hábiles desde este almacén. 0 = mismo día.';
comment on column public.warehouses.supplier_id is 'Proveedor dueño de este almacén/sucursal. Nulo para los puntos propios de despacho de CIACITEC.';

-- =========================================================
-- products
-- =========================================================
create table public.products (
  id uuid primary key default gen_random_uuid(),
  model text not null,
  part_number text,
  brand text not null,
  description text,
  category_id uuid not null references public.categories(id),
  supplier_id uuid not null references public.suppliers(id),
  warehouse_id uuid references public.warehouses(id),
  cost numeric not null check (cost >= 0),
  cost_includes_igv boolean not null default false,
  final_price numeric,
  stock_qty integer,
  stock_status text default 'unknown'
    check (stock_status in ('in_stock', 'low_stock', 'out_of_stock', 'unknown')),
  source_type text not null check (source_type in ('web_sync', 'pdf_ingest', 'photo_ingest', 'manual')),
  confidence text not null default 'high' check (confidence in ('high', 'needs_review', 'low')),
  last_synced_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.products.confidence is 'needs_review = viene de un PDF/foto de baja calidad y requiere validación humana antes de publicarse.';

create index idx_products_category on public.products (category_id);
create index idx_products_supplier on public.products (supplier_id);
create index idx_products_brand on public.products (brand);
create index idx_products_model_trgm on public.products using gin (model gin_trgm_ops);
create index idx_products_part_number_trgm on public.products using gin (part_number gin_trgm_ops);

-- =========================================================
-- sync_log
-- =========================================================
create table public.sync_log (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id),
  status text not null check (status in ('success', 'failed', 'partial')),
  items_synced integer default 0,
  message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
comment on table public.sync_log is 'Cada corrida del motor de sincronización (GitHub Actions) escribe aquí. Un status=failed dispara el aviso por correo.';

-- =========================================================
-- pricing_settings
-- =========================================================
create table public.pricing_settings (
  id uuid primary key default gen_random_uuid(),
  fixed_charge_soles numeric not null default 5.00 check (fixed_charge_soles >= 0),
  updated_at timestamptz not null default now()
);
comment on table public.pricing_settings is 'Configuración global del motor de precios. Fila única. fixed_charge_soles se suma al precio final de cada producto, en todos los proveedores, según pidió Roger el 12/08/2026.';

-- =========================================================
-- motor de precios: trigger + función
-- Los scripts de sincronización NUNCA deben calcular final_price ellos
-- mismos: solo escriben cost / cost_includes_igv / category_id / supplier_id
-- y este trigger hace el resto. Debe mantenerse en sync con pricingEngine.js.
-- =========================================================
create or replace function public.compute_final_price()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
DECLARE
  v_pricing_mode text;
  v_margin_pct numeric;
  v_cost_with_igv numeric;
  v_fixed_charge numeric;
BEGIN
  SELECT pricing_mode INTO v_pricing_mode FROM public.suppliers WHERE id = NEW.supplier_id;
  SELECT margin_pct INTO v_margin_pct FROM public.categories WHERE id = NEW.category_id;
  SELECT fixed_charge_soles INTO v_fixed_charge FROM public.pricing_settings LIMIT 1;
  v_fixed_charge := coalesce(v_fixed_charge, 0);

  IF v_pricing_mode = 'final_price' THEN
    NEW.final_price := round(NEW.cost + v_fixed_charge, 2);
  ELSE
    IF NEW.cost_includes_igv THEN
      v_cost_with_igv := NEW.cost;
    ELSE
      v_cost_with_igv := round(NEW.cost * 1.18, 2);
    END IF;
    NEW.final_price := round(v_cost_with_igv * (1 + coalesce(v_margin_pct, 0) / 100) + v_fixed_charge, 2);
  END IF;

  RETURN NEW;
END;
$function$;

create trigger trg_compute_final_price
  before insert or update on public.products
  for each row execute function public.compute_final_price();

-- =========================================================
-- catalog_search: única vista que el frontend debe consultar.
-- No expone cost, cost_includes_igv, supplier_id ni supplier — a propósito.
-- Es SECURITY DEFINER (corre con permisos del dueño), por eso funciona con
-- RLS activado y sin políticas en las tablas base: es la única puerta pública.
-- =========================================================
create view public.catalog_search as
select
  p.id,
  p.model,
  p.part_number,
  p.brand,
  p.description,
  c.name as category,
  p.final_price,
  p.stock_status,
  w.name as warehouse_name,
  w.city as warehouse_city,
  w.max_lead_days,
  p.last_synced_at,
  p.confidence
from public.products p
join public.categories c on c.id = p.category_id
left join public.warehouses w on w.id = p.warehouse_id
where p.is_active = true and p.confidence <> 'low';

-- =========================================================
-- Row Level Security
-- RLS activado y SIN políticas en todas las tablas internas: deniega todo
-- acceso a anon/authenticated por defecto. service_role (usado por los
-- scripts de sync) no está sujeto a RLS ni a estos grants.
-- catalog_search es la única lectura pública (bypassa RLS por ser
-- SECURITY DEFINER, propiedad de postgres).
-- =========================================================
alter table public.categories enable row level security;
alter table public.suppliers enable row level security;
alter table public.warehouses enable row level security;
alter table public.products enable row level security;
alter table public.sync_log enable row level security;
alter table public.pricing_settings enable row level security;

revoke all on public.categories, public.suppliers, public.warehouses,
  public.products, public.sync_log, public.pricing_settings
from anon, authenticated;

revoke insert, update, delete, truncate, references, trigger on public.catalog_search
from anon, authenticated;

grant select on public.catalog_search to anon, authenticated;

-- =========================================================
-- Datos semilla: categorías (margin_pct vigente al 2026-08-12, puede seguir creciendo)
-- =========================================================
insert into public.categories (name, margin_pct) values
  ('Laptops y PCs', 11),
  ('Impresoras', 12),
  ('Suministros', 15),
  ('Estabilizadores y UPS', 15),
  ('Accesorios y periféricos', 20),
  ('Monitores', 15),
  ('Tarjetas de video', 13)
on conflict (name) do nothing;

-- =========================================================
-- Datos semilla: pricing_settings (fila única)
-- =========================================================
insert into public.pricing_settings (fixed_charge_soles)
select 5.00
where not exists (select 1 from public.pricing_settings);
