
CREATE OR REPLACE FUNCTION public.admin_list_cron_jobs()
RETURNS TABLE (
  jobname text,
  schedule text,
  active boolean,
  last_start_time timestamptz,
  last_end_time timestamptz,
  last_status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, pg_catalog
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not_admin';
  END IF;

  RETURN QUERY
  SELECT
    j.jobname::text,
    j.schedule::text,
    j.active,
    r.start_time,
    r.end_time,
    r.status::text
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT start_time, end_time, status
    FROM cron.job_run_details d
    WHERE d.jobid = j.jobid
    ORDER BY d.start_time DESC
    LIMIT 1
  ) r ON true
  WHERE j.jobname IN ('datahub-global-imports','datahub-queue-worker');
END $$;

REVOKE ALL ON FUNCTION public.admin_list_cron_jobs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_cron_jobs() TO authenticated;
