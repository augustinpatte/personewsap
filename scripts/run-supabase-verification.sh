#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "Missing DATABASE_URL. Use a Supabase pooled or direct Postgres connection string." >&2
  exit 2
fi

if [[ -z "${SUPABASE_VERIFY_USER_A:-}" ]]; then
  echo "Missing SUPABASE_VERIFY_USER_A. Set it to tester A auth/profile UUID." >&2
  exit 2
fi

if [[ -z "${SUPABASE_VERIFY_USER_A_EMAIL:-}" ]]; then
  echo "Missing SUPABASE_VERIFY_USER_A_EMAIL. Set it to tester A email for auth.email() RLS checks." >&2
  exit 2
fi

if [[ -z "${SUPABASE_VERIFY_USER_B:-}" ]]; then
  echo "Missing SUPABASE_VERIFY_USER_B. Set it to tester B auth/profile UUID." >&2
  exit 2
fi

if [[ -z "${SUPABASE_VERIFY_PUBLISHED_CONTENT_ID:-}" ]]; then
  echo "Missing SUPABASE_VERIFY_PUBLISHED_CONTENT_ID. Set it to a published content_items UUID." >&2
  exit 2
fi

PROOF_DATE="${SUPABASE_VERIFY_PROOF_DATE:-2099-01-01}"

echo "Running read-only schema doctor SQL..."
psql "$DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --file="$ROOT_DIR/supabase/verification/schema_doctor.sql"

echo "Running constraint and duplicate audit..."
psql "$DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --file="$ROOT_DIR/supabase/verification/constraints_and_duplicates.sql"

echo "Running RLS access matrix..."
psql "$DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --set=user_a="$SUPABASE_VERIFY_USER_A" \
  --set=user_a_email="$SUPABASE_VERIFY_USER_A_EMAIL" \
  --set=user_b="$SUPABASE_VERIFY_USER_B" \
  --set=published_content_id="$SUPABASE_VERIFY_PUBLISHED_CONTENT_ID" \
  --set=proof_date="$PROOF_DATE" \
  --file="$ROOT_DIR/supabase/verification/rls_access_matrix.sql"

echo "Running rollbacked service-role write probe..."
psql "$DATABASE_URL" \
  --set=ON_ERROR_STOP=1 \
  --set=user_a="$SUPABASE_VERIFY_USER_A" \
  --set=proof_date="$PROOF_DATE" \
  --file="$ROOT_DIR/supabase/verification/service_role_write_probe.sql"

echo "Supabase verification SQL finished."
