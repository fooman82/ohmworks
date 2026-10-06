-- Which job lines appear on the invoice (1 = invoiced, 0 = left off this invoice)
ALTER TABLE job_items ADD COLUMN on_invoice INTEGER NOT NULL DEFAULT 1;
