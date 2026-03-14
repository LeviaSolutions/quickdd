// =============================================================================
// DD-Analyst API Type Definitions
// Maps 1:1 to the FastAPI backend Pydantic models and SQLite schema
// =============================================================================

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export type AssetClass =
  | "office"
  | "logistics"
  | "retail"
  | "residential"
  | "mixed_use";

export type ProjectStatus =
  | "created"
  | "ingesting"
  | "processing"
  | "completed"
  | "archived"
  | "error";

export type DocumentStatus =
  | "uploaded"
  | "detecting"
  | "extracting"
  | "chunking"
  | "embedding"
  | "indexed"
  | "error"
  | "skipped";

export type ConfidenceTier = "high" | "medium" | "low" | "insufficient_data";

export type AnswerStatus =
  | "pending"
  | "generating"
  | "generated"
  | "reviewed"
  | "overridden"
  | "error";

export type QuestionPriority = "critical" | "high" | "medium" | "low";

export type ExpectedFormat =
  | "yes_no"
  | "yes_no_detail"
  | "date"
  | "currency"
  | "percentage"
  | "numeric"
  | "free_text"
  | "list"
  | "table"
  | "structured";

export type QuestionCategory =
  | "legal_ownership"
  | "building_permits_zoning"
  | "lease_rental"
  | "financial_valuation"
  | "technical_building"
  | "environmental"
  | "insurance"
  | "tax"
  | "regulatory_compliance"
  | "disputes_litigation"
  | "esg_sustainability"
  | "property_management"
  | "capex_maintenance";

export type ReportType =
  | "full_report"
  | "executive_summary"
  | "red_flags"
  | "category_report"
  | "qa_matrix"
  | "confidence_summary";

export type ReportFormat = "docx" | "pdf" | "xlsx";

export type UserRole = "admin" | "analyst" | "viewer";

export type Language = "de" | "en";

export type LLMModel = "claude-opus-4-6" | "claude-sonnet-4-6";

// ---------------------------------------------------------------------------
// Core Domain Models
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  asset_class: AssetClass;
  description?: string;
  status: ProjectStatus;
  created_at: string;
  updated_at?: string;
  file_count: number;
  question_count: number;
  answered_count: number;
  coverage_percentage?: number;
  high_confidence_count?: number;
  medium_confidence_count?: number;
  low_confidence_count?: number;
  insufficient_count?: number;
  red_flag_count?: number;
  last_activity?: string;
  folder_path?: string;
}

export interface ProjectCreateRequest {
  name: string;
  asset_class: AssetClass;
  description?: string;
  folder_path: string;
  question_catalogue_ids?: string[];
  language: Language;
}

export interface ProjectStats {
  total_files: number;
  total_pages: number;
  total_chunks: number;
  processing_progress: number;
  estimated_remaining_seconds: number;
  questions_total: number;
  questions_answered: number;
  questions_pending_review: number;
  confidence_distribution: ConfidenceDistribution;
  category_coverage: CategoryCoverage[];
}

export interface ConfidenceDistribution {
  high: number;
  medium: number;
  low: number;
  insufficient: number;
}

export interface CategoryCoverage {
  category: QuestionCategory;
  total: number;
  answered: number;
  coverage_percentage: number;
  average_confidence: number;
  red_flag_count: number;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export interface Document {
  id: string;
  project_id: string;
  filename: string;
  file_path: string;
  mime_type: string;
  file_size: number;
  page_count: number;
  hash: string;
  status: DocumentStatus;
  ocr_confidence: number | null;
  chunk_count: number;
  uploaded_at: string;
  processed_at: string | null;
  error_message: string | null;
}

export interface DocumentUploadProgress {
  document_id: string;
  filename: string;
  status: DocumentStatus;
  progress_percentage: number;
  current_stage: string;
  error_message: string | null;
}

export interface DocumentPreview {
  document_id: string;
  filename: string;
  page_count: number;
  pages: DocumentPage[];
}

export interface DocumentPage {
  page_number: number;
  text_content: string;
  highlights: TextHighlight[];
}

export interface TextHighlight {
  start_offset: number;
  end_offset: number;
  chunk_id: string;
  answer_id: string;
}

// ---------------------------------------------------------------------------
// Questions & Answers
// ---------------------------------------------------------------------------

export interface Question {
  id: string;
  category: QuestionCategory;
  subcategory: string | null;
  asset_classes: AssetClass[];
  question_de: string;
  question_en: string;
  expected_format: ExpectedFormat;
  priority: QuestionPriority;
  source_hint: string | null;
  severity_weight: number;
  depends_on: string[];
  requires_table_qa: boolean;
  multi_hop_required: boolean;
  regulatory_reference: string | null;
}

export interface Answer {
  id: string;
  project_id: string;
  question_id: string;
  answer_text: string;
  short_answer: string;
  answer_text_de: string | null;
  answer_text_en: string | null;
  confidence_tier: ConfidenceTier;
  confidence_score: number;
  retrieval_score: number;
  consistency_score: number;
  hop_count: number;
  status: AnswerStatus;
  model_used: string;
  token_count: number;
  processing_time_seconds: number;
  created_at: string;
  updated_at: string;
  sources: AnswerSource[];
  contradictions: Contradiction[];
  reasoning_trace: string | null;
  intermediate_answers: IntermediateAnswer[] | null;
}

export interface AnswerSource {
  id: string;
  chunk_id: string | null;
  table_id: string | null;
  document_id: string;
  document_filename: string;
  page_number: number;
  section: string | null;
  text_snippet: string;
  relevance_score: number;
}

export interface IntermediateAnswer {
  sub_question: string;
  answer: string;
  sources: AnswerSource[];
  hop_number: number;
}

export interface Contradiction {
  id: string;
  source_a_document: string;
  source_a_page: number;
  source_a_text: string;
  source_b_document: string;
  source_b_page: number;
  source_b_text: string;
  description: string;
  resolved: boolean;
}

export interface QuestionAnswerPair {
  question: Question;
  answer: Answer | null;
}

export interface AnswerOverride {
  answer_id: string;
  override_text: string;
  reason: string;
  user_name: string;
}

export interface ReviewSignoff {
  answer_id: string;
  reviewer_name: string;
  comment: string;
}

// ---------------------------------------------------------------------------
// Red Flags
// ---------------------------------------------------------------------------

export interface RedFlag {
  id: string;
  question: Question;
  answer: Answer;
  flag_type: "low_confidence" | "contradiction" | "negative_finding" | "data_gap";
  severity: number;
  category: QuestionCategory;
  description: string;
  recommended_action: string;
}

export interface CategoryRiskSummary {
  category: QuestionCategory;
  traffic_light: "green" | "amber" | "red";
  risk_score: number;
  max_risk_score: number;
  red_flag_count: number;
  critical_flags: number;
  summary: string;
}

export interface ProjectRiskOverview {
  overall_risk_score: number;
  overall_traffic_light: "green" | "amber" | "red";
  category_summaries: CategoryRiskSummary[];
  red_flags: RedFlag[];
  total_flags: number;
  critical_flags: number;
}

// ---------------------------------------------------------------------------
// Free Query / Chat
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  project_id: string;
  role: "user" | "assistant";
  content: string;
  sources: AnswerSource[] | null;
  confidence_tier: ConfidenceTier | null;
  created_at: string;
  is_streaming: boolean;
}

