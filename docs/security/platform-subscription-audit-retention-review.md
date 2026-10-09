# Platform subscription audit: retention and deletion review

Status: draft. No production migration or billing activation is authorized.

## Record purpose
Each successful manual creation of a non-entitled subscription draft produces one audit record in the same database transaction. Fields include actor UUID, organization UUID, subscription UUID, plan UUID, billing mode, status, and creation timestamp. No card details, payment credentials, or customer free-text are copied into this log.

## Referential integrity
The proposed audit foreign keys use ON DELETE RESTRICT for both organization and subscription. This intentionally blocks direct deletion of an audited record, including deletion cascades through the existing subscription foreign key, until an authorized retention/disposal workflow has been defined. It does not prevent all other deletion paths in the wider application.

## Policy decisions required before commercial rollout
- Approve a retention period and legal basis appropriate to applicable jurisdictions and contractual obligations; no duration is assumed here.
- Define who can read audit entries and through which least-privilege administrative endpoint. RLS is enabled and no client SELECT policy is created by this migration.
- Establish a reviewed process for deletion/anonymization requests, legal holds, export, and controlled disposal; do not silently cascade-delete audit evidence.
- Test actual Supabase role grants, backups, and operational recovery procedures in a non-production environment.
- Keep commercial activation and payment evidence in a separate audited workflow.

## Boundaries
This draft records only successful non-entitled manual creation, not failed attempts, payment confirmation, renewal, cancellation, or privileged direct SQL writes. Application and database logs may be needed for denied attempts. The table is not a substitute for tamper-evident external audit storage.
