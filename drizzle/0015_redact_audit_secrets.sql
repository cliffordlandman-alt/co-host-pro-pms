-- Audit entries used to store request bodies as-is, including private channel calendar feed links
-- (Airbnb / Booking.com / Vrbo iCal URLs). Redact them, and any credential-like fields, in place.
-- Same rules as lib/redact.mjs. Only the secret values change; the rest of each entry is kept.
UPDATE audit_logs
SET details = regexp_replace(
      regexp_replace(
        regexp_replace(details,
          '("[A-Za-z0-9_-]*(ical|password|passwd|secret|token|api[-_]?key|authorization|cookie|credential|private[-_]?key|signature)[A-Za-z0-9_-]*"\s*:\s*)"(?:[^"\\]|\\.)+"',
          '\1"[redacted]"', 'gi'),
        'https?://[^\s"''<>]*(ical|\.ics)[^\s"''<>]*', '[redacted URL]', 'gi'),
      'https?://[^\s"''<>]*[?&](s|t|token|key|sig|signature|secret|auth|access_token)=[^\s"''<>]*', '[redacted URL]', 'gi')
WHERE details IS NOT NULL
  AND details ~* '(ical|password|passwd|secret|token|api[-_]?key|authorization|cookie|credential|private[-_]?key|signature|https?://)';
