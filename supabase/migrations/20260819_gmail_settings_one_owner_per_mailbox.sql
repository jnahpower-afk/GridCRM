-- One Gmail mailbox may only be claimed by one owner_name.
-- Applied to prod via the Management API; recorded here for traceability.

-- gmail-send resolves the sending account by owner_name, so a mailbox claimed
-- by a second owner_name means that person's outreach goes out from someone
-- else's inbox (with the wrong name on the From line and replies landing in
-- the wrong place). Two such rows existed — 'Cormac MacGrory' pointing at
-- max.karous@ and 'Charlie Armitage' at dany.dbaibo@, both created by
-- completing the Google consent screen while signed in as the other person.
-- Both were deleted so those users reconnect; this index stops a recurrence.
-- gmail-oauth-callback also checks for the clash first, to fail with a message
-- that tells the user what to do instead of a bare constraint violation.
create unique index if not exists user_gmail_settings_gmail_email_key
  on public.user_gmail_settings (gmail_email);
