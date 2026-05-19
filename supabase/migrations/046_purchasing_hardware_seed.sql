-- Seed the 36 initial hardware SKUs.
--
-- On-hand counts pulled from:
--   - Spigots: WhatsApp from Christopher (2026-05-18, 09:48)
--   - Connectors + Hinge kits: master inventory spreadsheet
--   - Gate latches + Floor locks: no count yet → on_hand = 0
--
-- Monthly sales (GRS + RF) from the product catalog. SKUs with no sales
-- history get 0/0 → the view's 50-unit floor will flag them for reorder.
--
-- storage_capacity = 0 for all hardware. The view (migration 045) shadows
-- it with max(50, 3 × monthly_total), so the stored value is irrelevant.
--
-- ON CONFLICT (sku) DO NOTHING — safe to re-run; only inserts new SKUs.

insert into purchasing_products
  (category, sku, name, unit_cost_landed, storage_capacity,
   current_inventory, avg_monthly_sales_grs, avg_monthly_sales_rf, notes)
values
  -- ─── Spigots ──────────────────────────────────────────────────────
  ('hardware', 'SP-SS',     '6" Engineered Spigot — Stainless',  30.00, 0, 510, 345,   385,    'Color: Stainless · seeded 2026-05-18'),
  ('hardware', 'SP-BL',     '6" Engineered Spigot — Black',      30.00, 0, 192, 541,   1027,   'Color: Black · seeded 2026-05-18'),
  ('hardware', 'SP-SM-SS',  'Side Mount Spigot — Stainless',     28.00, 0, 320, 41.6,  31.33,  'Color: Stainless · seeded 2026-05-18'),
  ('hardware', 'SP-SM-BL',  'Side Mount Spigot — Black',         28.00, 0, 530, 21,    47.16,  'Color: Black · seeded 2026-05-18'),

  -- ─── 180° Connectors ──────────────────────────────────────────────
  ('hardware', 'CN180-B-SS','180° Big Connector — Stainless',     8.34, 0, 1287, 36.83, 22.83,  'Color: Stainless · seeded 2026-05-18'),
  ('hardware', 'CN180-S-SS','180° Small Connector — Stainless',   7.05, 0, 1022, 70.83, 93.33,  'Color: Stainless · seeded 2026-05-18'),
  ('hardware', 'CN180-B-BL','180° Big Connector — Black',         8.62, 0, 469,  32.25, 76.66,  'Color: Black · seeded 2026-05-18'),
  ('hardware', 'CN180-S-BL','180° Small Connector — Black',       7.32, 0, 271,  143,   216,    'Color: Black · seeded 2026-05-18'),

  -- ─── 90° Connectors ───────────────────────────────────────────────
  ('hardware', 'CN90-B-SS', '90° Big Connector — Stainless',      9.84, 0, 1187, 10.5,  6.75,   'Color: Stainless · seeded 2026-05-18'),
  ('hardware', 'CN90-S-SS', '90° Small Connector — Stainless',    7.60, 0, 1701, 16.33, 29.33,  'Color: Stainless · seeded 2026-05-18'),
  ('hardware', 'CN90-B-BL', '90° Big Connector — Black',         10.11, 0, 1085, 11.83, 19.16,  'Color: Black · seeded 2026-05-18'),
  ('hardware', 'CN90-S-BL', '90° Small Connector — Black',        7.87, 0, 1307, 36.75, 63.25,  'Color: Black · seeded 2026-05-18'),

  -- ─── Adjustable Connectors ────────────────────────────────────────
  ('hardware', 'CNADJ-B-SS','Adjustable Big Connector — Stainless',   12.15, 0, 851,  5.75,  0,      'Color: Stainless · seeded 2026-05-18'),
  ('hardware', 'CNADJ-S-SS','Adjustable Small Connector — Stainless', 10.38, 0, 1346, 7,     7.91,   'Color: Stainless · seeded 2026-05-18'),
  ('hardware', 'CNADJ-B-BL','Adjustable Big Connector — Black',       12.78, 0, 802,  2.33,  6.75,   'Color: Black · seeded 2026-05-18'),
  ('hardware', 'CNADJ-S-BL','Adjustable Small Connector — Black',     10.66, 0, 997,  7.91,  22.58,  'Color: Black · seeded 2026-05-18'),

  -- ─── Wall Connectors ──────────────────────────────────────────────
  ('hardware', 'CNWALL-B-SS','Wall Big Connector — Stainless',    7.53, 0, 585, 11.25, 12.83,  'Color: Stainless · seeded 2026-05-18'),
  ('hardware', 'CNWALL-S-SS','Wall Small Connector — Stainless',  6.30, 0, 949, 37.83, 24.91,  'Color: Stainless · seeded 2026-05-18'),
  ('hardware', 'CNWALL-B-BL','Wall Big Connector — Black',        7.80, 0, 678, 23.75, 29.83,  'Color: Black · seeded 2026-05-18'),
  ('hardware', 'CNWALL-S-BL','Wall Small Connector — Black',      6.58, 0, 364, 79.83, 73.91,  'Color: Black · seeded 2026-05-18'),

  -- ─── Hinge Kits ───────────────────────────────────────────────────
  ('hardware', 'HKIT-WALL-SS','Wall-Mount Hinge Kit — Stainless', 69.00, 0, 80,  0,    0,      'Color: Stainless · seeded 2026-05-18 (no sales data)'),
  ('hardware', 'HKIT-WALL-BL','Wall-Mount Hinge Kit — Black',     69.00, 0, 110, 0.91, 1.83,   'Color: Black · seeded 2026-05-18'),
  ('hardware', 'HKIT-180-SS', '180-Degree Hinge Kit — Stainless', 69.00, 0, 152, 3.25, 2.25,   'Color: Stainless · seeded 2026-05-18'),
  ('hardware', 'HKIT-180-BL', '180-Degree Hinge Kit — Black',     69.00, 0, 187, 2.08, 4.75,   'Color: Black · seeded 2026-05-18'),

  -- ─── 90° Gate Latches (no inventory / sales data yet) ─────────────
  ('hardware', 'GTL90-1-SS',  '90-Degree Gate Latch Model 1 — Stainless', 28.00, 0, 0, 0, 0,    'Color: Stainless · seeded 2026-05-18'),
  ('hardware', 'GTL90-1-BL',  '90-Degree Gate Latch Model 1 — Black',     28.00, 0, 0, 0, 0,    'Color: Black · seeded 2026-05-18'),
  ('hardware', 'GTL90-2-SS',  '90-Degree Gate Latch Model 2 — Stainless', 28.00, 0, 0, 0, 0,    'Color: Stainless · seeded 2026-05-18'),
  ('hardware', 'GTL90-2-BL',  '90-Degree Gate Latch Model 2 — Black',     28.00, 0, 0, 0, 0,    'Color: Black · seeded 2026-05-18'),

  -- ─── 180° Gate Latches ────────────────────────────────────────────
  ('hardware', 'GTL180-1-SS', '180-Degree Gate Latch Model 1 — Stainless', 28.00, 0, 0, 2.66, 1.75, 'Color: Stainless · seeded 2026-05-18'),
  ('hardware', 'GTL180-1-BL', '180-Degree Gate Latch Model 1 — Black',     28.00, 0, 0, 1.41, 4.25, 'Color: Black · seeded 2026-05-18'),
  ('hardware', 'GTL180-2-SS', '180-Degree Gate Latch Model 2 — Stainless', 28.00, 0, 0, 0,    0,    'Color: Stainless · seeded 2026-05-18'),
  ('hardware', 'GTL180-2-BL', '180-Degree Gate Latch Model 2 — Black',     28.00, 0, 0, 0,    0,    'Color: Black · seeded 2026-05-18'),

  -- ─── Wall-Mounted Gate Latches ────────────────────────────────────
  ('hardware', 'GTLWALL-SS',  'Wall-Mounted Gate Latch — Stainless', 28.00, 0, 0, 0, 0, 'Color: Stainless · seeded 2026-05-18'),
  ('hardware', 'GTLWALL-BL',  'Wall-Mounted Gate Latch — Black',     28.00, 0, 0, 0, 0, 'Color: Black · seeded 2026-05-18'),

  -- ─── Floor Locks ──────────────────────────────────────────────────
  ('hardware', 'FL-SS', 'Floor Lock — Stainless', 24.00, 0, 0, 2.66, 0, 'Color: Stainless · seeded 2026-05-18'),
  ('hardware', 'FL-BL', 'Floor Lock — Black',     24.00, 0, 0, 2.66, 0, 'Color: Black · seeded 2026-05-18')

on conflict (sku) do nothing;
