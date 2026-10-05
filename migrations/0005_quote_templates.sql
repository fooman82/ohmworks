-- SPARK: quote templates (description of work, parts with quantities, labour hours) + signed quote acceptance
CREATE TABLE quote_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  hours REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE quote_template_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES quote_templates(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES price_list(id) ON DELETE CASCADE,
  qty REAL NOT NULL DEFAULT 1
);
CREATE INDEX idx_qti_tpl ON quote_template_items(template_id);

ALTER TABLE jobs ADD COLUMN quote_signature TEXT;  -- PNG data URL signed on the quote (signing = acceptance)
