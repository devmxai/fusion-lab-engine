import { useMemo, useState } from "react";
import { ChevronDown, ImageIcon, Loader2, Settings2, Sparkles, WandSparkles } from "lucide-react";
import { evaluatePublishedOfferControls, reconcilePublishedOfferSettings, type PublishedSettingValue } from "./published-offers-client";
import { standardPrototypeImageOffer } from "./standard-prototype-fixture";
import { standardCopy } from "./standard-i18n";
import { StandardMediaTabs, StandardShell, type StandardMediaTab } from "./standard-shell";

type Locale = "en" | "ar";
const controlNames: Record<Locale, Record<string, string>> = {
  en: { "control.resolution": "Resolution", "control.aspectRatio": "Aspect ratio", "control.style": "Style", "control.detail": "Detail", "control.seed": "Seed" },
  ar: { "control.resolution": "الدقة", "control.aspectRatio": "نسبة الأبعاد", "control.style": "الأسلوب", "control.detail": "التفاصيل", "control.seed": "البذرة" },
};

export default function StandardPrototypePage() {
  const [locale, setLocale] = useState<Locale>("en");
  const [prompt, setPrompt] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mediaTab, setMediaTab] = useState<StandardMediaTab>("image");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [settings, setSettings] = useState<Record<string, PublishedSettingValue>>(() => reconcilePublishedOfferSettings(standardPrototypeImageOffer, "image.create") ?? {});
  const text = standardCopy(locale);
  const controls = useMemo(() => evaluatePublishedOfferControls(standardPrototypeImageOffer, "image.create", settings)
    .filter(({ visible }) => visible)
    .sort((left, right) => (left.control.ui?.order ?? 0) - (right.control.ui?.order ?? 0)), [settings]);
  const canGenerate = prompt.trim().length > 0 && !isGenerating;

  const generate = () => {
    if (!canGenerate) return;
    setIsGenerating(true);
    window.setTimeout(() => { setGenerated(true); setIsGenerating(false); }, 650);
  };
  const update = (id: string, value: PublishedSettingValue) => setSettings((current) => ({ ...current, [id]: value }));
  const renderControl = (entry: typeof controls[number]) => {
    const { control, value } = entry;
    const label = controlNames[locale][control.ui?.labelKey ?? control.id] ?? control.id;
    return <label key={control.id} className="block text-sm font-medium text-white/85"><span className="mb-1.5 block">{label}</span>{control.kind === "enum" ? <select aria-label={label} value={String(value)} onChange={(event) => update(control.id, event.target.value)} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-violet-400">{control.values?.map((option) => <option key={String(option)} value={String(option)}>{String(option)}</option>)}</select> : <input aria-label={label} type="number" min={control.min} max={control.max} step={control.step} value={Number(value)} onChange={(event) => update(control.id, Number(event.target.value))} className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm outline-none focus:border-violet-400" />}</label>;
  };

  const composer = <div className="rounded-2xl border border-white/10 bg-[#121319]"><div className="border-b border-white/10 p-5"><div className="flex items-center gap-2 text-violet-300"><WandSparkles className="h-4 w-4" /><span className="text-xs font-bold tracking-[.16em] uppercase">{text.create}</span></div><h2 className="mt-2 text-xl font-bold">{text.create}</h2></div><div className="space-y-5 p-5"><StandardMediaTabs locale={locale} active={mediaTab} onChange={setMediaTab} enabled={["image"]} /><label className="block text-sm font-medium"><span className="mb-1.5 block">{text.model}</span><div className="flex items-center justify-between rounded-xl border border-white/10 bg-black/30 px-3 py-2.5"><span>{standardPrototypeImageOffer.displayName}</span><span className="text-xs text-white/45">KIE.ai</span></div></label><label className="block text-sm font-medium"><span className="mb-1.5 block">{text.prompt}</span><textarea aria-label={text.prompt} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={text.promptHint} className="min-h-28 w-full resize-none rounded-xl border border-white/10 bg-black/30 p-3 text-sm outline-none placeholder:text-white/35 focus:border-violet-400" /></label><section><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Settings2 className="h-4 w-4 text-violet-300" />{text.basic}</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">{controls.filter(({ control }) => control.ui?.group === "BASIC").map(renderControl)}</div></section><section className="border-t border-white/10 pt-4"><button type="button" onClick={() => setAdvancedOpen((open) => !open)} className="flex w-full items-center justify-between text-sm font-semibold"><span>{text.advanced}</span><ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} /></button>{advancedOpen && <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">{controls.filter(({ control }) => control.ui?.group === "ADVANCED").map(renderControl)}</div>}</section><section className="rounded-xl border border-white/10 bg-white/[0.025] p-3"><div className="flex items-center justify-between"><span className="text-sm font-semibold">{text.references}</span><button type="button" className="text-xs font-semibold text-violet-300">{text.addReference}</button></div><p className="mt-1 text-xs text-white/45">0 / {standardPrototypeImageOffer.capability.maxReferences}</p></section><section className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3"><div className="flex items-center justify-between text-sm"><span>{text.quote}</span><strong>6 {text.credits}</strong></div><p className="mt-1 text-xs text-emerald-200/70">{text.ready}</p></section><button type="button" onClick={generate} disabled={!canGenerate} className="flex w-full items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-black disabled:cursor-not-allowed disabled:opacity-40">{isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{isGenerating ? text.generating : text.generate}</button><p className="text-center text-xs text-white/40">{text.mock}</p></div></div>;
  return <StandardShell locale={locale} projectName={text.project} onLocaleChange={() => setLocale((current) => current === "en" ? "ar" : "en")} composer={composer}>
      <section className="rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_50%_35%,rgba(124,58,237,.25),transparent_34%),#101116] p-4 lg:min-h-[720px]">
        <div className="flex items-center justify-between"><div><p className="text-sm font-semibold">{text.history}</p><p className="mt-1 text-xs text-white/45">{text.mock}</p></div><span className="rounded-full border border-white/10 px-2.5 py-1 text-xs text-white/60">{generated ? text.result : text.output}</span></div>
        <div className="grid min-h-[560px] place-items-center"><div className="w-full max-w-xl rounded-3xl border border-dashed border-white/15 bg-black/15 p-8 text-center">{isGenerating ? <><Loader2 className="mx-auto h-9 w-9 animate-spin text-violet-300" /><h2 className="mt-4 text-lg font-semibold">{text.generating}</h2></> : generated ? <><div className="mx-auto grid aspect-square max-w-sm place-items-center rounded-2xl border border-violet-300/30 bg-[linear-gradient(145deg,#592b92,#15244e_45%,#e68b75)] shadow-2xl"><Sparkles className="h-12 w-12 text-white" /></div><h2 className="mt-4 text-lg font-semibold">{text.result}</h2><p className="mt-1 text-sm text-white/55">{prompt}</p></> : <><ImageIcon className="mx-auto h-9 w-9 text-white/45" /><h2 className="mt-4 text-lg font-semibold">{text.output}</h2><p className="mt-2 text-sm text-white/50">{text.ready}</p></>}</div></div>
      </section>
  </StandardShell>;
}
