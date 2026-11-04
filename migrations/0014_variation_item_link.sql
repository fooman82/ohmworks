-- Variation lines can be linked to a price list item (price defaults from it, user may override)
ALTER TABLE variation_items ADD COLUMN item_id INTEGER REFERENCES price_list(id) ON DELETE SET NULL;
