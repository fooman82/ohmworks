-- SPARK phase 2: photos, signatures, checklists, time tracking, payments, settings, client portal, recurring jobs, email log

ALTER TABLE jobs ADD COLUMN portal_token TEXT;
ALTER TABLE jobs ADD COLUMN signature TEXT;            -- PNG data URL of customer sign-off
ALTER TABLE jobs ADD COLUMN signed_name TEXT;
ALTER TABLE jobs ADD COLUMN signed_at TEXT;
ALTER TABLE jobs ADD COLUMN quote_accepted_at TEXT;
ALTER TABLE jobs ADD COLUMN quote_accepted_name TEXT;
ALTER TABLE jobs ADD COLUMN repeat_rule TEXT;          -- none | weekly | fortnightly | monthly | quarterly | yearly
ALTER TABLE jobs ADD COLUMN repeat_parent INTEGER;
ALTER TABLE jobs ADD COLUMN repeat_spawned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN checkin_at TEXT;
ALTER TABLE jobs ADD COLUMN checkin_lat REAL;
ALTER TABLE jobs ADD COLUMN checkin_lng REAL;
ALTER TABLE jobs ADD COLUMN category TEXT;
ALTER TABLE invoices ADD COLUMN portal_viewed_at TEXT;
ALTER TABLE price_list ADD COLUMN category TEXT;
ALTER TABLE price_list ADD COLUMN cost REAL NOT NULL DEFAULT 0;
ALTER TABLE price_list ADD COLUMN is_labour INTEGER NOT NULL DEFAULT 0;
ALTER TABLE job_items ADD COLUMN cost REAL NOT NULL DEFAULT 0;

CREATE TABLE job_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  caption TEXT,
  data TEXT NOT NULL,                                  -- JPEG data URL (downscaled in browser)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_photos_job ON job_photos(job_id);

CREATE TABLE job_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  done_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  done_at TEXT
);

CREATE TABLE checklist_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  items TEXT NOT NULL                                  -- newline separated
);

CREATE TABLE time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  notes TEXT
);
CREATE INDEX idx_time_job ON time_entries(job_id);
CREATE INDEX idx_time_user ON time_entries(user_id);

CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  amount REAL NOT NULL,                                -- inc GST
  method TEXT NOT NULL DEFAULT 'bank',                 -- bank | card | cash | cheque | other
  reference TEXT,
  paid_on TEXT NOT NULL DEFAULT (date('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pay_job ON payments(job_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  kind TEXT,
  ok INTEGER NOT NULL DEFAULT 0,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,                                -- inc GST
  supplier TEXT,
  spent_on TEXT NOT NULL DEFAULT (date('now'))
);

INSERT INTO settings (key, value) VALUES
  ('business_name', 'OHMWORKS'),
  ('abn', '86 630 625 042'),
  ('licence', '501107C'),
  ('phone', '0416 481 450'),
  ('email', 'glen@ohmworks.com.au'),
  ('address', 'South & Western Sydney, NSW'),
  ('bank_details', ''),
  ('quote_terms', 'Quote valid for 30 days. Prices include GST. Work will be carried out in accordance with Australian Standards.'),
  ('invoice_terms', 'Payment due within 14 days of invoice date.'),
  ('payment_days', '14'),
  ('hourly_rate', '110');

INSERT INTO checklist_templates (name, items) VALUES
  ('Switchboard upgrade', 'Isolate supply and tag out' || char(10) || 'Install RCDs / safety switches' || char(10) || 'Label all circuits' || char(10) || 'Test insulation resistance' || char(10) || 'Test RCD trip times' || char(10) || 'Complete CCEW / certificate of compliance'),
  ('General electrical install', 'Confirm scope with customer' || char(10) || 'Isolate and test dead' || char(10) || 'Install and terminate' || char(10) || 'Test and verify' || char(10) || 'Clean up site' || char(10) || 'Customer sign-off');
