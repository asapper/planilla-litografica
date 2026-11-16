-- Every statement is guarded with IF EXISTS so it is a no-op on fresh databases
-- (schema-h2.sql runs afterwards and creates the tables) and on already-migrated ones.

-- Rename 'year' column (H2 reserved keyword since 2.x) to 'holiday_year'.
ALTER TABLE IF EXISTS holiday_cache ALTER COLUMN IF EXISTS "YEAR" RENAME TO holiday_year;

-- Add accrues_overtime flag for employees who don't accrue horas_extras_simples/dobles (TASK-33).
ALTER TABLE IF EXISTS employee_registry ADD COLUMN IF NOT EXISTS accrues_overtime BOOLEAN NOT NULL DEFAULT TRUE;

-- Add per-shift detection window overrides for opener-shift matching (TASK-40).
-- Defaults (60/10) match the previous hardcoded DETECTION_BEFORE_MINUTES/DETECTION_AFTER_MINUTES
-- constants in TasSessionGrouper, so existing shifts keep their current matching behavior
-- until explicitly tuned (e.g. noche, seeded with a wider after-window below).
ALTER TABLE IF EXISTS shift_config ADD COLUMN IF NOT EXISTS detection_before_minutes INTEGER NOT NULL DEFAULT 60;
ALTER TABLE IF EXISTS shift_config ADD COLUMN IF NOT EXISTS detection_after_minutes INTEGER NOT NULL DEFAULT 10;
