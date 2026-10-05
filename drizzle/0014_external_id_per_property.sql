-- Channel event ids are unique per property (feed), not globally. Airbnb reuses the same
-- "Not available" UID across different listings, so the old global unique index made the second
-- listing's block silently disappear. The new index is strictly looser than the old one, so it can
-- always be created on existing data: nothing is deleted or rewritten.
CREATE UNIQUE INDEX IF NOT EXISTS reservations_property_external_id_unique ON reservations (property_id, external_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS reservations_external_id_idx ON reservations (external_id);
--> statement-breakpoint
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS reservations_external_id_unique;
--> statement-breakpoint
DROP INDEX IF EXISTS reservations_external_id_unique;
