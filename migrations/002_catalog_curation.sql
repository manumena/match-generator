-- Our editorial layer is separate from the immutable upstream import.
CREATE TABLE IF NOT EXISTS catalog.search_metadata (
  anime_id integer PRIMARY KEY REFERENCES catalog.anime(id),
  display_title text CHECK (display_title IS NULL OR length(trim(display_title)) > 0),
  popularity smallint CHECK (popularity BETWEEN 0 AND 100),
  popularity_source text,
  popularity_updated_at timestamptz,
  search_priority smallint CHECK (search_priority BETWEEN 0 AND 100),
  reason text NOT NULL,
  CHECK (popularity IS NULL OR (popularity_source IS NOT NULL AND popularity_updated_at IS NOT NULL))
);

-- Preserve old IDs: aliases and future submissions resolve through redirects.
-- Administrative tooling rejects chains/cycles and conflicting remaps.
CREATE TABLE IF NOT EXISTS catalog.answer_redirects (
  anime_id integer PRIMARY KEY REFERENCES catalog.anime(id),
  canonical_id integer NOT NULL REFERENCES catalog.anime(id),
  reason text NOT NULL,
  CHECK (anime_id <> canonical_id)
);
CREATE INDEX IF NOT EXISTS answer_redirects_canonical_idx ON catalog.answer_redirects(canonical_id);

CREATE TABLE IF NOT EXISTS catalog.curation_revisions (
  version text PRIMARY KEY,
  sha256 text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW catalog.answer_identity AS
  SELECT a.id AS original_id, COALESCE(r.canonical_id, a.id) AS canonical_id
  FROM catalog.anime a LEFT JOIN catalog.answer_redirects r ON r.anime_id = a.id;

CREATE OR REPLACE VIEW catalog.song_answers AS
  SELECT s.song_id, i.canonical_id AS anime_id
  FROM catalog.song_anime s JOIN catalog.answer_identity i ON i.original_id = s.anime_id;
