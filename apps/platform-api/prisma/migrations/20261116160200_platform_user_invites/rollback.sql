-- Rollback for 20261116160200_platform_user_invites.
--
-- The table only holds outstanding platform-user invitations; dropping it
-- invalidates every pending invite (accept links stop working) but affects
-- no created user — PlatformUser rows are untouched. Run only when
-- deliberately reverting this release. Data in this table is not
-- recoverable after the drop.
DROP TABLE IF EXISTS "PlatformUserInvite";
