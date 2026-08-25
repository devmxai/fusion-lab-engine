# حد هوية وصلاحيات Admin

| Field | Value |
|---|---|
| Status | `LOCAL CONTRACT IMPLEMENTED / EXTERNAL IDP PENDING` |
| Scope | Admin BFF وControl Plane |
| External calls | `NONE` |
| Provider/model activation | `NONE` |

## الضمانات

- لا تثق المسارات برؤوس roles أو actor القادمة من المتصفح.
- Bearer token يمر أولاً عبر verifier؛ التوكن وحده لا يعيّن دورًا.
- بعد التحقق، يستخرج `AdminMembershipResolver` الأدوار من مصدر خادمي موثوق.
- لا تكفي هوية maker للنشر: يفرض Control Plane validator/simulator/approver مستقلين ثم publisher.
- جلسة `ADMIN_VIEWER` المحلية لا تملك صلاحيات كتابة ولا تتحول إلى maker/checker.

## قبل تفعيل الكتابة الفعلية

يلزم ربط verifier موثق لـSupabase/Google، ومخزن عضويات Server-side، وAAL2/MFA policy، ثم اختبارات JWT issuer/audience/expiry/rotation ورفض العضوية الملغاة. لا يوجد secret أو اتصال خارجي في هذه المرحلة.
