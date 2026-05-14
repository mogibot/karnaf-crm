# Runbook — Operator can't log in

**Symptom:** Mia / a sales rep can't sign into karnaf-crm.vercel.app.
Could be: forgotten password, account toggled inactive, MFA glitch
(once we enable it), email never received, or auth provider outage.

## Triage (≤ 2 min)

1. **Confirm scope.** Is it one operator or all of them?
   - All → Supabase auth outage. Check https://status.supabase.com.
     File a Supabase support ticket. Pause troubleshooting.
   - Single user → continue.
2. **Confirm identity** before any reset — phone the operator directly
   on a known number. Password reset over Telegram from someone
   claiming to be Mia is exactly how account takeover starts.

## Common fixes

### Forgot password

- From `/admin/users` (owner/admin role): find the user, click "Send
  reset link." Email goes via Supabase auth → Mia clicks → sets new
  password.
- Manual fallback if email is broken:
  ```bash
  # Generate a magic-link in the Supabase Dashboard:
  # Auth → Users → click user → "Generate magic link"
  ```
- Tell Mia to **immediately rotate** her password to something she'll
  remember, written nowhere except her password manager.

### Account is `is_active=false`

Visible in `/admin/users` as a greyed row. Toggle the checkbox.
Reason most-common: an admin disabled them by mistake, or the nightly
job will (in future) auto-disable users inactive 90+ days.

### "Invalid login credentials" with the right password

Likely Supabase auth refresh token expired AND password was rotated
externally. Hard reset via Dashboard.

### Account locked from brute-force (when we wire MFA)

Once MFA + lockout is configured (Phase 4 future work), 5 wrong
attempts in 5 min temporarily locks the account. Wait 10 min or unlock
via Dashboard.

## Audit afterwards

- Add a row to `integration_logs` (table is `password_reset` source)
  with `requested_by_phone_verification`. Closes the audit gap.
- If it was a takeover attempt (wrong identity), check `auth.users`
  signin logs and rotate ALL operator passwords as a precaution.
