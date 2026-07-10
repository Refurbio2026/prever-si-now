
CREATE OR REPLACE FUNCTION public.get_scheduler_status()
RETURNS TABLE (
  jobname text,
  schedule text,
  active boolean,
  last_run_start timestamptz,
  last_run_status text,
  last_error text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, pg_catalog
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  SELECT
    j.jobname::text,
    j.schedule::text,
    j.active,
    d.start_time,
    d.status::text,
    d.return_message::text
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT start_time, status, return_message
    FROM cron.job_run_details
    WHERE jobid = j.jobid
    ORDER BY start_time DESC
    LIMIT 1
  ) d ON true
  WHERE j.jobname IN ('datahub-global-imports','datahub-queue-worker');
END $$;

REVOKE ALL ON FUNCTION public.get_scheduler_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_scheduler_status() TO authenticated;
