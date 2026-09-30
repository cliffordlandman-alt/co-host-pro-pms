-- One owner statement per property per month.
-- If duplicates already exist they are NOT deleted or merged: the unique index is skipped, a notice
-- lists them, and the app refuses to publish or pay any of them until someone resolves them
-- (see GET /api/accounting/statements/duplicates). Re-run this block after cleaning up.
DO $$
DECLARE dupes text;
BEGIN
  SELECT string_agg(format('property %s month %s: statements %s', property_id, month, ids), '; ')
    INTO dupes
    FROM (SELECT property_id, month, string_agg(id::text || ' (' || status || ')', ', ' ORDER BY id) AS ids
            FROM owner_statements GROUP BY property_id, month HAVING count(*) > 1) d;
  IF dupes IS NOT NULL THEN
    RAISE NOTICE 'owner_statements unique index NOT created; duplicate statements found (nothing was deleted): %', dupes;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS owner_statements_property_month_unique ON owner_statements (property_id, month);
    DROP INDEX IF EXISTS owner_statements_property_month_idx;
  END IF;
END $$;
