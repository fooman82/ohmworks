-- Optional per-line sell price override on quote template items (NULL = use the current price list price when applied)
ALTER TABLE quote_template_items ADD COLUMN unit_price REAL;
