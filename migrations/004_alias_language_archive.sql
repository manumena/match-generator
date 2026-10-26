-- Removed aliases remain recoverable, but never enter the browser export.
-- The primary key also prevents repeat imports from resurrecting an excluded alias.
CREATE TABLE IF NOT EXISTS catalog.excluded_aliases (
  anime_id integer NOT NULL REFERENCES catalog.anime(id),
  alias text NOT NULL,
  provenance text NOT NULL CHECK (provenance IN ('snapshot', 'curated')),
  languages text[] NOT NULL,
  reason text NOT NULL,
  policy text NOT NULL,
  source_sha256 text NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (anime_id, alias)
);
