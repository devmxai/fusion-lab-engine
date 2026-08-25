
-- 1. App roles enum
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- 2. User roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 3. Security definer function for role checking
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- 4. Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 5. Subscription plans
CREATE TYPE public.plan_type AS ENUM ('starter', 'plus', 'pro');

CREATE TABLE public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  type plan_type NOT NULL UNIQUE,
  price NUMERIC NOT NULL DEFAULT 0,
  credits_per_month INTEGER NOT NULL DEFAULT 0,
  features JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. User subscriptions
CREATE TYPE public.subscription_status AS ENUM ('active', 'expired', 'cancelled', 'pending');

CREATE TABLE public.user_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  plan_id UUID REFERENCES public.subscription_plans(id) NOT NULL,
  status subscription_status NOT NULL DEFAULT 'pending',
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  activated_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

-- 7. User credits
CREATE TABLE public.user_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  balance INTEGER NOT NULL DEFAULT 0,
  total_earned INTEGER NOT NULL DEFAULT 0,
  total_spent INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;

-- 8. Credit transactions
CREATE TYPE public.credit_action AS ENUM ('earned', 'spent', 'admin_grant', 'subscription_grant', 'trial_grant', 'refund');

CREATE TABLE public.credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  amount INTEGER NOT NULL,
  action credit_action NOT NULL,
  description TEXT,
  granted_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

-- 9. Trial requests
CREATE TYPE public.trial_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE public.trial_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  status trial_status NOT NULL DEFAULT 'pending',
  message TEXT,
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  trial_days INTEGER DEFAULT 7,
  trial_credits INTEGER DEFAULT 50,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.trial_requests ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- user_roles: users read own, admins read all
CREATE POLICY "Users read own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- profiles: users read/update own, admins read all
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins read all profiles" ON public.profiles FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- subscription_plans: everyone can read
CREATE POLICY "Anyone can read plans" ON public.subscription_plans FOR SELECT USING (true);
CREATE POLICY "Admins manage plans" ON public.subscription_plans FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- user_subscriptions: users read own, admins manage all
CREATE POLICY "Users read own subscriptions" ON public.user_subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins manage subscriptions" ON public.user_subscriptions FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- user_credits: users read own, admins manage all
CREATE POLICY "Users read own credits" ON public.user_credits FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins manage credits" ON public.user_credits FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- credit_transactions: users read own, admins manage all
CREATE POLICY "Users read own transactions" ON public.credit_transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins manage transactions" ON public.credit_transactions FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- trial_requests: users read/insert own, admins manage all
CREATE POLICY "Users read own trials" ON public.trial_requests FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users request trials" ON public.trial_requests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins manage trials" ON public.trial_requests FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Trigger to auto-create profile and credits on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));

  INSERT INTO public.user_credits (user_id, balance, total_earned)
  VALUES (NEW.id, 0, 0);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
