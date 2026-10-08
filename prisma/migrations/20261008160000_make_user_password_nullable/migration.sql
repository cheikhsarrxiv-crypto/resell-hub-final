-- Google OAuth support: a Google-only account has no password at all —
-- never a placeholder/random hash (see src/lib/auth/provisionUser.ts and
-- src/auth.ts's Credentials authorize(), which now refuses to call
-- bcrypt.compare against a null password). Minimal, additive change:
-- only relaxes the NOT NULL constraint on an existing column. No data is
-- touched, no other column/table changes.
--
-- NOT applied to any database from this environment (no network route to
-- the project's Postgres instance here — see this repo's other recent
-- migrations' own header comments for the same constraint). Prepared for
-- review and for `prisma migrate deploy` to be run manually against a
-- local/dev database first, and only against production after separate,
-- explicit authorization. Not yet applied anywhere; must stay unapplied
-- until that authorization is given.

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "password" DROP NOT NULL;
