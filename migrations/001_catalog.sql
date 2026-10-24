-- Additive: public.songs and the deployed SELECT * API remain untouched.
CREATE SCHEMA IF NOT EXISTS catalog;

CREATE TABLE IF NOT EXISTS catalog.migrations (
  version text PRIMARY KEY,
  sha256 text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog.imports (
  id text PRIMARY KEY,
  source_url text NOT NULL,
  source_sha256 text NOT NULL,
  mappings_sha256 text NOT NULL,
  source_date date NOT NULL,
  license text NOT NULL,
  attribution text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS catalog.anime (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stable_key text NOT NULL UNIQUE,
  title text NOT NULL CHECK (length(title) > 0),
  curated boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS catalog.releases (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  stable_key text NOT NULL UNIQUE,
  anime_id integer NOT NULL REFERENCES catalog.anime(id),
  import_id text NOT NULL REFERENCES catalog.imports(id),
  title text NOT NULL,
  format text NOT NULL,
  release_year integer,
  source_urls text[] NOT NULL,
  related_urls text[] NOT NULL,
  picture_url text,
  thumbnail_url text,
  UNIQUE (id, anime_id)
);
CREATE INDEX IF NOT EXISTS releases_anime_id_idx ON catalog.releases(anime_id);
CREATE INDEX IF NOT EXISTS releases_import_id_idx ON catalog.releases(import_id);

CREATE TABLE IF NOT EXISTS catalog.aliases (
  anime_id integer NOT NULL REFERENCES catalog.anime(id),
  alias text NOT NULL CHECK (length(alias) > 0),
  provenance text NOT NULL CHECK (provenance IN ('snapshot', 'curated')),
  PRIMARY KEY (anime_id, alias)
);

-- One authoritative answer per song, without adding fields to legacy SELECT *.
CREATE TABLE IF NOT EXISTS catalog.song_anime (
  song_id integer PRIMARY KEY REFERENCES public.songs(id),
  anime_id integer NOT NULL REFERENCES catalog.anime(id),
  legacy_anime text NOT NULL,
  import_id text NOT NULL REFERENCES catalog.imports(id)
);
CREATE INDEX IF NOT EXISTS song_anime_anime_id_idx ON catalog.song_anime(anime_id);
CREATE INDEX IF NOT EXISTS song_anime_import_id_idx ON catalog.song_anime(import_id);

CREATE TABLE IF NOT EXISTS catalog.artwork (
  anime_id integer PRIMARY KEY REFERENCES catalog.anime(id),
  representative_release_id integer NOT NULL,
  FOREIGN KEY (representative_release_id, anime_id) REFERENCES catalog.releases(id, anime_id)
);
