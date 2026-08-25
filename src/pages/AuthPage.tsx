import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Sparkles, Mail, Lock, User, ArrowLeft } from "lucide-react";

const AUTH_REDIRECT_KEY = "fusionlab.auth.redirectTo";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GOOGLE_SCRIPT_ID = "google-identity-services";
const DEFAULT_AUTH_REDIRECT = "/projects";
const AUTH_HANDOFF_FLAG = "fusion_auth";
const ALLOWED_RETURN_ORIGINS = new Set([
  "https://fusionlab.pro",
  "https://ai.fusionlab.pro",
  "https://editor.fusionlab.pro",
]);

type GoogleCredentialResponse = {
  credential?: string;
};

const loadGoogleIdentityServices = () => {
  if (window.google?.accounts?.id) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const existingScript = document.getElementById(GOOGLE_SCRIPT_ID) as HTMLScriptElement | null;

    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("تعذر تحميل Google Sign-In")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = GOOGLE_SCRIPT_ID;
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("تعذر تحميل Google Sign-In"));
    document.head.appendChild(script);
  });
};

const createGoogleNonce = async () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = btoa(String.fromCharCode(...bytes));
  const encodedNonce = new TextEncoder().encode(nonce);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encodedNonce);
  const hashedNonce = Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return { nonce, hashedNonce };
};

const getAuthErrorMessage = (err: unknown) => {
  const message = err instanceof Error ? err.message : "حدث خطأ";
  const normalized = message.toLowerCase();

  if (
    normalized.includes("password is known") ||
    normalized.includes("weak") ||
    normalized.includes("easy to guess")
  ) {
    return "رفض Supabase كلمة المرور لأنها ظهرت في قوائم كلمات مرور مسربة أو سهلة التخمين. استخدم كلمة مرور عشوائية طويلة، أو سجّل الدخول عبر Google.";
  }

  return message;
};

const getSafeReturnTo = (search: string) => {
  const requestedReturn = new URLSearchParams(search).get("return_to");
  if (!requestedReturn) return null;

  try {
    const target = new URL(requestedReturn, window.location.origin);
    const isLocalhost = target.hostname === "localhost" || target.hostname === "127.0.0.1";

    if (target.origin === window.location.origin || ALLOWED_RETURN_ORIGINS.has(target.origin) || isLocalhost) {
      return target.toString();
    }
  } catch {
    return null;
  }

  return null;
};

const addSessionHandoff = (destination: URL, session: Session | null) => {
  if (destination.origin === window.location.origin || !session?.access_token || !session?.refresh_token) {
    return destination;
  }

  const hashParams = new URLSearchParams(destination.hash.startsWith("#") ? destination.hash.slice(1) : destination.hash);
  hashParams.set(AUTH_HANDOFF_FLAG, "1");
  hashParams.set("access_token", session.access_token);
  hashParams.set("refresh_token", session.refresh_token);
  hashParams.set("token_type", session.token_type || "bearer");

  if (session.expires_at) {
    hashParams.set("expires_at", String(session.expires_at));
  }

  destination.hash = hashParams.toString();
  return destination;
};

