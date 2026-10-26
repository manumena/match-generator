-- Episode counts belong to provider releases, not canonical franchise answers.
-- NULL means unknown; the source's zero sentinel is normalized during import.
ALTER TABLE catalog.releases
  ADD COLUMN IF NOT EXISTS episodes integer CHECK (episodes > 0);
