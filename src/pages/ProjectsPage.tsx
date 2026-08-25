import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  Clock3,
  Copy,
  FolderOpen,
  ImageIcon,
  Loader2,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  UserRound,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import {
  createPersistedCreativeProject,
  executeCreativeProjectAction,
  listCreativeProjects,
  type CreativeProjectSummary,
} from "@/features/creative-space/project-client";

type ProjectTab = "ACTIVE" | "ARCHIVED" | "DELETED";
type ProjectDialog = {
  kind: "RENAME" | "DUPLICATE" | "DELETE";
  project: CreativeProjectSummary;
} | null;

const dateFormatter = new Intl.DateTimeFormat("ar-IQ", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default function ProjectsPage() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [projects, setProjects] = useState<CreativeProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [tab, setTab] = useState<ProjectTab>("ACTIVE");
  const [projectDialog, setProjectDialog] = useState<ProjectDialog>(null);
  const [commandTitle, setCommandTitle] = useState("");
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);

  const displayName = useMemo(
    () => user?.user_metadata?.full_name || user?.email || "مستخدم FusionLab",
    [user],
  );
  const visibleProjects = useMemo(
    () => projects.filter((project) => project.lifecycleState === tab),
    [projects, tab],
  );
  const counts = useMemo(
    () => ({
      ACTIVE: projects.filter((project) => project.lifecycleState === "ACTIVE")
        .length,
      ARCHIVED: projects.filter(
        (project) => project.lifecycleState === "ARCHIVED",
      ).length,
      DELETED: projects.filter(
        (project) => project.lifecycleState === "DELETED",
      ).length,
    }),
    [projects],
  );

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setProjects(await listCreativeProjects());
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "تعذر تحميل المشاريع";
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createProject = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || creating) return;
    setCreating(true);
    try {
      const project = await createPersistedCreativeProject(title);
      setCreateOpen(false);
      setTitle("");
      navigate(`/projects/${encodeURIComponent(project.projectId)}/standard`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "تعذر إنشاء المشروع",
      );
      setCreating(false);
    }
  };

  const openProjectDialog = (
    kind: NonNullable<ProjectDialog>["kind"],
    project: CreativeProjectSummary,
  ) => {
    setProjectDialog({ kind, project });
    setCommandTitle(
      kind === "RENAME"
        ? project.title
        : kind === "DUPLICATE"
          ? `${project.title} — نسخة`
          : "",
    );
  };

  const runProjectAction = async (
    project: CreativeProjectSummary,
    action: "ARCHIVE" | "RESTORE" | "DELETE" | "RENAME" | "DUPLICATE",
    actionTitle?: string,
  ) => {
    if (pendingProjectId) return;
    setPendingProjectId(project.projectId);
    try {
      await executeCreativeProjectAction(
        project,
        action === "RENAME"
          ? { action, title: actionTitle?.trim() ?? "" }
          : action === "DUPLICATE"
            ? {
                action,
                ...(actionTitle?.trim() ? { title: actionTitle.trim() } : {}),
              }
            : { action },
      );
      const messages = {
        ARCHIVE: "تمت أرشفة المشروع",
        RESTORE: "تمت استعادة المشروع",
        DELETE: "تم نقل المشروع إلى المحذوفات",
        RENAME: "تم تغيير اسم المشروع",
        DUPLICATE: "تم إنشاء نسخة مستقلة",
      } as const;
      toast.success(messages[action]);
      setProjectDialog(null);
      if (action === "DUPLICATE" || action === "RESTORE") setTab("ACTIVE");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "تعذر تنفيذ الإجراء",
      );
    } finally {
      setPendingProjectId(null);
    }
  };

  const submitProjectDialog = (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectDialog) return;
    void runProjectAction(
      projectDialog.project,
      projectDialog.kind,
      commandTitle,
    );
  };

  return (
    <main className="min-h-screen bg-[#08090b] text-white" dir="rtl" lang="ar">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#08090b]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500 text-white shadow-[0_0_28px_rgba(139,92,246,.28)]">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-extrabold tracking-wide">FUSIONLAB</p>
              <p className="text-xs text-white/45">Creative workspace</p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <div className="hidden min-w-0 text-left sm:block" dir="ltr">
              <p className="max-w-52 truncate text-xs font-semibold">
                {displayName}
              </p>
              <p className="text-[10px] text-white/40">Cloud workspace</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="الحساب والاشتراك"
              onClick={() => navigate("/profile")}
            >
              <UserRound className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="تسجيل الخروج"
              onClick={() => void signOut()}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-10 sm:px-8">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.24em] text-violet-300">
              Workspace
            </p>
            <h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">
              مشاريعك
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-7 text-white/55">
              كل مشروع مساحة مستقلة بملفاته وعملياته ونتائجه. إنشاء مشروع جديد
              لا يغيّر أي مشروع سابق.
            </p>
          </div>
          <Button
            className="h-11 gap-2 rounded-xl px-5"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" /> مشروع جديد
          </Button>
        </div>

        <div
          className="mt-8 inline-flex rounded-xl border border-white/10 bg-white/[.035] p-1"
          role="tablist"
          aria-label="حالة المشاريع"
        >
          {(
            [
              ["ACTIVE", "المشاريع", counts.ACTIVE],
              ["ARCHIVED", "الأرشيف", counts.ARCHIVED],
              ["DELETED", "المحذوفات", counts.DELETED],
            ] as const
          ).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`rounded-lg px-3.5 py-2 text-xs font-bold transition ${tab === value ? "bg-white text-black" : "text-white/55 hover:text-white"}`}
            >
              {label}{" "}
              <span
                className={`mr-1 rounded-full px-1.5 py-0.5 text-[10px] ${tab === value ? "bg-black/10" : "bg-white/8"}`}
              >
                {count}
              </span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="grid min-h-[360px] place-items-center">
            <Loader2 className="h-7 w-7 animate-spin text-violet-300" />
          </div>
        ) : loadError ? (
          <div className="mt-12 grid min-h-[320px] place-items-center rounded-3xl border border-red-300/15 bg-red-300/[.025] p-8 text-center">
            <div>
              <h2 className="text-lg font-bold">تعذر تحميل المشاريع</h2>
              <p className="mt-2 text-sm text-white/50">{loadError}</p>
              <Button
                variant="outline"
                className="mt-5"
                onClick={() => void load()}
              >
                إعادة المحاولة
              </Button>
            </div>
          </div>
        ) : visibleProjects.length === 0 ? (
          <div className="mt-12 grid min-h-[360px] place-items-center rounded-3xl border border-dashed border-white/15 bg-white/[.025] p-8 text-center">
            <div>
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-white/5">
                <FolderOpen className="h-7 w-7 text-violet-300" />
              </div>
              <h2 className="mt-5 text-xl font-bold">
                {tab === "ACTIVE"
                  ? "ابدأ مشروعك الأول"
                  : tab === "ARCHIVED"
                    ? "لا توجد مشاريع مؤرشفة"
                    : "المحذوفات فارغة"}
              </h2>
              <p className="mt-2 text-sm text-white/50">
                {tab === "ACTIVE"
                  ? "ستحصل على مساحة نظيفة ومستقلة وجاهزة للتوليد."
                  : tab === "ARCHIVED"
                    ? "يمكنك أرشفة المشاريع المكتملة لتبقى محفوظة هنا."
                    : "الحذف آمن؛ المشاريع المحذوفة تبقى قابلة للاستعادة."}
              </p>
              {tab === "ACTIVE" && (
                <Button
                  className="mt-6 gap-2 rounded-xl"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                  إنشاء مشروع
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div
            className="mt-9 grid gap-4 md:grid-cols-2 xl:grid-cols-3"
            data-testid="project-list"
          >
            {visibleProjects.map((project) => (
              <article
                key={project.projectId}
                className="group overflow-hidden rounded-2xl border border-white/10 bg-[#111318] transition hover:border-violet-300/30"
              >
                <button
                  type="button"
                  disabled={project.lifecycleState !== "ACTIVE"}
                  className="w-full p-5 text-right disabled:cursor-default"
                  onClick={() =>
                    navigate(
                      `/projects/${encodeURIComponent(project.projectId)}/standard`,
                    )
                  }
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-violet-300/15 bg-violet-300/10 text-violet-200">
                      <FolderOpen className="h-5 w-5" />
                    </div>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-[10px] ${project.lifecycleState === "ACTIVE" ? "border-emerald-300/15 bg-emerald-300/8 text-emerald-200" : project.lifecycleState === "ARCHIVED" ? "border-amber-300/15 bg-amber-300/8 text-amber-200" : "border-red-300/15 bg-red-300/8 text-red-200"}`}
                    >
                      {project.lifecycleState === "ACTIVE"
                        ? "نشط"
                        : project.lifecycleState === "ARCHIVED"
                          ? "مؤرشف"
                          : "محذوف"}
                    </span>
                  </div>
                  <h2 className="mt-5 truncate text-lg font-bold">
                    {project.title}
                  </h2>
                  <p
                    className="mt-1 truncate text-[10px] text-white/30"
                    dir="ltr"
                  >
                    {project.projectId}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2 text-[11px] text-white/55">
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5">
                      <ImageIcon className="h-3.5 w-3.5" />
                      {project.assetCount} ملفات
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5">
                      <Workflow className="h-3.5 w-3.5" />
                      {project.operationCount} عمليات
                    </span>
                  </div>
                  <div className="mt-5 flex items-center gap-1.5 text-[10px] text-white/35">
                    <Clock3 className="h-3.5 w-3.5" />
                    آخر تعديل{" "}
                    {dateFormatter.format(new Date(project.updatedAt))}
                  </div>
                </button>
                <div className="flex items-center justify-between border-t border-white/8 px-4 py-3">
                  {project.lifecycleState === "ACTIVE" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        navigate(
                          `/projects/${encodeURIComponent(project.projectId)}/standard`,
                        )
                      }
                    >
                      فتح المشروع
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="gap-2"
                      disabled={pendingProjectId === project.projectId}
                      onClick={() => void runProjectAction(project, "RESTORE")}
                    >
                      <ArchiveRestore className="h-4 w-4" />
                      استعادة
                    </Button>
                  )}
                  {project.lifecycleState !== "DELETED" && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={pendingProjectId === project.projectId}
                          aria-label={`إجراءات ${project.title}`}
                        >
                          {pendingProjectId === project.projectId ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <MoreHorizontal className="h-4 w-4" />
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="min-w-44 text-right"
                      >
                        {project.lifecycleState === "ACTIVE" && (
                          <DropdownMenuItem
                            onSelect={() =>
                              openProjectDialog("RENAME", project)
                            }
                          >
                            <Pencil className="ml-2 h-4 w-4" />
                            إعادة التسمية
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onSelect={() =>
                            openProjectDialog("DUPLICATE", project)
                          }
                        >
                          <Copy className="ml-2 h-4 w-4" />
                          إنشاء نسخة مستقلة
                        </DropdownMenuItem>
                        {project.lifecycleState === "ACTIVE" && (
                          <DropdownMenuItem
                            onSelect={() =>
                              void runProjectAction(project, "ARCHIVE")
                            }
                          >
                            <Archive className="ml-2 h-4 w-4" />
                            أرشفة
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-red-300 focus:text-red-200"
                          onSelect={() => openProjectDialog("DELETE", project)}
                        >
                          <Trash2 className="ml-2 h-4 w-4" />
                          نقل إلى المحذوفات
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!creating) setCreateOpen(open);
        }}
      >
        <DialogContent
          className="max-w-md border-white/10 bg-[#111318]"
          dir="rtl"
          lang="ar"
        >
          <DialogHeader>
            <DialogTitle>إنشاء مشروع جديد</DialogTitle>
            <DialogDescription>
              سيُنشأ مشروع مستقل وفارغ. لن تُنسخ ملفات أو عمليات المشروع السابق.
            </DialogDescription>
          </DialogHeader>
          <form className="mt-3 space-y-4" onSubmit={createProject}>
            <div className="space-y-2">
              <label htmlFor="project-title" className="text-sm font-semibold">
                اسم المشروع
              </label>
              <Input
                id="project-title"
                autoFocus
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="مثلاً: حملة المنتج الجديدة"
              />
              <p className="text-[11px] text-white/40">
                الحد الأقصى 120 حرفًا.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={creating}
                onClick={() => setCreateOpen(false)}
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                className="gap-2"
                disabled={!title.trim() || creating}
              >
                {creating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                إنشاء وفتح
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!projectDialog}
        onOpenChange={(open) => {
          if (!open && !pendingProjectId) setProjectDialog(null);
        }}
      >
        <DialogContent
          className="max-w-md border-white/10 bg-[#111318]"
          dir="rtl"
          lang="ar"
        >
          <DialogHeader>
            <DialogTitle>
              {projectDialog?.kind === "RENAME"
                ? "إعادة تسمية المشروع"
                : projectDialog?.kind === "DUPLICATE"
                  ? "إنشاء نسخة مستقلة"
                  : "نقل المشروع إلى المحذوفات"}
            </DialogTitle>
            <DialogDescription>
              {projectDialog?.kind === "RENAME"
                ? "يتغير الاسم فقط، وتبقى الملفات والعمليات كما هي."
                : projectDialog?.kind === "DUPLICATE"
                  ? "تُنشأ مساحة جديدة وفارغة باسم مستقل. لا تُنسخ العمليات المالية أو النتائج القديمة."
                  : "هذا حذف آمن؛ لن تُمسح البيانات ويمكن استعادة المشروع من تبويب المحذوفات."}
            </DialogDescription>
          </DialogHeader>
          {projectDialog?.kind === "DELETE" ? (
            <div className="mt-3 space-y-5">
              <div className="rounded-xl border border-red-300/15 bg-red-300/5 p-4">
                <p className="font-bold">{projectDialog.project.title}</p>
                <p className="mt-1 text-xs text-white/50">
                  سيُمنع فتح المشروع أو تنفيذ توليد جديد داخله حتى تتم استعادته.
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  disabled={!!pendingProjectId}
                  onClick={() => setProjectDialog(null)}
                >
                  إلغاء
                </Button>
                <Button
                  variant="destructive"
                  className="gap-2"
                  disabled={!!pendingProjectId}
                  onClick={() =>
                    void runProjectAction(projectDialog.project, "DELETE")
                  }
                >
                  {pendingProjectId ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  نقل إلى المحذوفات
                </Button>
              </div>
            </div>
          ) : (
            <form className="mt-3 space-y-4" onSubmit={submitProjectDialog}>
              <div className="space-y-2">
                <label
                  htmlFor="project-command-title"
                  className="text-sm font-semibold"
                >
                  اسم المشروع
                </label>
                <Input
                  id="project-command-title"
                  autoFocus
                  maxLength={120}
                  value={commandTitle}
                  onChange={(event) => setCommandTitle(event.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={!!pendingProjectId}
                  onClick={() => setProjectDialog(null)}
                >
                  إلغاء
                </Button>
                <Button
                  type="submit"
                  className="gap-2"
                  disabled={!commandTitle.trim() || !!pendingProjectId}
                >
                  {pendingProjectId ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : projectDialog?.kind === "DUPLICATE" ? (
                    <Copy className="h-4 w-4" />
                  ) : (
                    <Pencil className="h-4 w-4" />
                  )}
                  {projectDialog?.kind === "DUPLICATE"
                    ? "إنشاء النسخة"
                    : "حفظ الاسم"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