export interface ChatSession {
  id: string;
  project_id: string;
  title: string;
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
}

export interface FreeQueryRequest {
  project_id: string;
  session_id: string;
  query: string;
  language: Language;
}

export interface SaveAsQuestionRequest {
  message_id: string;
  category: QuestionCategory;
  priority: QuestionPriority;
  question_de: string;
  question_en: string;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface ReportConfig {
  project_id: string;
  report_type: ReportType;
  format: ReportFormat;
  template_id: string | null;
  language: Language;
  include_categories: QuestionCategory[];
  include_confidence_levels: ConfidenceTier[];
  branding: BrandingConfig;
}

export interface BrandingConfig {
  logo_path: string | null;
  primary_color: string;
  secondary_color: string;
  header_text: string;
  footer_text: string;
  company_name: string;
}

export interface ReportTemplate {
  id: string;
  name: string;
  report_type: ReportType;
  description: string;
  is_default: boolean;
  file_path: string;
}

export interface ReportGenerationStatus {
  report_id: string;
  status: "generating" | "complete" | "error";
  progress_percentage: number;
  output_path: string | null;
  error_message: string | null;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface AppSettings {
  language: Language;
  theme: "light" | "dark" | "system";
  model: LLMModel;
  processing: ProcessingSettings;
  branding: BrandingConfig;
  keyboard_shortcuts: KeyboardShortcuts;
}

export interface ProcessingSettings {
  context_window: number;
  temperature: number;
  top_p: number;
  max_output_tokens: number;
  retrieval_top_k: number;
  reranker_top_k: number;
  chunk_size: number;
  chunk_overlap: number;
  max_hops: number;
  parallel_questions: number;
}

export interface KeyboardShortcuts {
  search: string;
  new_project: string;
  toggle_theme: string;
  toggle_language: string;
  export_report: string;
  next_question: string;
  prev_question: string;
  toggle_sidebar: string;
}

export interface SystemInfo {
  ram_total_mb: number;
  ram_available_mb: number;
  disk_free_gb: number;
  cpu_cores: number;
  active_model: LLMModel;
  api_connected: boolean;
  estimated_full_run_minutes: number;
}

export interface UserProfile {
  id: string;
  name: string;
  role: UserRole;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Backend Health & Processing
// ---------------------------------------------------------------------------

export interface HealthCheck {
  status: "ok" | "degraded" | "error";
  version: string;
  uptime_seconds: number;
  api_connected: boolean;
  active_tasks: number;
}

export interface ProcessingQueueItem {
  question_id: string;
  question_text: string;
  category: QuestionCategory;
  priority: QuestionPriority;
  status: "queued" | "processing" | "complete" | "error";
  progress_percentage: number;
  estimated_seconds: number;
  started_at: string | null;
}

export interface ProcessingProgress {
  project_id: string;
  total_questions: number;
  completed_questions: number;
  current_question: ProcessingQueueItem | null;
  overall_progress: number;
  estimated_remaining_seconds: number;
  queue: ProcessingQueueItem[];
}

// ---------------------------------------------------------------------------
// SSE Event Types
// ---------------------------------------------------------------------------

export type SSEEventType =
  | "processing_progress"
  | "document_status"
  | "answer_complete"
  | "answer_stream"
  | "error"
  | "health"
  | "chat_stream";

export interface SSEEvent<T = unknown> {
  event: SSEEventType;
  data: T;
  id?: string;
}

export interface AnswerStreamChunk {
  answer_id: string;
  question_id: string;
  token: string;
  is_complete: boolean;
  confidence_tier?: ConfidenceTier;
  sources?: AnswerSource[];
}

export interface ChatStreamChunk {
  session_id: string;
  message_id: string;
  token: string;
  is_complete: boolean;
  sources?: AnswerSource[];
  confidence_tier?: ConfidenceTier;
}

// ---------------------------------------------------------------------------
// API Response Wrappers
// ---------------------------------------------------------------------------

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface ApiError {
  detail: string;
  code: string;
  status: number;
}
