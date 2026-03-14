/**
 * Question & Answer API operations.
 */

import { get, post } from "./api-client";
import type {
  QuestionAnswerPair,
  Answer,
  AnswerOverride,
  ReviewSignoff,
  Question,
  ConfidenceTier,
  QuestionCategory,
  QuestionPriority,
  AnswerStatus,
  DocumentPreview,
} from "@/types/api";

const BASE = "/api/v1/projects";

export interface QuestionFilters {
  category?: QuestionCategory;
  confidence?: ConfidenceTier;
  status?: AnswerStatus;
  priority?: QuestionPriority;
  search?: string;
}

export async function getQuestionAnswers(
  projectId: string,
  filters?: QuestionFilters
): Promise<QuestionAnswerPair[]> {
  const params: Record<string, string> = {};
  if (filters?.category) params["category"] = filters.category;
  if (filters?.confidence) params["confidence"] = filters.confidence;
  if (filters?.status) params["status"] = filters.status;
  if (filters?.priority) params["priority"] = filters.priority;
  if (filters?.search) params["search"] = filters.search;

  return get<QuestionAnswerPair[]>(
    `${BASE}/${projectId}/questions`,
    params
  );
}

export async function getAnswer(
  projectId: string,
  questionId: string
): Promise<QuestionAnswerPair> {
  return get<QuestionAnswerPair>(
    `${BASE}/${projectId}/questions/${questionId}`
  );
}

export async function overrideAnswer(
  projectId: string,
  data: AnswerOverride
): Promise<Answer> {
  return post<Answer>(
    `${BASE}/${projectId}/answers/${data.answer_id}/override`,
    data
  );
}

export async function signoffReview(
  projectId: string,
  data: ReviewSignoff
): Promise<Answer> {
  return post<Answer>(
    `${BASE}/${projectId}/answers/${data.answer_id}/signoff`,
    data
  );
}

export async function reprocessQuestion(
  projectId: string,
  questionId: string
): Promise<void> {
  await post<null>(
    `${BASE}/${projectId}/questions/${questionId}/reprocess`
  );
}

export async function getDocumentPreview(
  projectId: string,
  documentId: string,
  highlightChunkIds?: string[]
): Promise<DocumentPreview> {
  const params: Record<string, string> = {};
  if (highlightChunkIds?.length) {
    params["highlight_chunks"] = highlightChunkIds.join(",");
  }
  return get<DocumentPreview>(
    `${BASE}/${projectId}/documents/${documentId}/preview`,
    params
  );
}

export async function getQuestionCatalogue(): Promise<Question[]> {
  return get<Question[]>("/api/v1/questions/catalogue");
}

export async function getQuestionsByAssetClass(
  assetClass: string
): Promise<Question[]> {
  return get<Question[]>("/api/v1/questions", {
    asset_class: assetClass,
  });
}

export async function createCustomQuestion(
  projectId: string,
  data: {
    category: string;
    question_de: string;
    question_en?: string;
    expected_format?: string;
    priority?: string;
  }
): Promise<Question> {
  return post<Question>(
    `${BASE}/${projectId}/questions/custom`,
    data
  );
}

/** Namespace export for convenient use as `questionsApi.method()` */
export const questionsApi = {
  getQuestionAnswers,
  getAnswer,
  overrideAnswer,
  signoffReview,
  reprocessQuestion,
  getDocumentPreview,
  getQuestionCatalogue,
  getQuestionsByAssetClass,
  createCustomQuestion,
};
