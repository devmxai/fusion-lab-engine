import type { UiFuxLocale } from "./product-decisions";

export type ImageTerminalStateFact = Readonly<{
  state: "PROVIDER_FAILED" | "DELIVERY_FAILED" | "RECONCILIATION_REQUIRED";
  customerChargedCredits: number | null;
}>;

/** Customer copy for terminal Engine facts. Financial words are derived only
 * from the persisted operation view; this client never assumes a refund. */
export function imageTerminalStateCopy(operation: ImageTerminalStateFact, locale: UiFuxLocale): { title: string; detail: string } {
  const chargeText = operation.customerChargedCredits === null
    ? (locale === "en" ? "Final customer charge has not been proven yet." : "الخصم النهائي للعميل لم يتم إثباته بعد.")
    : (locale === "en" ? `Recorded final customer charge: ${operation.customerChargedCredits} credits.` : `الخصم النهائي المسجل للعميل: ${operation.customerChargedCredits} كريدت.`);
  if (operation.state === "PROVIDER_FAILED") {
    return locale === "en"
      ? { title: "Provider generation failed", detail: `No result was delivered. ${chargeText} Review the operation history before taking any action.` }
      : { title: "فشل التوليد لدى المزود", detail: `لم يتم تسليم نتيجة. ${chargeText} راجع سجل العملية قبل اتخاذ أي إجراء.` };
  }
  if (operation.state === "DELIVERY_FAILED") {
    return locale === "en"
      ? { title: "Result delivery needs review", detail: `The provider result could not be delivered privately. ${chargeText} A new generation was not created.` }
      : { title: "تسليم النتيجة يحتاج مراجعة", detail: `تعذر تسليم نتيجة المزود بشكل خاص. ${chargeText} لم يتم إنشاء توليد جديد.` };
  }
  return locale === "en"
    ? { title: "Financial reconciliation required", detail: `The operation needs financial reconciliation. ${chargeText} Do not retry or assume a refund.` }
    : { title: "مطلوبة تسوية مالية", detail: `تحتاج العملية إلى تسوية مالية. ${chargeText} لا تعِد المحاولة ولا تفترض وجود استرداد.` };
}
