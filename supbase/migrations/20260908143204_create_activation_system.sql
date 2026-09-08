/*
# Create activation codes system

## Overview
Creates the activation_codes table, SECURITY DEFINER functions for code verification,
and a storage bucket for user file uploads. This replaces the Vercel-based backend
with Supabase Edge Functions + Database.

## 1. New Tables
- `activation_codes`
  - `id` (uuid, primary key)
  - `code` (text, unique, not null) — the activation code string
  - `is_active` (boolean, default false) — whether the code has been activated
  - `activated_at` (timestamptz, nullable) — when the code was first activated
  - `expires_at` (timestamptz, nullable) — 30 days from activation
  - `device_id` (text, nullable) — SHA-256 fingerprint of the activating device
  - `created_at` (timestamptz, default now())
  - `last_used_at` (timestamptz, nullable) — updated on each check

## 2. Security
- RLS enabled on `activation_codes` — NO policies for anon/authenticated.
  The table is completely locked from direct client access.
  All access goes through SECURITY DEFINER functions (run as owner, bypass RLS).
- Storage bucket `user-files` created as private (not public).
  Anon can INSERT (upload) but cannot SELECT/UPDATE/DELETE.
  Edge functions use service role key to read files from storage.

## 3. Functions
- `activate_code(p_code text, p_device_id text)` — SECURITY DEFINER
  Activates a new code (first use) or returns status of an already-active code.
  Sets is_active=true, activated_at=now(), expires_at=now()+30 days, device_id on first use.
  Updates last_used_at on every call.
  Returns: json with { valid, message, expires_at, activated_at, is_active }

- `check_code(p_code text, p_device_id text)` — SECURITY DEFINER
  Read-only check of activation status. Never activates.
  Returns: json with { valid, message, expires_at, activated_at, is_active }
  Used by auth guard and edge functions to verify access.

## 4. Storage
- Bucket `user-files` (private)
  - Anon INSERT allowed (frontend uploads files here)
  - Anon SELECT/UPDATE/DELETE denied (edge function reads with service role key)
*/

-- ============================================================
-- 1. activation_codes table
-- ============================================================
CREATE TABLE IF NOT EXISTS activation_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  activated_at timestamptz,
  expires_at timestamptz,
  device_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

ALTER TABLE activation_codes ENABLE ROW LEVEL SECURITY;

-- No policies: the table is completely locked from direct client access.
-- All reads/writes go through SECURITY DEFINER functions.

-- ============================================================
-- 2. activate_code function (first activation + status check)
-- ============================================================
CREATE OR REPLACE FUNCTION activate_code(p_code text, p_device_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record activation_codes%ROWTYPE;
  v_result json;
BEGIN
  SELECT * INTO v_record FROM activation_codes WHERE code = p_code LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'valid', false,
      'message', 'الكود غير صحيح',
      'is_active', false
    );
  END IF;

  -- Code was previously activated
  IF v_record.is_active = true THEN

    -- Check device match
    IF v_record.device_id IS NOT NULL AND v_record.device_id != p_device_id THEN
      RETURN json_build_object(
        'valid', false,
        'message', 'هذا الكود مرتبط بجهاز آخر',
        'is_active', true
      );
    END IF;

    -- Check expiry
    IF v_record.expires_at IS NOT NULL AND v_record.expires_at < now() THEN
      UPDATE activation_codes SET last_used_at = now() WHERE id = v_record.id;
      RETURN json_build_object(
        'valid', false,
        'message', 'انتهت صلاحية الكود',
        'is_active', true,
        'expires_at', v_record.expires_at
      );
    END IF;

    -- Valid: update last_used_at
    UPDATE activation_codes SET last_used_at = now() WHERE id = v_record.id;

    RETURN json_build_object(
      'valid', true,
      'message', 'الكود صالح',
      'is_active', true,
      'activated_at', v_record.activated_at,
      'expires_at', v_record.expires_at
    );
  END IF;

  -- Code exists but not active: activate now
  UPDATE activation_codes
  SET is_active = true,
      activated_at = now(),
      expires_at = now() + interval '30 days',
      device_id = p_device_id,
      last_used_at = now()
  WHERE id = v_record.id
  RETURNING * INTO v_record;

  RETURN json_build_object(
    'valid', true,
    'message', 'تم تفعيل الكود بنجاح',
    'is_active', true,
    'activated_at', v_record.activated_at,
    'expires_at', v_record.expires_at
  );
END;
$$;

-- ============================================================
-- 3. check_code function (read-only status check)
-- ============================================================
CREATE OR REPLACE FUNCTION check_code(p_code text, p_device_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_record activation_codes%ROWTYPE;
BEGIN
  SELECT * INTO v_record FROM activation_codes WHERE code = p_code LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object(
      'valid', false,
      'message', 'الكود غير صحيح',
      'is_active', false
    );
  END IF;

  -- Not activated yet
  IF v_record.is_active = false THEN
    RETURN json_build_object(
      'valid', false,
      'message', 'هذا الكود لم يُفعّل بعد',
      'is_active', false
    );
  END IF;

  -- Device mismatch
  IF v_record.device_id IS NOT NULL AND v_record.device_id != p_device_id THEN
    RETURN json_build_object(
      'valid', false,
      'message', 'هذا الكود مرتبط بجهاز آخر',
      'is_active', true
    );
  END IF;

  -- Expired
  IF v_record.expires_at IS NOT NULL AND v_record.expires_at < now() THEN
    UPDATE activation_codes SET last_used_at = now() WHERE id = v_record.id;
    RETURN json_build_object(
      'valid', false,
      'message', 'انتهت صلاحية الكود',
      'is_active', true,
      'expires_at', v_record.expires_at
    );
  END IF;

  -- Valid: update last_used_at
  UPDATE activation_codes SET last_used_at = now() WHERE id = v_record.id;

  RETURN json_build_object(
    'valid', true,
    'message', 'الكود صالح',
    'is_active', true,
    'activated_at', v_record.activated_at,
    'expires_at', v_record.expires_at
  );
END;
$$;

-- ============================================================
-- 4. Storage bucket for user file uploads
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('user-files', 'user-files', false)
ON CONFLICT (id) DO NOTHING;

-- Allow anon to upload files (INSERT only)
DROP POLICY IF EXISTS "anon_upload_user_files" ON storage.objects;
CREATE POLICY "anon_upload_user_files"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (bucket_id = 'user-files');

-- No SELECT/UPDATE/DELETE policies: edge functions use service role key to read.
