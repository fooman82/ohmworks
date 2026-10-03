-- SPARK phase 4: supplier-specific cost + part numbers, manufacturer details, stock on hand

ALTER TABLE price_list ADD COLUMN manufacturer TEXT;
ALTER TABLE price_list ADD COLUMN mfr_part_no TEXT;                 -- duplicates allowed (several items can share one)
ALTER TABLE price_list ADD COLUMN stock_qty REAL NOT NULL DEFAULT 0;
ALTER TABLE price_list ADD COLUMN track_stock INTEGER NOT NULL DEFAULT 0;   -- 1 = physical item whose stock is counted and deducted when jobs complete
CREATE INDEX idx_pl_mpn ON price_list(mfr_part_no);
CREATE INDEX idx_pl_name ON price_list(name);

-- Link job line items to the price list so stock can be deducted when materials are used
ALTER TABLE job_items ADD COLUMN item_id INTEGER;
ALTER TABLE job_items ADD COLUMN stock_deducted REAL NOT NULL DEFAULT 0;
CREATE INDEX idx_ji_item ON job_items(item_id);

-- One row per (item, supplier): that supplier's part number and cost price (ex GST).
CREATE TABLE supplier_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES price_list(id) ON DELETE CASCADE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_part_no TEXT,
  cost REAL NOT NULL DEFAULT 0,
  preferred INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (item_id, supplier_id)
);
CREATE INDEX idx_si_supplier ON supplier_items(supplier_id);

-- Supplier part number must be unique within a supplier (case-insensitive). Blank part numbers are stored as NULL and are exempt.
CREATE UNIQUE INDEX uq_supplier_part ON supplier_items(supplier_id, supplier_part_no COLLATE NOCASE) WHERE supplier_part_no IS NOT NULL;

-- Audit trail for every change to stock_qty
CREATE TABLE stock_moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES price_list(id) ON DELETE CASCADE,
  delta REAL NOT NULL,
  qty_after REAL NOT NULL,
  reason TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_moves_item ON stock_moves(item_id);
