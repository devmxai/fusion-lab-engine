import { ArrowRight, CalendarDays, CheckCircle2, KeyRound, Loader2, LogOut, RefreshCw, ShieldCheck, Sparkles, WalletCards } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { getCustomerAccount, redeemActivationKey, type CustomerAccount } from "@/lib/subscription-client";

const number = new Intl.NumberFormat("ar-IQ");
const date = new Intl.DateTimeFormat("ar-IQ", { dateStyle: "medium" });

export default function ProfilePage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [account, setAccount] = useState<CustomerAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activationKey, setActivationKey] = useState("");
  const [activating, setActivating] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try { setAccount(await getCustomerAccount()); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "تعذر تحميل الحساب"); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const activate = async (event: FormEvent) => {
    event.preventDefault();
    if (!activationKey.trim() || activating) return;
    setActivating(true);
    try {
      const result = await redeemActivationKey(activationKey);
      setActivationKey("");
      toast.success(`تم تفعيل ${result.displayName} وإضافة ${number.format(result.creditsGranted)} كريدت.`);
      await load();
    } catch (activationError) { toast.error(activationError instanceof Error ? activationError.message : "تعذر تفعيل الاشتراك"); }
    finally { setActivating(false); }
  };

  const active = account?.subscription?.state === "ACTIVE" && new Date(account.subscription.currentPeriodEnd).getTime() > Date.now();
  return <main className="min-h-screen bg-[#08090b] text-white" dir="rtl" lang="ar">
    <header className="border-b border-white/10 bg-[#0b0d10]/90 backdrop-blur-xl"><div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4 sm:px-8"><Link to="/projects" className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500"><Sparkles className="h-5 w-5" /></span><span><span className="block text-sm font-extrabold tracking-wide">FUSIONLAB</span><span className="block text-xs text-white/45">حسابك واشتراكك</span></span></Link><div className="flex items-center gap-2"><Button variant="ghost" onClick={() => navigate("/projects")}><ArrowRight className="h-4 w-4" />المشاريع</Button><Button variant="ghost" size="icon" aria-label="تسجيل الخروج" onClick={() => void signOut()}><LogOut className="h-4 w-4" /></Button></div></div></header>
    <div className="mx-auto max-w-5xl space-y-6 px-5 py-10 sm:px-8">
      <section><p className="text-xs font-bold uppercase tracking-[.2em] text-violet-300">Profile</p><h1 className="mt-2 text-3xl font-extrabold">الحساب والاشتراك</h1><p className="mt-2 text-sm text-white/50">{user?.email}</p></section>
      {loading ? <div className="grid min-h-64 place-items-center rounded-2xl border border-white/10 bg-white/[.025]"><Loader2 className="h-7 w-7 animate-spin text-violet-300" /></div> : error ? <div className="grid min-h-64 place-items-center rounded-2xl border border-rose-300/15 bg-rose-300/[.025] p-6 text-center"><div><p className="font-bold">تعذر تحميل الحساب</p><p className="mt-2 text-sm text-white/50">{error}</p><Button variant="outline" className="mt-5" onClick={() => void load()}><RefreshCw className="h-4 w-4" />إعادة المحاولة</Button></div></div> : <>
        <div className="grid gap-4 sm:grid-cols-3"><article className="rounded-2xl border border-white/10 bg-[#12161b] p-5"><div className="flex items-center justify-between text-white/50"><span className="text-xs font-bold">الرصيد المتاح</span><WalletCards className="h-4 w-4 text-violet-300" /></div><p className="mt-5 text-3xl font-extrabold">{number.format(account?.wallet?.availableCredits ?? 0)}</p><p className="mt-1 text-xs text-white/40">{number.format(account?.wallet?.heldCredits ?? 0)} محجوز · {number.format(account?.wallet?.spentCredits ?? 0)} مستخدم</p></article><article className="rounded-2xl border border-white/10 bg-[#12161b] p-5"><div className="flex items-center justify-between text-white/50"><span className="text-xs font-bold">الخطة الحالية</span><CalendarDays className="h-4 w-4 text-violet-300" /></div><p className="mt-5 text-2xl font-extrabold">{account?.subscription?.displayName ?? "بدون اشتراك"}</p><p className="mt-1 text-xs text-white/40">{account?.subscription ? (account.subscription.interval === "MONTH" ? "اشتراك شهري" : "اشتراك سنوي") : "فعّل مفتاح اشتراك للبدء"}</p></article><article className="rounded-2xl border border-white/10 bg-[#12161b] p-5"><div className="flex items-center justify-between text-white/50"><span className="text-xs font-bold">حالة الاشتراك</span><ShieldCheck className="h-4 w-4 text-violet-300" /></div><p className={`mt-5 text-2xl font-extrabold ${active ? "text-emerald-300" : "text-white"}`}>{active ? "فعّال" : "غير فعّال"}</p><p className="mt-1 text-xs text-white/40">{active && account?.subscription ? `حتى ${date.format(new Date(account.subscription.currentPeriodEnd))}` : "لا توجد فترة اشتراك فعالة"}</p></article></div>
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#12161b]"><header className="border-b border-white/10 p-5"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/15 text-violet-300"><KeyRound className="h-5 w-5" /></span><div><h2 className="font-extrabold">تفعيل مفتاح الاشتراك</h2><p className="mt-1 text-xs leading-5 text-white/45">ألصق المفتاح الذي استلمته من FusionLab. المفتاح صالح لحساب واحد ويُستخدم مرة واحدة.</p></div></div></header><div className="p-5">{active ? <div className="flex gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[.055] p-4"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" /><div><p className="font-bold text-emerald-200">لديك اشتراك فعال الآن</p><p className="mt-1 text-sm leading-6 text-white/50">لحماية رصيدك، لا يمكن استبدال الاشتراك النشط بمفتاح آخر. استخدم المفتاح الجديد بعد انتهاء الفترة الحالية.</p></div></div> : <form onSubmit={activate} className="space-y-4"><label className="block text-xs font-bold text-white/65">مفتاح التفعيل<Input value={activationKey} onChange={(event) => setActivationKey(event.target.value)} required minLength={50} autoComplete="off" spellCheck={false} dir="ltr" placeholder="FLK-..." className="mt-2 h-12 rounded-xl border-white/10 bg-[#080a0d] font-mono text-sm" /></label><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center"><p className="text-xs leading-5 text-white/40">لن يُخصم أو يُمنح أي كريدت إذا كان المفتاح غير صالح أو منتهيًا.</p><Button type="submit" disabled={activating || !activationKey.trim()} className="h-11 rounded-xl px-6">{activating ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}تفعيل الاشتراك</Button></div></form>}</div></section>
      </>}
    </div>
  </main>;
}
