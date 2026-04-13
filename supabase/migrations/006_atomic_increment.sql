-- Migration 006: Add atomic increment function for usage counters.
-- Prevents race conditions when concurrent requests update the same counter.

CREATE OR REPLACE FUNCTION increment_usage_field(row_id UUID, field_name TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_val INTEGER;
BEGIN
  -- Only allow known counter fields to prevent SQL injection
  IF field_name NOT IN ('deterministic_count', 'ai_count') THEN
    RAISE EXCEPTION 'Invalid field name: %', field_name;
  END IF;

  -- Atomic increment using dynamic SQL with safe field validation above
  EXECUTE format(
    'UPDATE usage SET %I = COALESCE(%I, 0) + 1 WHERE id = $1 RETURNING %I',
    field_name, field_name, field_name
  ) INTO new_val USING row_id;

  RETURN new_val;
END;
$$;
