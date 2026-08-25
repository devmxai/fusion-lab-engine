import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ImageIcon } from "lucide-react";

interface ImageMentionPopoverProps {
  images: { preview: string }[];
  prompt: string;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  onInsert: (tag: string, cursorPos: number) => void;
}

/**
 * Detects "@" typed in the textarea and shows a popover with available
 * reference images to pick from — like WhatsApp @mention.
 */
export default function ImageMentionPopover({ images, prompt, textareaRef, onInsert }: ImageMentionPopoverProps) {
  const [open, setOpen] = useState(false);
  const [mentionStart, setMentionStart] = useState(-1);
  const [filter, setFilter] = useState("");
  const popoverRef = useRef<HTMLDivElement>(null);

  // Listen for "@" in the textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta || images.length === 0) { setOpen(false); return; }

    const handleInput = () => {
      const pos = ta.selectionStart ?? 0;
      const text = ta.value;

      // Walk back from cursor to find "@"
      let atIdx = -1;
      for (let i = pos - 1; i >= 0; i--) {
        const ch = text[i];
        if (ch === "@") { atIdx = i; break; }
        if (ch === " " || ch === "\n") break;
      }

      if (atIdx >= 0) {
        const fragment = text.slice(atIdx + 1, pos).toLowerCase();
        // Only keep open if fragment looks like partial "image" or a number
        if (fragment === "" || /^i(m(a(g(e\d*)?)?)?)?$/.test(fragment) || /^\d+$/.test(fragment) || /^image\d*$/.test(fragment)) {
          setMentionStart(atIdx);
          setFilter(fragment);
          setOpen(true);
          return;
        }
      }
      setOpen(false);
    };

    ta.addEventListener("input", handleInput);
    ta.addEventListener("click", handleInput);
    ta.addEventListener("keyup", handleInput);
    return () => {
      ta.removeEventListener("input", handleInput);
      ta.removeEventListener("click", handleInput);
      ta.removeEventListener("keyup", handleInput);
    };
  }, [textareaRef, images.length, prompt]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node) && textareaRef.current !== e.target) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, textareaRef]);

  const handleSelect = (idx: number) => {
    const tag = `@image${idx + 1} `;
    const ta = textareaRef.current;
    if (!ta) return;

    const cursorPos = ta.selectionStart ?? 0;
    const before = prompt.slice(0, mentionStart);
    const after = prompt.slice(cursorPos);

    // If not at the start of a clean line, prepend newline
    const needsNewline = before.length > 0 && !before.endsWith('\n');
    const prefix = needsNewline ? '\n' : '';

    const newPrompt = before + prefix + tag + after;
    const newCursor = mentionStart + prefix.length + tag.length;
    onInsert(newPrompt, newCursor);
    setOpen(false);

    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(newCursor, newCursor);
    });
  };

  // Filter images based on typed fragment
  const filteredImages = images.map((img, i) => ({ img, idx: i })).filter(({ idx }) => {
    if (!filter) return true;
    const label = `image${idx + 1}`;
    const num = `${idx + 1}`;
    return label.startsWith(filter.toLowerCase()) || num === filter;
  });

  if (!open || images.length === 0 || filteredImages.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        ref={popoverRef}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.15 }}
        className="absolute bottom-full mb-2 right-0 z-[100] w-56 rounded-xl border border-border/40 bg-card shadow-xl overflow-hidden"
        dir="ltr"
      >
        <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground border-b border-border/20">
          Pick an image to reference
        </div>
        <div className="max-h-48 overflow-y-auto py-1">
          {filteredImages.map(({ img, idx }) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSelect(idx)}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-primary/10 transition-colors text-right"
            >
              <div className="w-8 h-8 rounded-lg overflow-hidden border border-border/30 shrink-0">
                <img src={img.preview} alt="" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-bold text-primary font-mono">@image{idx + 1}</span>
                <span className="text-[10px] text-muted-foreground mr-2">Image {idx + 1}</span>
              </div>
              <ImageIcon className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
            </button>
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
