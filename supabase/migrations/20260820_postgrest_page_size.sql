-- Private Wire data loaders request up to 5,000 rows per page. Keep PostgREST's
-- server-side response cap aligned so those pages are not silently truncated.
alter role authenticator set pgrst.db_max_rows = 5000;
notify pgrst, 'reload config';
