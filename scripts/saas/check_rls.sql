-- Deployment/CI gate. Must return zero rows.
-- Any tenant-scoped table missing RLS/force/policy/trigger is a security gap.
SELECT table_name,
       tenant_scoped,
       rls_enabled,
       rls_forced,
       has_policy,
       has_trigger
FROM rls_coverage
WHERE tenant_scoped
  AND (NOT rls_enabled OR NOT rls_forced OR NOT has_policy OR NOT has_trigger)
ORDER BY table_name;
