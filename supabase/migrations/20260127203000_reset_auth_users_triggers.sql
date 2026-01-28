DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      t.tgname,
      pg_get_triggerdef(t.oid) AS def,
      p.oid::regprocedure AS fn
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'auth.users'::regclass
      AND NOT t.tgisinternal
    ORDER BY t.tgname
  LOOP
    RAISE NOTICE 'auth.users trigger: % | fn=% | %', r.tgname, r.fn, r.def;
  END LOOP;

  FOR r IN
    SELECT
      c.conname,
      pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    WHERE c.conrelid = 'auth.users'::regclass
    ORDER BY c.conname
  LOOP
    RAISE NOTICE 'auth.users constraint: % | %', r.conname, r.def;
  END LOOP;
END $$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT tgname
    FROM pg_trigger
    WHERE tgrelid = 'auth.users'::regclass
      AND NOT tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON auth.users', r.tgname);
  END LOOP;
END $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
