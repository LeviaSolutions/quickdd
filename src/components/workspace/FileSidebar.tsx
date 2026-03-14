import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  ChevronDown,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Upload,
  FolderOpen,
} from "lucide-react";
import { useState, useRef } from "react";
import { projectsApi } from "@/services";
import { FileIcon } from "../common/FileIcon";
import { cn } from "@/utils/cn";
import { formatFileSize, getDocumentStatusColor } from "@/utils/format";
import type { Document, DocumentStatus } from "@/types/api";
import toast from "react-hot-toast";

interface FileSidebarProps {
  projectId: string;
}

const statusIcons: Record<DocumentStatus, React.ElementType | null> = {
  uploaded: null,
  detecting: Loader2,
  extracting: Loader2,
  chunking: Loader2,
  embedding: Loader2,
  indexed: CheckCircle2,
  error: AlertCircle,
  skipped: AlertCircle,
};

export function FileSidebar({ projectId }: FileSidebarProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(["all"])
  );
  const [folderPath, setFolderPath] = useState("");
  const [showFolderInput, setShowFolderInput] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { data: documents } = useQuery({
    queryKey: ["documents", projectId],
    queryFn: () => projectsApi.getProjectDocuments(projectId),
    refetchInterval: 5_000,
  });

  // Group documents by extension for a simple "folder" view
  const groups = (documents ?? []).reduce(
    (acc, doc) => {
      const ext = doc.filename.split(".").pop()?.toUpperCase() ?? "OTHER";
      if (!acc[ext]) acc[ext] = [];
      acc[ext].push(doc);
      return acc;
    },
    {} as Record<string, Document[]>
  );

  function toggleFolder(key: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    try {
      await projectsApi.uploadProjectFiles(projectId, files);
      toast.success(`${files.length} file(s) uploaded`);
      queryClient.invalidateQueries({ queryKey: ["documents", projectId] });
    } catch (err) {
      toast.error("Upload failed");
      console.error(err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleFolderUpload() {
    if (!folderPath.trim()) return;
    setUploading(true);
    try {
      const results = await projectsApi.uploadFolder(projectId, folderPath.trim());
      toast.success(`${(results as unknown[]).length} file(s) queued from folder`);
      setFolderPath("");
      setShowFolderInput(false);
      queryClient.invalidateQueries({ queryKey: ["documents", projectId] });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Folder upload failed";
      toast.error(message);
      console.error(err);
    } finally {
      setUploading(false);
    }
  }

  const processingCount = documents?.filter(
    (d) =>
      d.status === "detecting" ||
      d.status === "extracting" ||
      d.status === "chunking" ||
      d.status === "embedding"
  ).length;
  const readyCount = documents?.filter((d) => d.status === "indexed").length;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b">
        <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          {t("workspace.files")}
        </h3>
        <div className="flex items-center gap-3 mt-1 text-2xs text-slate-500">
          <span>{documents?.length ?? 0} files</span>
          {processingCount !== undefined && processingCount > 0 && (
            <span className="flex items-center gap-1 text-blue-500">
              <Loader2 className="w-3 h-3 animate-spin" />
              {processingCount} processing
            </span>
          )}
          {readyCount !== undefined && (
            <span className="text-green-500">{readyCount} ready</span>
          )}
        </div>
      </div>

      {/* Upload buttons */}
      <div className="shrink-0 px-3 py-2 border-b space-y-2">
        <div className="flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-dashed border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" />
            Files
          </button>
          <button
            onClick={() => setShowFolderInput(!showFolderInput)}
            disabled={uploading}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-dashed transition-colors disabled:opacity-50",
              showFolderInput
                ? "border-brand-400 bg-brand-50 dark:bg-brand-900/20 text-brand-700"
                : "border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800"
            )}
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Folder
          </button>
        </div>

        {showFolderInput && (
          <div className="space-y-1.5 animate-fade-in">
            <input
              type="text"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              placeholder="C:\path\to\documents"
              className="w-full px-2.5 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 focus:ring-1 focus:ring-brand-500 focus:border-brand-500 outline-none"
              onKeyDown={(e) => e.key === "Enter" && handleFolderUpload()}
            />
            <p className="text-2xs text-slate-400">
              Scans recursively for PDF, DOCX, XLSX, TXT, images, archives, etc.
            </p>
            <button
              onClick={handleFolderUpload}
              disabled={!folderPath.trim() || uploading}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {uploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FolderOpen className="w-3.5 h-3.5" />
              )}
              {uploading ? "Processing..." : "Import Folder"}
            </button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileUpload}
          accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.eml,.msg,.png,.jpg,.jpeg,.tiff,.bmp,.webp,.zip,.7z,.rar,.rtf,.csv,.xml,.json"
        />
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto py-2">
        {Object.entries(groups)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([ext, docs]) => {
            const isExpanded = expandedFolders.has(ext);
            return (
              <div key={ext}>
                <button
                  onClick={() => toggleFolder(ext)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  {isExpanded ? (
                    <ChevronDown className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5" />
                  )}
                  <span>{ext}</span>
                  <span className="ml-auto text-2xs text-slate-400">
                    {docs.length}
                  </span>
                </button>
                {isExpanded && (
                  <div className="ml-4">
                    {docs.map((doc) => {
                      const StatusIcon = statusIcons[doc.status];
                      return (
                        <div
                          key={doc.id}
                          className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800 rounded cursor-pointer group"
                          title={`${doc.filename}\n${formatFileSize(doc.file_size)}\nStatus: ${doc.status}`}
                        >
                          <FileIcon filename={doc.filename} size="sm" />
                          <span className="truncate flex-1 text-slate-700 dark:text-slate-300">
                            {doc.filename}
                          </span>
                          {StatusIcon && (
                            <StatusIcon
                              className={cn(
                                "w-3.5 h-3.5 shrink-0",
                                getDocumentStatusColor(doc.status),
                                (doc.status === "detecting" ||
                                  doc.status === "extracting" ||
                                  doc.status === "chunking" ||
                                  doc.status === "embedding") &&
                                  "animate-spin"
                              )}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
