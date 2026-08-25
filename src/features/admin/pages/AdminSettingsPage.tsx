import { BellRing, CheckCircle2, Globe2, LockKeyhole, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { AdminPageHeader, AdminSection } from "../components/AdminUi";

const settings = [
  { icon: Globe2, title: "Localization", description: "English is the active Admin interface. Arabic will be a separate RTL locale after the English UI is stable." },
  { icon: BellRing, title: "Alerts", description: "Alert policies will appear after server-owned notification contracts are available." },
];

type MfaState = {
  loading: boolean;
  currentLevel: string | null;
  factorId: string | null;
  error: string | null;
};

type Enrollment = { factorId: string; qrCodeUrl: string };

function qrCodeUrl(value: string): string {
  return value.startsWith("data:")
    ? value
    : `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(value)}`;
}

function MfaCodeForm({ code, setCode, verify, busy }: { code: string; setCode: (value: string) => void; verify: () => Promise<void>; busy: boolean }) {
  return (
    <div className="mt-4 flex max-w-sm gap-2">
      <Input
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="Six-digit authenticator code"
        placeholder="000000"
        maxLength={6}
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
        className="border-white/[0.12] bg-black/30 text-white"
      />
      <Button type="button" onClick={() => void verify()} disabled={busy || code.length !== 6} className="bg-white text-black hover:bg-slate-200">
        {busy ? "Verifying..." : "Verify"}
      </Button>
    </div>
  );
}

function AdminMfaCard() {
  const { user } = useAuth();
  const [mfa, setMfa] = useState<MfaState>({ loading: true, currentLevel: null, factorId: null, error: null });
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setMfa({ loading: false, currentLevel: null, factorId: null, error: null });
      return;
    }

    const [factors, assurance] = await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ]);
    const error = factors.error ?? assurance.error;
    setMfa({
      loading: false,
      currentLevel: assurance.data?.currentLevel ?? null,
      factorId: factors.data?.totp[0]?.id ?? null,
      error: error?.message ?? null,
    });
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enroll = async () => {
    setBusy(true);
    setMfa((current) => ({ ...current, error: null }));
    const result = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "FusionLab Admin" });
    setBusy(false);
    if (result.error) {
      setMfa((current) => ({ ...current, error: result.error.message }));
      return;
    }
    setEnrollment({ factorId: result.data.id, qrCodeUrl: qrCodeUrl(result.data.totp.qr_code) });
  };

  const verify = async () => {
    const factorId = enrollment?.factorId ?? mfa.factorId;
    const normalizedCode = code.replace(/\s/g, "");
    if (!factorId || !/^\d{6}$/.test(normalizedCode)) {
      setMfa((current) => ({ ...current, error: "Enter the 6-digit code from your authenticator app." }));
      return;
    }

    setBusy(true);
    setMfa((current) => ({ ...current, error: null }));
    const result = await supabase.auth.mfa.challengeAndVerify({ factorId, code: normalizedCode });
    setBusy(false);
    if (result.error) {
      setMfa((current) => ({ ...current, error: result.error.message }));
      return;
    }
    setCode("");
    setEnrollment(null);
    await refresh();
  };

  const protectedSession = mfa.currentLevel === "aal2";

  return (
    <article className="rounded-lg border border-white/[0.08] bg-[#0b0d10] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-violet-300"><ShieldCheck className="h-5 w-5" /><span className="text-xs font-semibold uppercase tracking-[0.12em]">Admin security</span></div>
          <h2 className="mt-4 text-base font-semibold text-white">Multi-factor authentication</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-400">Authenticator MFA is optional hardening for the administrator account. Provider setup and catalog management no longer require it.</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${protectedSession ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" : "border-amber-400/25 bg-amber-400/10 text-amber-100"}`}>
          {mfa.loading ? "Checking..." : protectedSession ? "AAL2 protected" : "Optional"}
        </span>
      </div>

      {!user ? <p className="mt-5 text-sm text-amber-100">Sign in to configure administrator MFA.</p> : null}

      {user && !mfa.loading && !protectedSession ? (
        <div className="mt-5 border-t border-white/[0.08] pt-5">
          {!mfa.factorId && !enrollment ? (
            <Button type="button" onClick={() => void enroll()} disabled={busy} className="bg-white text-black hover:bg-slate-200">
              <LockKeyhole className="h-4 w-4" />{busy ? "Starting..." : "Set up authenticator"}
            </Button>
          ) : null}

          {enrollment ? (
            <div className="grid gap-5 md:grid-cols-[180px_1fr]">
              <div className="rounded-lg bg-white p-3"><img src={enrollment.qrCodeUrl} alt="FusionLab administrator authenticator QR code" className="h-full w-full" /></div>
              <div><h3 className="text-sm font-semibold text-white">Scan this QR code</h3><p className="mt-2 text-sm leading-6 text-slate-400">Use your authenticator app, then enter the current 6-digit code. The QR code stays in this browser and is never sent to the FusionLab API.</p><MfaCodeForm code={code} setCode={setCode} verify={verify} busy={busy} /></div>
            </div>
          ) : null}

          {mfa.factorId && !enrollment ? (
            <div className="max-w-md"><h3 className="text-sm font-semibold text-white">Confirm your authenticator</h3><p className="mt-2 text-sm leading-6 text-slate-400">A verified factor already exists. Enter its current code to elevate this session.</p><MfaCodeForm code={code} setCode={setCode} verify={verify} busy={busy} /></div>
          ) : null}
        </div>
      ) : null}

      {protectedSession ? <div className="mt-5 flex items-center gap-2 border-t border-white/[0.08] pt-5 text-sm text-emerald-200"><CheckCircle2 className="h-4 w-4" />This session can request protected Admin commands.</div> : null}
      {mfa.error ? <p role="alert" className="mt-4 rounded-lg border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">{mfa.error}</p> : null}
    </article>
  );
}

export default function AdminSettingsPage() {
  return (
    <div className="space-y-6">
      <AdminPageHeader eyebrow="SYSTEM" title="Settings" description="Security and platform configuration backed by real server contracts." />
      <AdminSection title="Administrator protection" description="This is a real Supabase Auth operation. It does not call an AI provider or consume generation credits."><div className="p-5"><AdminMfaCard /></div></AdminSection>
      <AdminSection title="Configuration readiness" description="Additional settings become available as their governed server contracts are released."><div className="grid gap-3 p-5 md:grid-cols-2">{settings.map(({ icon: Icon, title, description }) => <article key={title} className="rounded-lg border border-white/[0.08] bg-[#0b0d10] p-4"><Icon className="h-5 w-5 text-violet-300" /><h2 className="mt-5 text-sm font-semibold text-white">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-400">{description}</p><span className="mt-5 inline-flex rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] font-medium text-slate-400">Planned</span></article>)}</div></AdminSection>
    </div>
  );
}
