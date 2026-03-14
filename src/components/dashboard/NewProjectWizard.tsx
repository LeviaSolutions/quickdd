import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import {
  FolderOpen,
  Upload,
  Check,
  Building2,
  Warehouse,
  ShoppingBag,
  Home,
  Layers,
  Loader2,
  Search,
  ChevronDown,
  ChevronRight,
  Plus,
  X,
} from "lucide-react";
import { projectsApi, questionsApi } from "@/services";
import { useAppStore } from "@/store/app-store";
import type { AssetClass, ProjectCreateRequest, Question } from "@/types/api";
import { cn } from "@/utils/cn";
import toast from "react-hot-toast";

const STEPS = ["step1", "step2", "step3", "step4"] as const;

const assetClassOptions: {
  value: AssetClass;
  icon: React.ElementType;
  label: string;
}[] = [
  { value: "office", icon: Building2, label: "BÜRO" },
  { value: "logistics", icon: Warehouse, label: "LOGISTIK" },
  { value: "retail", icon: ShoppingBag, label: "HANDEL" },
  { value: "residential", icon: Home, label: "RESIDENTIAL" },
  { value: "mixed_use", icon: Layers, label: "MISCHNUTZUNG" },
];

export function NewProjectWizard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const language = useAppStore((s) => s.language);

  const folderInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [folderName, setFolderName] = useState("");
  const [assetClass, setAssetClass] = useState<AssetClass>("office");
  const [files, setFiles] = useState<File[]>([]);

  // Question selection state
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(
    new Set(),
  );
  const [questionsInitialized, setQuestionsInitialized] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(),
  );
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customCategory, setCustomCategory] =
    useState<string>("legal_ownership");
  const [customQuestionText, setCustomQuestionText] = useState("");
  const [customPriority, setCustomPriority] = useState("medium");
  const [customQuestions, setCustomQuestions] = useState<
    Array<{
      id: string;
      category: string;
      question_de: string;
      priority: string;
    }>
  >([]);

  // Fetch questions when reaching step 2 (question catalogue step)
  const { data: allQuestions = [], isLoading: questionsLoading } = useQuery({
    queryKey: ["questions", assetClass],
    queryFn: () => questionsApi.getQuestionsByAssetClass(assetClass),
    enabled: step >= 2,
  });

  // Initialize: select ALL questions by default when first loaded
  useEffect(() => {
    if (allQuestions.length > 0 && !questionsInitialized) {
      setSelectedQuestionIds(new Set(allQuestions.map((q) => q.id)));
      setQuestionsInitialized(true);
    }
  }, [allQuestions, questionsInitialized]);

  // Reset question selection when asset class changes
  useEffect(() => {
    setQuestionsInitialized(false);
    setSelectedQuestionIds(new Set());
  }, [assetClass]);

  // Group questions by category
  const questionsByCategory = useMemo(() => {
    const groups: Record<string, Question[]> = {};
    for (const q of allQuestions) {
      if (!groups[q.category]) groups[q.category] = [];
      groups[q.category]!.push(q);
    }
    return groups;
  }, [allQuestions]);

  // Filter questions by search query
  const filteredByCategory = useMemo(() => {
    if (!searchQuery.trim()) return questionsByCategory;
    const lower = searchQuery.toLowerCase();
    const filtered: Record<string, Question[]> = {};
    for (const [cat, questions] of Object.entries(questionsByCategory)) {
      const matching = questions.filter(
        (q) =>
          q.question_de.toLowerCase().includes(lower) ||
          q.question_en.toLowerCase().includes(lower) ||
          q.id.toLowerCase().includes(lower),
      );
      if (matching.length > 0) filtered[cat] = matching;
    }
    return filtered;
  }, [questionsByCategory, searchQuery]);

  const toggleCategory = useCallback(
    (category: string) => {
      const questions = questionsByCategory[category] || [];
      const allSelected = questions.every((q) => selectedQuestionIds.has(q.id));
      setSelectedQuestionIds((prev) => {
        const next = new Set(prev);
        for (const q of questions) {
          if (allSelected) next.delete(q.id);
          else next.add(q.id);
        }
        return next;
      });
    },
    [questionsByCategory, selectedQuestionIds],
  );

  const selectOnlyCategory = useCallback(
    (category: string) => {
      const questions = questionsByCategory[category] || [];
      setSelectedQuestionIds(new Set(questions.map((q) => q.id)));
    },
    [questionsByCategory],
  );

  const toggleQuestion = useCallback((questionId: string) => {
    setSelectedQuestionIds((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      return next;
    });
  }, []);

  const toggleExpandCategory = useCallback((category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedQuestionIds(new Set(allQuestions.map((q) => q.id)));
  }, [allQuestions]);

  const deselectAll = useCallback(() => {
    setSelectedQuestionIds(new Set());
  }, []);

  const addCustomQuestion = useCallback(() => {
    if (!customQuestionText.trim()) return;
    const id = `CUSTOM-LOCAL-${Date.now()}`;
    setCustomQuestions((prev) => [
      ...prev,
      {
        id,
        category: customCategory,
        question_de: customQuestionText.trim(),
        priority: customPriority,
      },
    ]);
    setSelectedQuestionIds((prev) => new Set([...prev, id]));
    setCustomQuestionText("");
    setShowCustomForm(false);
    toast.success(t("wizard.questionAdded"));
  }, [customQuestionText, customCategory, customPriority, t]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const catalogueIds = [...selectedQuestionIds].filter(
        (id) => !id.startsWith("CUSTOM-LOCAL-"),
      );

      const request: ProjectCreateRequest = {
        name,
        asset_class: assetClass,
        description,
        folder_path: folderPath || "auto",
        language,
        question_catalogue_ids: catalogueIds,
      };
      const project = await projectsApi.createProject(request);

      // Create custom questions on the server
      for (const cq of customQuestions) {
        if (selectedQuestionIds.has(cq.id)) {
          try {
            await questionsApi.createCustomQuestion(project.id, {
              category: cq.category,
              question_de: cq.question_de,
              priority: cq.priority,
            });
          } catch (err) {
            console.error("Failed to create custom question:", err);
          }
        }
      }

      // Import folder if path was specified
      if (folderPath.trim()) {
        try {
          const results = await projectsApi.uploadFolder(
            project.id,
            folderPath.trim(),
          );
          toast.success(
            `${(results as unknown[]).length} file(s) queued from folder`,
          );
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Folder import failed";
          toast.error(message);
        }
      }

      // Upload individual files if any were dropped
      if (files.length > 0) {
        await projectsApi.uploadProjectFiles(project.id, files);
        toast.success(`${files.length} file(s) uploaded`);
      }

      return project;
    },
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate(`/projects/${project.id}`);
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message);
    },
  });

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setFiles((prev) => [...prev, ...acceptedFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    noClick: false,
  });

  async function handleSelectFolder() {
    const isTauri = !!(window as unknown as Record<string, unknown>)
      .__TAURI_INTERNALS__;
    if (isTauri) {
      try {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const selected = await open({ directory: true, multiple: false });
        if (selected) {
          setFolderPath(selected as string);
        }
      } catch (err) {
        console.warn("Tauri dialog failed:", err);
      }
    } else {
      folderInputRef.current?.click();
    }
  }

  function handleBrowserFolderSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    if (!selected.length) return;
    const firstPath =
      (selected[0] as File & { webkitRelativePath?: string })
        .webkitRelativePath || "";
    const topFolder = firstPath.split("/")[0] || "Selected folder";
    setFolderName(topFolder);
    setFiles((prev) => [...prev, ...selected]);
    toast.success(`${selected.length} file(s) selected from "${topFolder}"`);
    if (folderInputRef.current) folderInputRef.current.value = "";
  }

  const canProceed = () => {
    if (step === 0) return name.trim().length > 0;
    if (step === 1) return true;
    if (step === 2) return selectedQuestionIds.size > 0;
    return true;
  };

  return (
    <div className="h-full flex flex-col overflow-hidden relative">
      {/* White modal card overlay */}
      <div className="absolute inset-x-[35px] top-[10px] bottom-[20px] bg-white rounded-2xl shadow-[0px_15px_41.6px_0px_rgba(0,0,0,0.11)] flex flex-col overflow-hidden">
        {/* Header: Title + Close */}
        <div className="shrink-0 px-6 pt-5 pb-0 flex items-start justify-between">
          <h2 className="text-2xl font-medium text-landmark-dark uppercase tracking-wide">
            {name || t("wizard.title")}
          </h2>
          <button
            onClick={() => navigate("/")}
            className="w-[43px] h-[43px] rounded-full bg-white shadow-[0px_0px_9px_0px_rgba(0,0,0,0.1)] flex items-center justify-center hover:bg-slate-50 transition-colors"
          >
            <X className="w-5 h-5 text-landmark-dark" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="shrink-0 px-6 pt-3 pb-4">
          <div className="flex items-center">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center">
                {/* Step circle */}
                <div
                  className={cn(
                    "w-[29px] h-[29px] rounded-full flex items-center justify-center text-base font-normal transition-colors shadow-[0px_0px_6px_0px_rgba(0,0,0,0.1)]",
                    i <= step
                      ? "bg-landmark-grey text-landmark-dark"
                      : "bg-landmark-grey text-landmark-dark opacity-50",
                  )}
                >
                  {i + 1}
                </div>
                {/* Step label */}
                <span
                  className={cn(
                    "text-base ml-2",
                    i === step
                      ? "text-landmark-dark font-normal"
                      : "text-landmark-dark opacity-50 font-normal",
                  )}
                >
                  {t(`wizard.${s}`)}
                </span>
                {/* Connector line */}
                {i < STEPS.length - 1 && (
                  <div className="w-[62px] h-px bg-landmark-grey-light mx-3" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step content */}
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          <div className="max-w-[486px] mx-auto">
            {/* Step 1: Project Details */}
            {step === 0 && (
              <div className="space-y-4 animate-fade-in pt-8">
                {/* Project Name */}
                <div className="h-[45px] rounded-full border border-landmark-grey-light bg-white/55 shadow-[0px_6.8px_6.8px_0px_rgba(0,0,0,0.04)] flex items-center px-4 focus-within:ring-2 focus-within:ring-landmark-accent transition-shadow">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={
                      t("wizard.projectNamePlaceholder") || "Projekt Name"
                    }
                    className="w-full bg-transparent text-sm font-light text-[#7e7e7e] placeholder:text-[#7e7e7e] placeholder:opacity-70 focus:outline-none focus:text-landmark-dark caret-landmark-accent"
                    autoFocus
                  />
                </div>

                {/* Description */}
                <div className="h-[142px] rounded-3xl border border-landmark-grey-light bg-white/55 shadow-[0px_6.8px_6.8px_0px_rgba(0,0,0,0.04)] p-4 focus-within:ring-2 focus-within:ring-landmark-accent transition-shadow">
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={
                      t("wizard.descriptionPlaceholder") ||
                      "Kurzbeschreibung des Projektes..."
                    }
                    className="w-full h-full bg-transparent text-sm font-light text-[#7e7e7e] placeholder:text-[#7e7e7e] placeholder:opacity-70 focus:outline-none focus:text-landmark-dark caret-landmark-accent resize-none"
                  />
                </div>

                {/* Folder picker */}
                <button
                  onClick={handleSelectFolder}
                  className="w-full h-[45px] rounded-full border border-landmark-grey-light bg-white/55 shadow-[0px_6.8px_6.8px_0px_rgba(0,0,0,0.04)] flex items-center px-4 gap-3 hover:bg-white transition-colors"
                >
                  <FolderOpen className="w-5 h-5 text-black opacity-25" />
                  <span className="text-sm font-light text-[#7d7d7d] opacity-70">
                    {folderPath ||
                      folderName ||
                      t("wizard.selectFolder") ||
                      "Projektordner auswählen"}
                  </span>
                </button>
                {/* Hidden folder input for browser mode */}
                <input
                  ref={folderInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleBrowserFolderSelect}
                  {...({
                    webkitdirectory: "",
                    directory: "",
                  } as React.InputHTMLAttributes<HTMLInputElement>)}
                  multiple
                />

                {/* Server file upload zone */}
                <div
                  {...getRootProps()}
                  className={cn(
                    "h-[141px] rounded-3xl border border-landmark-grey-light bg-[#f0f0f0] shadow-[0px_6.8px_6.8px_0px_rgba(0,0,0,0.04)] flex flex-col items-center justify-center cursor-pointer transition-colors",
                    isDragActive &&
                      "bg-landmark-accent/10 border-landmark-accent",
                  )}
                >
                  <input {...getInputProps()} />
                  <Upload className="w-8 h-8 text-black opacity-20 mb-2" />
                  <p className="text-sm font-light text-[#7d7d7d] opacity-60">
                    Serverdatei hochladen
                  </p>
                </div>

                {files.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-landmark-accent font-medium mb-1">
                      {files.length} file(s) selected
                    </p>
                    <div className="space-y-0.5 max-h-24 overflow-y-auto">
                      {files.slice(0, 5).map((f, i) => (
                        <p
                          key={i}
                          className="text-xs text-landmark-accent truncate"
                        >
                          {f.name} ({(f.size / 1024).toFixed(0)} KB)
                        </p>
                      ))}
                      {files.length > 5 && (
                        <p className="text-xs text-landmark-accent">
                          ...and {files.length - 5} more
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Step 2: Asset Class */}
            {step === 1 && (
              <div className="animate-fade-in pt-16">
                {/* 3-column top row + 2-column bottom row centered */}
                <div className="flex flex-col items-center gap-4">
                  <div className="grid grid-cols-3 gap-4">
                    {assetClassOptions.slice(0, 3).map((opt) => {
                      const Icon = opt.icon;
                      const isSelected = assetClass === opt.value;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => setAssetClass(opt.value)}
                          className={cn(
                            "w-[150px] h-[103px] rounded-2xl bg-white flex flex-col items-center justify-center gap-2 transition-all",
                            isSelected
                              ? "ring-2 ring-landmark-accent shadow-[0px_4px_4px_0px_rgba(0,0,0,0.12)]"
                              : "shadow-[0px_4px_4px_0px_rgba(0,0,0,0.12)] hover:shadow-[0px_6px_12px_0px_rgba(0,0,0,0.15)]",
                          )}
                        >
                          <Icon
                            className="w-[40px] h-[40px] text-landmark-dark"
                            strokeWidth={1.2}
                          />
                          <span className="text-sm font-medium text-black">
                            {opt.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {assetClassOptions.slice(3).map((opt) => {
                      const Icon = opt.icon;
                      const isSelected = assetClass === opt.value;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => setAssetClass(opt.value)}
                          className={cn(
                            "w-[150px] h-[103px] rounded-2xl bg-white flex flex-col items-center justify-center gap-2 transition-all",
                            isSelected
                              ? "ring-2 ring-landmark-accent shadow-[0px_4px_4px_0px_rgba(0,0,0,0.12)]"
                              : "shadow-[0px_4px_4px_0px_rgba(0,0,0,0.12)] hover:shadow-[0px_6px_12px_0px_rgba(0,0,0,0.15)]",
                          )}
                        >
                          <Icon
                            className="w-[40px] h-[40px] text-landmark-dark"
                            strokeWidth={1.2}
                          />
                          <span className="text-sm font-medium text-black">
                            {opt.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Question Catalogue */}
            {step === 2 && (
              <div className="animate-fade-in space-y-4 pt-4">
                <h3 className="text-sm font-medium text-landmark-dark">
                  {t("wizard.questionCatalogue")}
                </h3>

                {questionsLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin text-landmark-accent" />
                  </div>
                ) : (
                  <>
                    {/* Search + Select All controls */}
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#a8a8a8]" />
                        <input
                          type="text"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder={t("wizard.searchQuestions")}
                          className="input pl-10 text-sm"
                        />
                      </div>
                      <button
                        onClick={
                          selectedQuestionIds.size === allQuestions.length
                            ? deselectAll
                            : selectAll
                        }
                        className="btn-secondary text-xs whitespace-nowrap"
                      >
                        {selectedQuestionIds.size === allQuestions.length
                          ? t("wizard.deselectAll")
                          : t("wizard.selectAll")}
                      </button>
                    </div>

                    {/* Summary bar */}
                    <div className="bg-landmark-accent/10 rounded-full px-4 py-2 text-sm font-medium text-landmark-accent">
                      {t("wizard.questionsOf", {
                        selected: selectedQuestionIds.size,
                        total: allQuestions.length + customQuestions.length,
                      })}
                    </div>

                    {/* Category accordion list */}
                    <div className="space-y-1 max-h-[400px] overflow-y-auto rounded-2xl border border-landmark-grey-light">
                      {Object.entries(filteredByCategory).map(
                        ([category, questions]) => {
                          const isExpanded = expandedCategories.has(category);
                          const selectedInCat = questions.filter((q) =>
                            selectedQuestionIds.has(q.id),
                          ).length;
                          const allInCatSelected =
                            selectedInCat === questions.length;

                          return (
                            <div
                              key={category}
                              className="border-b last:border-b-0 border-landmark-grey-light"
                            >
                              <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 hover:bg-slate-100">
                                <input
                                  type="checkbox"
                                  checked={allInCatSelected}
                                  ref={(el) => {
                                    if (el)
                                      el.indeterminate =
                                        selectedInCat > 0 && !allInCatSelected;
                                  }}
                                  onChange={() => toggleCategory(category)}
                                  className="rounded border-landmark-grey text-landmark-accent focus:ring-landmark-accent"
                                />
                                <button
                                  onClick={() => toggleExpandCategory(category)}
                                  className="flex items-center gap-1 flex-1 text-left"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="w-4 h-4 text-landmark-accent" />
                                  ) : (
                                    <ChevronRight className="w-4 h-4 text-landmark-accent" />
                                  )}
                                  <span className="text-sm font-medium text-landmark-dark">
                                    {t(`categories.${category}`, category)}
                                  </span>
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    selectOnlyCategory(category);
                                  }}
                                  className="text-xs text-landmark-accent hover:text-landmark-dark hover:underline whitespace-nowrap"
                                >
                                  {t("wizard.selectOnly")}
                                </button>
                                <span className="text-xs text-landmark-accent tabular-nums">
                                  {selectedInCat}/{questions.length}
                                </span>
                              </div>

                              {isExpanded && (
                                <div className="divide-y divide-landmark-grey-light">
                                  {questions.map((q) => (
                                    <label
                                      key={q.id}
                                      className="flex items-start gap-2 px-3 py-2 pl-9 hover:bg-slate-50 cursor-pointer"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={selectedQuestionIds.has(q.id)}
                                        onChange={() => toggleQuestion(q.id)}
                                        className="mt-0.5 rounded border-landmark-grey text-landmark-accent focus:ring-landmark-accent"
                                      />
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm text-landmark-dark">
                                          {q.question_de}
                                        </p>
                                        <div className="flex items-center gap-2 mt-0.5">
                                          <span className="text-xs text-landmark-accent font-mono">
                                            {q.id}
                                          </span>
                                          <span
                                            className={cn(
                                              "text-xs px-1.5 py-0.5 rounded-full",
                                              q.priority === "critical"
                                                ? "bg-red-100 text-red-700"
                                                : q.priority === "high"
                                                  ? "bg-orange-100 text-orange-700"
                                                  : q.priority === "medium"
                                                    ? "bg-yellow-100 text-yellow-700"
                                                    : "bg-slate-100 text-slate-600",
                                            )}
                                          >
                                            {q.priority}
                                          </span>
                                        </div>
                                      </div>
                                    </label>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        },
                      )}

                      {/* Custom questions in the list */}
                      {customQuestions.length > 0 && (
                        <div className="border-b last:border-b-0 border-landmark-grey-light">
                          <div className="flex items-center gap-2 px-3 py-2 bg-slate-50">
                            <span className="text-sm font-medium ml-6 text-landmark-dark">
                              {t("wizard.addCustomQuestion")}
                            </span>
                            <span className="text-xs text-landmark-accent ml-auto">
                              {customQuestions.length}
                            </span>
                          </div>
                          <div className="divide-y divide-landmark-grey-light">
                            {customQuestions.map((cq) => (
                              <label
                                key={cq.id}
                                className="flex items-start gap-2 px-3 py-2 pl-9 hover:bg-slate-50 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedQuestionIds.has(cq.id)}
                                  onChange={() => toggleQuestion(cq.id)}
                                  className="mt-0.5 rounded border-landmark-grey text-landmark-accent focus:ring-landmark-accent"
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-landmark-dark">
                                    {cq.question_de}
                                  </p>
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-xs text-landmark-accent font-mono">
                                      {cq.id}
                                    </span>
                                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">
                                      custom
                                    </span>
                                  </div>
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    setCustomQuestions((prev) =>
                                      prev.filter((q) => q.id !== cq.id),
                                    );
                                    setSelectedQuestionIds((prev) => {
                                      const next = new Set(prev);
                                      next.delete(cq.id);
                                      return next;
                                    });
                                  }}
                                  className="p-1 text-landmark-accent hover:text-status-red"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Add custom question */}
                    {showCustomForm ? (
                      <div className="bg-white rounded-2xl border border-landmark-grey-light p-4 space-y-3 shadow-[0px_4px_4px_0px_rgba(0,0,0,0.04)]">
                        <div>
                          <label className="block text-xs font-medium mb-1 text-landmark-dark">
                            {t("wizard.customCategory")}
                          </label>
                          <select
                            value={customCategory}
                            onChange={(e) => setCustomCategory(e.target.value)}
                            className="input text-sm"
                          >
                            {Object.keys(questionsByCategory).map((cat) => (
                              <option key={cat} value={cat}>
                                {t(`categories.${cat}`, cat)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1 text-landmark-dark">
                            {t("wizard.addCustomQuestion")}
                          </label>
                          <input
                            type="text"
                            value={customQuestionText}
                            onChange={(e) =>
                              setCustomQuestionText(e.target.value)
                            }
                            placeholder={t("wizard.customQuestionPlaceholder")}
                            className="input text-sm"
                            autoFocus
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1 text-landmark-dark">
                            {t("wizard.customPriority")}
                          </label>
                          <select
                            value={customPriority}
                            onChange={(e) => setCustomPriority(e.target.value)}
                            className="input text-sm"
                          >
                            <option value="critical">Critical</option>
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                          </select>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => setShowCustomForm(false)}
                            className="btn-secondary text-xs"
                          >
                            {t("common.cancel")}
                          </button>
                          <button
                            onClick={addCustomQuestion}
                            disabled={!customQuestionText.trim()}
                            className="btn-primary text-xs"
                          >
                            <Plus className="w-3 h-3" />
                            {t("common.save")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowCustomForm(true)}
                        className="btn-secondary text-sm w-full"
                      >
                        <Plus className="w-4 h-4" />
                        {t("wizard.addCustomQuestion")}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Step 4: File Upload */}
            {step === 3 && (
              <div className="animate-fade-in pt-8">
                <div
                  {...getRootProps()}
                  className={cn(
                    "h-[200px] rounded-3xl border-2 border-dashed border-landmark-grey-light bg-[#f0f0f0] flex flex-col items-center justify-center cursor-pointer transition-colors",
                    isDragActive &&
                      "border-landmark-accent bg-landmark-accent/10",
                  )}
                >
                  <input {...getInputProps()} />
                  <Upload className="w-10 h-10 text-black opacity-20 mb-3" />
                  <p className="text-sm font-light text-[#7d7d7d]">
                    {t("wizard.dragDropHint")}
                  </p>
                  <p className="text-xs text-[#a8a8a8] mt-1">
                    {t("wizard.supportedFormats")}
                  </p>
                </div>

                {files.length > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-medium text-landmark-dark mb-2">
                      {files.length} file(s) selected
                    </p>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {files.map((f, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 text-sm text-landmark-accent py-1"
                        >
                          <span className="truncate">{f.name}</span>
                          <span className="text-xs text-[#a8a8a8]">
                            {(f.size / 1024).toFixed(0)} KB
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer: centered action button */}
        <div className="shrink-0 px-6 pb-6 flex justify-center">
          {step < STEPS.length - 1 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canProceed()}
              className="btn-primary min-w-[147px]"
            >
              {step === 0
                ? t("wizard.create") || "Projekt erstellen"
                : t("wizard.next") || "Fortfahren"}
            </button>
          ) : (
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending || !name.trim()}
              className="btn-primary min-w-[147px]"
            >
              {createMutation.isPending ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {t("wizard.create") || "Projekt erstellen"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
