-- Workspace slugs are now derived automatically from the workspace name.
-- Backfill every existing workspace, de-duplicating collisions with a numeric
-- suffix (oldest workspace keeps the base slug). Idempotent: fresh databases
-- already satisfy the WHERE clause.

DO $$
DECLARE
  ws RECORD;
  base text;
  candidate text;
  suffix integer;
BEGIN
  FOR ws IN
    SELECT id, name, slug, created_at
    FROM workspaces
    WHERE regexp_replace(lower(coalesce(name, '')), '[^a-z0-9]+', '-', 'g') <> slug
    ORDER BY created_at, id
  LOOP
    base := regexp_replace(lower(trim(coalesce(ws.name, ''))), '[^a-z0-9]+', '-', 'g');
    base := regexp_replace(base, '^-+|-+$', '', 'g');
    base := left(base, 60);
    base := regexp_replace(base, '-+$', '', 'g');
    IF base = '' OR base IS NULL THEN
      base := 'workspace';
    END IF;

    candidate := base;
    suffix := 2;
    WHILE EXISTS (SELECT 1 FROM workspaces WHERE slug = candidate AND id <> ws.id) LOOP
      candidate := base || '-' || suffix;
      suffix := suffix + 1;
    END LOOP;

    UPDATE workspaces SET slug = candidate WHERE id = ws.id;
  END LOOP;
END $$;
