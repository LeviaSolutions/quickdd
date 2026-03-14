import {
  FileText,
  FileSpreadsheet,
  FileImage,
  Mail,
  FileCode,
  FileArchive,
  File,
  Presentation,
  Ruler,
} from "lucide-react";
import { cn } from "@/utils/cn";
import { getFileIconType, type FileIconType } from "@/utils/format";

interface FileIconProps {
  filename: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}

const iconComponents: Record<FileIconType, React.ElementType> = {
  pdf: FileText,
  word: FileText,
  excel: FileSpreadsheet,
  image: FileImage,
  email: Mail,
  xml: FileCode,
  cad: Ruler,
  text: FileText,
  archive: FileArchive,
  presentation: Presentation,
  unknown: File,
};

const iconColors: Record<FileIconType, string> = {
  pdf: "text-red-500",
  word: "text-blue-500",
  excel: "text-green-600",
  image: "text-purple-500",
  email: "text-amber-500",
  xml: "text-cyan-500",
  cad: "text-orange-500",
  text: "text-slate-500",
  archive: "text-slate-400",
  presentation: "text-orange-400",
  unknown: "text-slate-400",
};

const sizeMap = {
  sm: "w-4 h-4",
  md: "w-5 h-5",
  lg: "w-6 h-6",
};

export function FileIcon({ filename, className, size = "md" }: FileIconProps) {
  const type = getFileIconType(filename);
  const Icon = iconComponents[type];
  return (
    <Icon className={cn(sizeMap[size], iconColors[type], className)} />
  );
}