const AuthPage = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const googleNonceRef = useRef("");
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();

  const from =
    getSafeReturnTo(location.search) ||
    (typeof location.state === "object" &&
    location.state !== null &&
    "from" in location.state &&
    typeof location.state.from === "string"
      ? location.state.from
      : DEFAULT_AUTH_REDIRECT);

  const completeAuthRedirect = async (target: string, providedSession?: Session | null) => {
    const destination = new URL(target, window.location.origin);

    if (destination.origin === window.location.origin) {
      navigate(`${destination.pathname}${destination.search}${destination.hash}`, { replace: true });
      return;
    }

    const session = providedSession ?? (await supabase.auth.getSession()).data.session;
    window.location.assign(addSessionHandoff(destination, session).toString());
  };

  useEffect(() => {
    if (authLoading || !user) return;

    const storedRedirect = sessionStorage.getItem(AUTH_REDIRECT_KEY);
    sessionStorage.removeItem(AUTH_REDIRECT_KEY);
    void completeAuthRedirect(storedRedirect || from);
  }, [authLoading, from, navigate, user]);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !googleButtonRef.current) return;

    let cancelled = false;

    const renderGoogleButton = async () => {
      try {
        await loadGoogleIdentityServices();
        const { nonce, hashedNonce } = await createGoogleNonce();

        if (cancelled || !googleButtonRef.current) return;

        googleNonceRef.current = nonce;
        googleButtonRef.current.innerHTML = "";

        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async (response: GoogleCredentialResponse) => {
            setLoading(true);
            sessionStorage.setItem(AUTH_REDIRECT_KEY, from);

            try {
              if (!response.credential) {
                throw new Error("لم يرجع Google رمز الدخول");
              }

              const { data, error } = await supabase.auth.signInWithIdToken({
                provider: "google",
                token: response.credential,
                nonce: googleNonceRef.current,
              });

              if (error) throw error;
              await completeAuthRedirect(from, data.session);
            } catch (err: unknown) {
              sessionStorage.removeItem(AUTH_REDIRECT_KEY);
              toast.error(getAuthErrorMessage(err));
              setLoading(false);
            }
          },
          nonce: hashedNonce,
          auto_select: false,
          cancel_on_tap_outside: true,
          use_fedcm_for_button: true,
        });

        window.google.accounts.id.renderButton(googleButtonRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          logo_alignment: "left",
          width: googleButtonRef.current.offsetWidth || 320,
          locale: "ar",
        });
      } catch (err: unknown) {
        toast.error(getAuthErrorMessage(err));
      }
    };

    renderGoogleButton();

    return () => {
      cancelled = true;
    };
  }, [from]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isLogin) {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("تم تسجيل الدخول بنجاح!");
        await completeAuthRedirect(from, data.session);
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: fullName },
            emailRedirectTo: `${window.location.origin}/auth`,
          },
        });
        if (error) throw error;
        // Auto-confirm is enabled, so user is logged in immediately
        if (data.session) {
          toast.success("تم إنشاء الحساب بنجاح! مرحباً بك");
          await completeAuthRedirect(from, data.session);
        } else {
          // Fallback: sign in immediately
          const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
          if (signInError) throw signInError;
          toast.success("تم إنشاء الحساب بنجاح!");
          await completeAuthRedirect(from, signInData.session);
        }
      }
    } catch (err: unknown) {
      toast.error(getAuthErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4" dir="rtl">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm space-y-6"
      >
        <div className="text-center space-y-2">
          <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-7 h-7 text-primary" />
          </div>
          <h1 className="text-xl font-bold text-foreground">
            <span className="text-primary">FUSION</span> LAB
          </h1>
          <p className="text-sm text-muted-foreground">
            {isLogin ? "تسجيل الدخول إلى حسابك" : "إنشاء حساب جديد"}
          </p>
        </div>

        <div className="space-y-3">
          <div className="relative min-h-10 w-full overflow-hidden rounded-md bg-card">
            {GOOGLE_CLIENT_ID ? (
              <div
                ref={googleButtonRef}
                className="flex w-full justify-center [&>div]:w-full [&_iframe]:mx-auto"
                aria-disabled={loading}
              />
            ) : (
              <Button type="button" variant="outline" className="w-full bg-card border-border/50" disabled>
                Google Sign-In غير مهيأ
              </Button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border/60" />
            <span className="text-[11px] text-muted-foreground">أو</span>
            <div className="h-px flex-1 bg-border/60" />
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {!isLogin && (
            <div className="relative">
              <User className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="الاسم الكامل"
                className="pr-10 bg-card border-border/50 text-sm"
                required
              />
            </div>
          )}
          <div className="relative">
            <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="البريد الإلكتروني"
              className="pr-10 bg-card border-border/50 text-sm"
              dir="ltr"
              required
            />
          </div>
          <div className="relative">
            <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="كلمة المرور"
              className="pr-10 bg-card border-border/50 text-sm"
              dir="ltr"
              required
              minLength={isLogin ? undefined : 12}
              autoComplete={isLogin ? "current-password" : "new-password"}
            />
          </div>

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "جاري المعالجة..." : isLogin ? "تسجيل الدخول" : "إنشاء حساب"}
          </Button>
        </form>

        <div className="text-center">
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-xs text-primary hover:underline"
          >
            {isLogin ? "ليس لديك حساب؟ أنشئ حساباً" : "لديك حساب؟ سجل الدخول"}
          </button>
        </div>

        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mx-auto"
        >
          <ArrowLeft className="w-3 h-3" />
          العودة للرئيسية
        </button>
      </motion.div>
    </div>
  );
};

export default AuthPage;
