ALTER TABLE jobs ADD COLUMN onsite_contact_name TEXT;
ALTER TABLE jobs ADD COLUMN onsite_contact_phone TEXT;
-- Existing jobs default to the customer's address
UPDATE jobs SET site_address = (SELECT address FROM clients WHERE clients.id = jobs.client_id)
  WHERE site_address IS NULL OR trim(site_address) = '';
