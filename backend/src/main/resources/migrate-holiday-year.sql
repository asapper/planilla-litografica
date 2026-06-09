-- Rename 'year' column (H2 reserved keyword since 2.x) to 'holiday_year'.
-- Runs with continueOnError=true so it is silently skipped when the table
-- does not exist yet or the column was already renamed.
ALTER TABLE holiday_cache RENAME COLUMN "YEAR" TO holiday_year;
