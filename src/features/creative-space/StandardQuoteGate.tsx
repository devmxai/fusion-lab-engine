import { Loader2, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import type { ConfirmedImageQuote, ImageQuote } from "./image-quote-client";
import { standardCopy } from "./standard-i18n";
import type { UiFuxLocale } from "./product-decisions";

type Props = Readonly<{
  locale: UiFuxLocale;
  canQuote: boolean;
  requestQuote: () => Promise<ImageQuote>;
  confirmQuote: (quote: ImageQuote, idempotencyKey: string) => Promise<ConfirmedImageQuote>;
  onReserved: (confirmed: ConfirmedImageQuote) => void;
  formatError?: (error: unknown) => string;
}>;

/**
 * Customer-facing one-click action. The quote/hold sequence remains enforced
 * by the server: this component only chains quote -> one idempotent
 * confirmation after the exact immutable configuration and price are known.
 */
export function StandardQuoteGate({ locale, canQuote, requestQuote, confirmQuote, onReserved, formatError }: Props) {
  const text = standardCopy(locale);
  const [busy, setBusy] = useState<"QUOTE" | "CONFIRM" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reservedCredits, setReservedCredits] = useState<number | null>(null);
  const [started, setStarted] = useState(false);
  const confirmedQuoteIds = useRef(new Set<string>());

  const generate = async () => {
    if (!canQuote || busy || started) return;
    setError(null);
    setReservedCredits(null);
    setBusy("QUOTE");
    try {
      const quote = await requestQuote();
      if (new Date(quote.expiresAt).getTime() <= Date.now()) {
        throw new Error(locale === "en" ? "The price changed before generation could start. Try again." : "تغير السعر قبل بدء التوليد. حاول مرة أخرى.");
      }
      if (confirmedQuoteIds.current.has(quote.id)) return;
      setBusy("CONFIRM");
      const confirmed = await confirmQuote(quote, crypto.randomUUID());
      confirmedQuoteIds.current.add(quote.id);
      setReservedCredits(quote.customerCredits);
      setStarted(true);
      onReserved(confirmed);
    } catch (reason) {
      setError(formatError?.(reason) ?? (reason instanceof Error ? reason.message : "Generation could not be started."));
    } finally {
      setBusy(null);
    }
  };

  const pendingLabel = busy === "QUOTE"
    ? (locale === "en" ? "Checking price…" : "جارٍ التحقق من السعر…")
    : (locale === "en" ? "Starting generation…" : "جارٍ بدء التوليد…");

  return <section className="standard-panel-section">
    {reservedCredits !== null && <p className="mb-2 text-center text-xs text-emerald-200/80">{locale === "en" ? `${reservedCredits} credits reserved securely.` : `تم حجز ${reservedCredits} كريدت بأمان.`}</p>}
    {error && <p role="alert" className="mb-2 rounded-lg border border-red-300/25 bg-red-300/[0.06] px-3 py-2 text-xs text-red-100">{error}</p>}
    <button type="button" onClick={() => void generate()} disabled={!canQuote || busy !== null || started} className="standard-primary-action flex w-full items-center justify-center gap-2 px-3 py-2.5">
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      {busy ? pendingLabel : started ? (locale === "en" ? "Generation started" : "بدأ التوليد") : text.generate}
    </button>
    <p className="mt-2 text-center text-[11px] text-white/42">{locale === "en" ? "The final credit amount is verified before the provider receives a request." : "يتم التحقق من الكريدت النهائي قبل إرسال الطلب إلى المزود."}</p>
  </section>;
}
