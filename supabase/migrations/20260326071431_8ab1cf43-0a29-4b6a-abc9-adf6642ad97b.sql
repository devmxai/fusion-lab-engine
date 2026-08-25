
-- Trigger to sync profile on auth.users update (email + full_name)
CREATE OR REPLACE FUNCTION public.sync_profile_on_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.profiles 
  SET 
    email = NEW.email,
    full_name = COALESCE(NEW.raw_user_meta_data->>'full_name', profiles.full_name),
    updated_at = now()
  WHERE id = NEW.id 
    AND (
      email IS DISTINCT FROM NEW.email 
      OR full_name IS DISTINCT FROM (NEW.raw_user_meta_data->>'full_name')
    );
  RETURN NEW;
END;
$$;

-- Create trigger on auth.users
CREATE OR REPLACE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_on_update();
