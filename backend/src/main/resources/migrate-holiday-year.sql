-- Rename 'year' column (H2 reserved keyword since 2.x) to 'holiday_year'.
-- Runs with continueOnError=true so it is silently skipped when the table
-- does not exist yet or the column was already renamed.
ALTER TABLE holiday_cache RENAME COLUMN "YEAR" TO holiday_year;

-- Add accrues_overtime flag for employees who don't accrue horas_extras_simples/dobles (TASK-33).
-- Runs with continueOnError=true so it is silently skipped on fresh databases where
-- employee_registry doesn't exist yet (schema-h2.sql will create it with the column already).
ALTER TABLE employee_registry ADD COLUMN IF NOT EXISTS accrues_overtime BOOLEAN NOT NULL DEFAULT TRUE;

-- Add per-shift detection window overrides for opener-shift matching (TASK-40).
-- Defaults (60/10) match the previous hardcoded DETECTION_BEFORE_MINUTES/DETECTION_AFTER_MINUTES
-- constants in TasSessionGrouper, so existing shifts keep their current matching behavior
-- until explicitly tuned (e.g. noche, seeded with a wider after-window below).
ALTER TABLE shift_config ADD COLUMN IF NOT EXISTS detection_before_minutes INTEGER NOT NULL DEFAULT 60;
ALTER TABLE shift_config ADD COLUMN IF NOT EXISTS detection_after_minutes INTEGER NOT NULL DEFAULT 10;
