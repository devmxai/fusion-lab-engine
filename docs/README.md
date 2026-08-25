# FusionLab Documentation Authority

المرجع التنفيذي الوحيد للمنصة هو:

- [Professional Master Plan: Platform with Engine](./PROFESSIONAL_MASTER_PLAN_PLATFORM_WITH_ENGINE_AR.md) — Document ID `FL-PMP-001`.
- [Execution artifacts](./execution/README.md) — أدلة وقرارات البوابات التي تنفذ `FL-PMP-001` ولا تستبدلها.
- [Provider Control Plane and Real Integration Plan](./execution/PROVIDER_CONTROL_PLANE_REAL_INTEGRATION_PLAN_AR.md) — Document ID `FL-PCP-002` وخطة التنفيذ الحالية لمسار Admin والمزودات والكتالوج والتسعير وCreative Space.

`TRANSFER_BASELINE.md` سجل تاريخي لحالة نقل المستودع فقط، وليس خطة تنفيذ أو مصدر قرارات.

## قواعد الحوكمة

- لا يُضاف Master Plan ثانٍ.
- ADRs وRunbooks وTickets تنفذ `FL-PMP-001` ولا تتغلب عليها.
- أي تغيير معياري يحدث عبر PR يحدّث Version وChangelog داخل الخطة.
- Git history يحفظ الخطط والمسودات المحذوفة للتدقيق فقط؛ لا يجوز تنفيذها.
- يمنع إعادة قواعد الكريديت ×1000 أو أي Migration Guide يعيد السلوك الأمني القديم.
