# حد هوية المستخدم للمحرك

| Field | Value |
|---|---|
| Status | `LOCAL CONTRACT IMPLEMENTED / IDP INTEGRATION PENDING` |
| Provider calls | `NONE` |
| Deploy / production credentials | `NONE` |

## ما أُغلق

- مسارات V2 تتعامل مع `ownerId` صادر عن `EngineUserSessionAuthority`، لا مع قيمة يرسلها المتصفح.
- Bearer token لا يمثل هوية بمفرده؛ يلزم `ExternalUserIdentityVerifier` يؤكد صحة الرمز ويعيد subject فقط.
- جلسة `local-user` الموقعة بقيت محصورة في Local development ولا تختلط بمسار IdP.
- كل عمليات Quote وOperation وAsset وProject تستخدم نفس owner resolved من طبقة الهوية.

## ما لم يُدّعَ

- لا يوجد Supabase JWKS verifier أو Google/Supabase exchange مفعل، ولا اتصال خارجي أو secret أو نشر.
- قبل تفعيل IDP حقيقي يجب إضافة verifier موثق، mapping ثابت للـsubject، فحص issuer/audience/expiry، واختبارات رفض الرموز المزورة وrotation.
