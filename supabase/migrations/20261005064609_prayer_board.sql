-- Application sessions are verified by Next.js. No browser Data API access.
CREATE SCHEMA IF NOT EXISTS prayer_private;
REVOKE ALL ON SCHEMA prayer_private FROM PUBLIC;

CREATE TABLE public.praycontentfield (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  datatype text NOT NULL CHECK (datatype IN ('selectbox','selectmultibox','checkbox','string','number','date','image','file','bool')),
  displaytype text NOT NULL DEFAULT '',
  option text NOT NULL DEFAULT '',
  "isGroupable" boolean NOT NULL DEFAULT false,
  "isFilterable" boolean NOT NULL DEFAULT false,
  "createDateTime" timestamptz NOT NULL DEFAULT clock_timestamp(),
  "updateDateTime" timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX praycontentfield_name_unique ON public.praycontentfield (lower(btrim(name)));

CREATE TABLE public.praycontent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(content) = 'object'),
  listdisplaydata text NOT NULL DEFAULT '',
  "createDateTime" timestamptz NOT NULL DEFAULT clock_timestamp(),
  "updateDateTime" timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX praycontent_recent ON public.praycontent ("createDateTime" DESC, id DESC);
CREATE INDEX praycontent_keys ON public.praycontent USING gin (content);

CREATE TABLE prayer_private.password (
  id text PRIMARY KEY CHECK (id IN ('member','sub-admin','admin')),
  pw text NOT NULL,
  "sessionVersion" integer NOT NULL DEFAULT 1 CHECK ("sessionVersion" > 0),
  "recentDateTime" timestamptz,
  "createDateTime" timestamptz NOT NULL DEFAULT clock_timestamp(),
  "updateDateTime" timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE prayer_private.sessions (
  id uuid PRIMARY KEY,
  role text NOT NULL REFERENCES prayer_private.password(id) ON DELETE CASCADE,
  version integer NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_role ON prayer_private.sessions(role);
CREATE INDEX sessions_expiry ON prayer_private.sessions("expiresAt");

-- This table is also the durable deletion queue: deleting rows are retried.
CREATE TABLE prayer_private.assets (
  id uuid PRIMARY KEY,
  "objectKey" text NOT NULL UNIQUE,
  "fieldId" uuid NOT NULL,
  "prayerId" uuid REFERENCES public.praycontent(id) ON DELETE SET NULL,
  "sessionId" uuid NOT NULL,
  name text NOT NULL,
  mime text NOT NULL,
  size integer NOT NULL CHECK (size > 0 AND size <= 4194304),
  state text NOT NULL CHECK (state IN ('uploading','pending','attached','deleting')),
  "expiresAt" timestamptz,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assets_prayer ON prayer_private.assets("prayerId");
CREATE INDEX assets_cleanup ON prayer_private.assets(state, "expiresAt");
CREATE TABLE prayer_private.rate_limits (
  key text PRIMARY KEY,
  hits integer NOT NULL,
  "expiresAt" timestamptz NOT NULL
);
CREATE INDEX rate_limits_expiry ON prayer_private.rate_limits("expiresAt");

ALTER TABLE public.praycontent ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.praycontentfield ENABLE ROW LEVEL SECURITY;
ALTER TABLE prayer_private.password ENABLE ROW LEVEL SECURITY;
ALTER TABLE prayer_private.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prayer_private.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE prayer_private.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.praycontent, public.praycontentfield FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA prayer_private FROM PUBLIC;

-- Supabase roles exist in hosted projects, but may not exist in plain Postgres.
DO $$
DECLARE client_role text;
BEGIN
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = client_role) THEN
      EXECUTE format('REVOKE ALL ON public.praycontent, public.praycontentfield FROM %I', client_role);
      EXECUTE format('REVOKE ALL ON SCHEMA prayer_private FROM %I', client_role);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA prayer_private FROM %I', client_role);
    END IF;
  END LOOP;
END $$;
