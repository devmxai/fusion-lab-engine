import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ImageIcon } from "lucide-react";

interface StoryboardPromptEditorProps {
  value: string;
  onChange: (value: string) => void;
  images: { preview: string }[];
  placeholder?: string;
  className?: string;
  dir?: string;
  rows?: number;
  disabled?: boolean;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

export interface StoryboardPromptEditorRef {
  focus: () => void;
  element: HTMLDivElement | null;
}

/**
 * Inline prompt editor for reference-guided video generation.
 * Renders @imageN tokens as styled purple chips while keeping
 * the underlying value as plain text. Always LTR for provider compatibility.
 */
const StoryboardPromptEditor = forwardRef<StoryboardPromptEditorRef, StoryboardPromptEditorProps>(
  ({ value, onChange, images, placeholder, className, rows = 3, disabled, onKeyDown }, ref) => {
    const editorRef = useRef<HTMLDivElement>(null);
    const isComposing = useRef(false);
    const ignoreNextInput = useRef(false);

    // Mention popover state
    const [mentionOpen, setMentionOpen] = useState(false);
    const [mentionFilter, setMentionFilter] = useState("");
    const [mentionAnchorRange, setMentionAnchorRange] = useState<Range | null>(null);
    const popoverRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => editorRef.current?.focus(),
      element: editorRef.current,
    }));

    // Convert plain text with @imageN tokens to HTML with chips
    const textToHtml = useCallback((text: string): string => {
      if (!text) return "";

      const escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      const withChips = escaped.replace(/@image(\d+)/g, (_match, num) => {
        const idx = parseInt(num) - 1;
        const hasImage = idx >= 0 && idx < images.length;
        const thumbUrl = hasImage ? images[idx].preview : "";
        const chipColor = hasImage
          ? "background:hsl(var(--primary)/0.15);color:hsl(var(--primary));border:1px solid hsl(var(--primary)/0.3)"
          : "background:hsl(var(--destructive)/0.15);color:hsl(var(--destructive));border:1px solid hsl(var(--destructive)/0.3)";

        return `<span contenteditable="false" data-image-tag="${num}" dir="ltr" style="display:inline-flex;align-items:center;gap:3px;${chipColor};border-radius:6px;padding:1px 6px 1px 3px;font-size:11px;font-weight:700;font-family:monospace;vertical-align:baseline;user-select:all;white-space:nowrap;margin:0 2px;line-height:1.6">${thumbUrl ? `<img src="${thumbUrl}" style="width:14px;height:14px;border-radius:3px;object-fit:cover" />` : ""}@image${num}</span>`;
      });

      return withChips.replace(/\n/g, "<br>");
    }, [images]);

    // Extract plain text from the editor DOM
    const extractText = useCallback((): string => {
      const el = editorRef.current;
      if (!el) return "";

      let result = "";
      const walk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          result += node.textContent || "";
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const element = node as HTMLElement;
          const tag = element.getAttribute("data-image-tag");
          if (tag) {
            result += `@image${tag}`;
            return;
          }
          if (element.tagName === "BR") {
            result += "\n";
            return;
          }
          if (element.tagName === "DIV" && element !== el) {
            if (result.length > 0 && !result.endsWith("\n")) {
              result += "\n";
            }
          }
          element.childNodes.forEach(walk);
        }
      };
      el.childNodes.forEach(walk);

      return result.replace(/\n$/, "");
    }, []);

    // Save and restore cursor position
    const saveCursor = useCallback((): number => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || !editorRef.current) return 0;
      const range = sel.getRangeAt(0);
      const preRange = document.createRange();
      preRange.selectNodeContents(editorRef.current);
      preRange.setEnd(range.startContainer, range.startOffset);
      const tempDiv = document.createElement("div");
      tempDiv.appendChild(preRange.cloneContents());
      let count = 0;
      const countWalk = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          count += (node.textContent || "").length;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          const tag = el.getAttribute("data-image-tag");
          if (tag) {
            count += `@image${tag}`.length;
            return;
          }
          if (el.tagName === "BR") { count += 1; return; }
          if (el.tagName === "DIV") { count += 1; }
          el.childNodes.forEach(countWalk);
        }
      };
      tempDiv.childNodes.forEach(countWalk);
      return count;
    }, []);

    const restoreCursor = useCallback((offset: number) => {
      const el = editorRef.current;
      if (!el) return;
      const sel = window.getSelection();
      if (!sel) return;

      let remaining = offset;
      let targetNode: Node | null = null;
      let targetOffset = 0;
      let found = false;

      const walk = (node: Node): boolean => {
        if (found) return true;
        if (node.nodeType === Node.TEXT_NODE) {
          const len = (node.textContent || "").length;
          if (remaining <= len) {
            targetNode = node;
            targetOffset = remaining;
            found = true;
            return true;
          }
          remaining -= len;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const elem = node as HTMLElement;
          const tag = elem.getAttribute("data-image-tag");
          if (tag) {
            const tagLen = `@image${tag}`.length;
            if (remaining <= tagLen) {
              targetNode = elem.parentNode;
              targetOffset = Array.from(elem.parentNode!.childNodes).indexOf(elem as ChildNode) + 1;
              found = true;
              return true;
            }
            remaining -= tagLen;
            return false;
          }
          if (elem.tagName === "BR") {
            if (remaining <= 1) {
              targetNode = elem.parentNode;
              targetOffset = Array.from(elem.parentNode!.childNodes).indexOf(elem as ChildNode) + 1;
              found = true;
              return true;
            }
            remaining -= 1;
            return false;
          }
          if (elem.tagName === "DIV" && elem !== el) {
            if (remaining > 0) { remaining -= 1; }
          }
          for (const child of Array.from(elem.childNodes)) {
            if (walk(child)) return true;
          }
        }
        return false;
      };

      for (const child of Array.from(el.childNodes)) {
        if (walk(child)) break;
      }

      if (targetNode) {
        try {
          const range = document.createRange();
          range.setStart(targetNode, targetOffset);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
        } catch {
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    }, []);

    // Sync HTML when value or images change externally
    useEffect(() => {
      const el = editorRef.current;
      if (!el) return;
      if (document.activeElement === el && !ignoreNextInput.current) return;
      ignoreNextInput.current = false;
      const html = textToHtml(value);
      if (el.innerHTML !== html) {
        el.innerHTML = html;
      }
    }, [value, textToHtml]);

    // Force re-render chips when images list changes
    useEffect(() => {
      const el = editorRef.current;
      if (!el) return;
      const cursorPos = document.activeElement === el ? saveCursor() : -1;
      el.innerHTML = textToHtml(value);
      if (cursorPos >= 0) {
        restoreCursor(cursorPos);
      }
    }, [images.length]);

    // Handle input
    const handleInput = useCallback(() => {
      if (isComposing.current) return;
      const text = extractText();
      onChange(text);
      checkMention();
    }, [extractText, onChange]);

    // Check for @ mention
    const checkMention = useCallback(() => {
      if (images.length === 0) { setMentionOpen(false); return; }

      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) { setMentionOpen(false); return; }

      const range = sel.getRangeAt(0);
      if (!range.collapsed) { setMentionOpen(false); return; }

      const node = range.startContainer;
      if (node.nodeType !== Node.TEXT_NODE) { setMentionOpen(false); return; }

      const textBefore = (node.textContent || "").slice(0, range.startOffset);

      let atIdx = -1;
      for (let i = textBefore.length - 1; i >= 0; i--) {
        if (textBefore[i] === "@") { atIdx = i; break; }
        if (textBefore[i] === " " || textBefore[i] === "\n") break;
      }

      if (atIdx >= 0) {
        const fragment = textBefore.slice(atIdx + 1).toLowerCase();
        if (fragment === "" || /^i(m(a(g(e\d*)?)?)?)?$/.test(fragment) || /^\d+$/.test(fragment) || /^image\d*$/.test(fragment)) {
          setMentionFilter(fragment);

          const mentionRange = document.createRange();
          mentionRange.setStart(node, atIdx);
          mentionRange.setEnd(node, range.startOffset);
          setMentionAnchorRange(mentionRange);
          setMentionOpen(true);
          return;
        }
      }
      setMentionOpen(false);
    }, [images.length]);

    // Handle mention selection — insert chip INLINE at cursor
    const handleMentionSelect = useCallback((idx: number) => {
      const el = editorRef.current;
      if (!el || !mentionAnchorRange) return;

      const tag = `@image${idx + 1}`;
      const sel = window.getSelection();
      if (!sel) return;

      // Delete the @... text the user typed
      mentionAnchorRange.deleteContents();

      // Insert chip HTML then a normal ASCII space after
      const chipHtml = textToHtml(tag);
      const tempContainer = document.createElement("span");
      tempContainer.innerHTML = chipHtml + " ";

      const frag = document.createDocumentFragment();
      let lastInserted: Node | null = null;
      while (tempContainer.firstChild) {
        lastInserted = tempContainer.firstChild;
        frag.appendChild(lastInserted);
      }
      mentionAnchorRange.insertNode(frag);

      // Place cursor after the space
      if (lastInserted) {
        const newRange = document.createRange();
        newRange.setStartAfter(lastInserted);
        newRange.collapse(true);
        sel.removeAllRanges();
        sel.addRange(newRange);
      }

      setMentionOpen(false);

      const newText = extractText();
      onChange(newText);
      el.focus();
    }, [mentionAnchorRange, textToHtml, extractText, onChange]);

    // Close mention on outside click
    useEffect(() => {
      if (!mentionOpen) return;
      const handler = (e: MouseEvent) => {
        if (popoverRef.current && !popoverRef.current.contains(e.target as Node) && editorRef.current !== e.target) {
          setMentionOpen(false);
        }
      };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, [mentionOpen]);

    // Keyboard nav in mention popover
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
      if (mentionOpen && e.key === "Escape") {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
      onKeyDown?.(e);
    }, [mentionOpen, onKeyDown]);

    // Filter images for mention
    const filteredImages = images.map((img, i) => ({ img, idx: i })).filter(({ idx }) => {
      if (!mentionFilter) return true;
      const label = `image${idx + 1}`;
      const num = `${idx + 1}`;
      return label.startsWith(mentionFilter.toLowerCase()) || num === mentionFilter;
    });

    const minH = rows === 3 ? "80px" : "40px";
    const maxH = rows === 3 ? "140px" : "80px";

    return (
      <div className="relative">
        {/* Mention Popover */}
        <AnimatePresence>
          {mentionOpen && images.length > 0 && filteredImages.length > 0 && (
            <motion.div
              ref={popoverRef}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-full mb-2 left-0 z-[100] w-56 rounded-xl border border-border/40 bg-card shadow-xl overflow-hidden"
              dir="ltr"
            >
              <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground border-b border-border/20">
                Select a reference image
              </div>
              <div className="max-h-48 overflow-y-auto py-1">
                {filteredImages.map(({ img, idx }) => (
                  <button
                    key={idx}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleMentionSelect(idx);
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-primary/10 transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-lg overflow-hidden border border-border/30 shrink-0">
                      <img src={img.preview} alt="" className="w-full h-full object-cover" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-xs font-bold text-primary font-mono">@image{idx + 1}</span>
                    </div>
                    <ImageIcon className="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Editor — always LTR for provider token compatibility */}
        <div
          ref={editorRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          dir="ltr"
          role="textbox"
          aria-multiline="true"
          data-placeholder={placeholder}
          onInput={handleInput}
          onCompositionStart={() => { isComposing.current = true; }}
          onCompositionEnd={() => { isComposing.current = false; handleInput(); }}
          onClick={() => checkMention()}
          onKeyUp={() => checkMention()}
          onKeyDown={handleKeyDown}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData("text/plain");
            document.execCommand("insertText", false, text);
          }}
          className={`w-full overflow-y-auto rounded-xl bg-secondary/30 border border-border/30 px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 ring-offset-background whitespace-pre-wrap break-words empty:before:content-[attr(data-placeholder)] empty:before:text-muted-foreground/50 empty:before:pointer-events-none ${className || ""}`}
          style={{
            minHeight: minH,
            maxHeight: maxH,
            lineHeight: "1.7",
            textAlign: "left",
          }}
        />
      </div>
    );
  }
);

StoryboardPromptEditor.displayName = "StoryboardPromptEditor";
export default StoryboardPromptEditor;
