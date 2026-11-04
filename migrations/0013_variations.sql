-- Variations: extra work discovered during a job that the customer must approve before work proceeds.
-- status: draft -> sent (awaiting customer) -> approved | declined
CREATE TABLE IF NOT EXISTS variations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,                       -- per-job sequence: shown as <job id>-V<seq>
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  decided_at TEXT,
  approved_name TEXT,
  approval_signature TEXT,
  decline_reason TEXT,
  applied_at TEXT                              -- when the lines were copied onto the job
);
CREATE INDEX IF NOT EXISTS idx_variations_job ON variations(job_id);

CREATE TABLE IF NOT EXISTS variation_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variation_id INTEGER NOT NULL REFERENCES variations(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0,          -- ex GST
  cost REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_variation_items_v ON variation_items(variation_id);
