-- Workspaces get a support code in the format XXXX-XXXX (uppercase letters
-- and digits). New workspaces generate one on insert; this migration adds the
-- column and backfills every existing workspace. Idempotent: existing non-null
-- codes are left untouched and the column/index creation is guarded.

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS support_code text;

DO $$
DECLARE
  ws RECORD;
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
BEGIN
  FOR ws IN SELECT id FROM workspaces WHERE support_code IS NULL ORDER BY created_at, id LOOP
    LOOP
      code := '';
      FOR i IN 1..8 LOOP
        code := code || substr(alphabet, 1 + floor(random() * 32)::int, 1);
        IF i = 4 THEN
          code := code || '-';
        END IF;
      END LOOP;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM workspaces WHERE support_code = code);
    END LOOP;
    UPDATE workspaces SET support_code = code WHERE id = ws.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS workspaces_support_code_unique ON workspaces (support_code);
