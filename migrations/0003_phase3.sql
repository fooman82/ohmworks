-- SPARK phase 3: suppliers, SMS, Xero/Stripe plumbing, website enquiry source

CREATE TABLE suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  abn TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_suppliers_name ON suppliers(name);

CREATE TABLE sms_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  to_addr TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT,
  ok INTEGER NOT NULL DEFAULT 0,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sms_job ON sms_log(job_id);

-- Private integration state (OAuth tokens etc). Never returned by the settings API.
CREATE TABLE integrations (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);

ALTER TABLE invoices ADD COLUMN xero_invoice_id TEXT;
ALTER TABLE invoices ADD COLUMN xero_synced_at TEXT;
ALTER TABLE payments ADD COLUMN stripe_session TEXT;
ALTER TABLE payments ADD COLUMN xero_payment_id TEXT;
CREATE UNIQUE INDEX idx_pay_stripe ON payments(stripe_session) WHERE stripe_session IS NOT NULL;

ALTER TABLE jobs ADD COLUMN reminder_sent_at TEXT;
ALTER TABLE jobs ADD COLUMN source TEXT;
ALTER TABLE clients ADD COLUMN source TEXT;
ALTER TABLE clients ADD COLUMN xero_contact_id TEXT;

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('sms_auto_reminders', '1'),
  ('sms_reminder_template', 'Hi {name}, a reminder that {business} will attend on {date} at {time}. Questions? Call {phone}.'),
  ('xero_account_code', '200'),
  ('xero_tax_type', 'OUTPUT'),
  ('xero_bank_code', '');
