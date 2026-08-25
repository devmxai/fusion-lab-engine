# FL-UI-FUX-TERM-000 — Terminology Map

> **Status:** Frozen for implementation  
> **Date:** 2026-08-24

| المعنى | English UI | Arabic UI | المسموح داخلياً | الممنوع للمستخدم |
|---|---|---|---|---|
| العرض البسيط | `Standard` | `Standard` | `STANDARD` | Standard Mode Pro |
| العرض البياني | `Space` | `Space` | `PROFESSIONAL` مؤقتاً | Professional، Professional Graph |
| المشروع | `Project Studio` | `استوديو المشروع` | CreativeSpaceProject | تسمية المشروع Space |
| مصدر النماذج | `Published offers` | `العروض المنشورة` | PublishedOffer | All models، static catalog |
| إنشاء صورة | `Create image` | `إنشاء صورة` | `image.create` | Raw recipe/provider route |
| تعديل صورة | `Edit image` | `تعديل صورة` | `image.edit` | Raw capability payload |
| التكلفة النهائية | `Final quote` | `السعر النهائي` | confirmed quote | معادلات المزود أو route IDs |
| النتيجة | `Result` | `النتيجة` | output asset | Provider task ID |

## قواعد إلزامية

- أسماء النماذج والمزودات و`Standard` و`Space` تبقى أسماء رسمية؛ بقية الجملة تتبع Locale واحدة.
- يمنع وضع العربية والإنجليزية داخل الجملة نفسها إلا الاسم الرسمي أو قيمة تقنية معزولة بصرياً.
- الرسائل المرئية لا تعرض `PROFESSIONAL` أو `Professional` حتى عند قراءة مشروع قديم.
- أي مصطلح جديد يضاف هنا قبل استعماله في أكثر من سطح UI.
