import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Send,
  Plus,
  BookmarkPlus,
  StopCircle,
  MessageSquare,
  FileText,
} from "lucide-react";
import { chatApi } from "@/services";
import { useAppStore } from "@/store/app-store";
import { ConfidenceBadge } from "../common/ConfidenceBadge";
import { cn } from "@/utils/cn";
import type { ChatMessage, ChatStreamChunk } from "@/types/api";

export function FreeQueryChat() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const language = useAppStore((s) => s.language);

  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [streamingMessages, setStreamingMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch sessions
  const { data: sessions } = useQuery({
    queryKey: ["chat-sessions", projectId],
    queryFn: () => chatApi.getChatSessions(projectId!),
    enabled: !!projectId,
  });

  // Fetch active session
  const { data: activeSession } = useQuery({
    queryKey: ["chat-session", projectId, activeSessionId],
    queryFn: () => chatApi.getChatSession(projectId!, activeSessionId!),
    enabled: !!projectId && !!activeSessionId,
  });

  // Create session
  const createSessionMutation = useMutation({
    mutationFn: () => chatApi.createChatSession(projectId!),
    onSuccess: (session) => {
      setActiveSessionId(session.id);
      queryClient.invalidateQueries({
        queryKey: ["chat-sessions", projectId],
      });
    },
  });

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [streamingMessages, activeSession?.messages]);

  // Send query with streaming
  const handleSend = useCallback(async () => {
    if (!inputValue.trim() || !activeSessionId || isStreaming) return;

    const query = inputValue.trim();
    setInputValue("");

    // Add user message immediately
    const userMsg: ChatMessage = {
      id: `temp-${Date.now()}`,
      project_id: projectId!,
      role: "user",
      content: query,
      sources: null,
      confidence_tier: null,
      created_at: new Date().toISOString(),
      is_streaming: false,
    };

    // Add assistant placeholder
    const assistantMsg: ChatMessage = {
      id: `temp-${Date.now() + 1}`,
      project_id: projectId!,
      role: "assistant",
      content: "",
      sources: null,
      confidence_tier: null,
      created_at: new Date().toISOString(),
      is_streaming: true,
    };

    setStreamingMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      await chatApi.sendFreeQuery(
        {
          project_id: projectId!,
          session_id: activeSessionId,
          query,
          language,
        },
        // onChunk
        (chunk: ChatStreamChunk) => {
          setStreamingMessages((prev) => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === "assistant") {
              lastMsg.content += chunk.token;
              if (chunk.is_complete) {
                lastMsg.is_streaming = false;
                lastMsg.sources = chunk.sources ?? null;
                lastMsg.confidence_tier = chunk.confidence_tier ?? null;
              }
            }
            return updated;
          });
        },
        // onComplete
        () => {
          setIsStreaming(false);
          queryClient.invalidateQueries({
            queryKey: ["chat-session", projectId, activeSessionId],
          });
        },
        // onError
        (error) => {
          console.error("Chat stream error:", error);
          setIsStreaming(false);
          setStreamingMessages((prev) => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === "assistant") {
              lastMsg.content = `Error: ${error.message}`;
              lastMsg.is_streaming = false;
            }
            return updated;
          });
        },
        abortController.signal,
      );
    } catch {
      setIsStreaming(false);
    }
  }, [
    inputValue,
    activeSessionId,
    projectId,
    language,
    isStreaming,
    queryClient,
  ]);

  function handleStopStreaming() {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  }

  // Merge persisted + streaming messages
  const allMessages = [
    ...(activeSession?.messages ?? []),
    ...streamingMessages,
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 border-b bg-white dark:bg-slate-900 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => navigate(`/projects/${projectId}`)}
          className="btn-ghost p-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <MessageSquare className="w-5 h-5 text-brand-600" />
        <h2 className="text-sm font-semibold">{t("chat.title")}</h2>
        <div className="flex-1" />
        <button
          onClick={() => createSessionMutation.mutate()}
          className="btn-secondary text-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          {t("chat.newSession")}
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Session sidebar */}
        <div className="w-56 border-r bg-white dark:bg-slate-900 overflow-y-auto shrink-0">
          <div className="px-3 py-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              {t("chat.sessions")}
            </p>
          </div>
          {sessions?.map((session) => (
            <button
              key={session.id}
              onClick={() => {
                setActiveSessionId(session.id);
                setStreamingMessages([]);
              }}
              className={cn(
                "w-full px-3 py-2 text-left text-xs hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors",
                activeSessionId === session.id &&
                  "bg-brand-50 dark:bg-brand-900/20 text-brand-700 dark:text-brand-300",
              )}
            >
              <p className="truncate font-medium">
                {session.title || "New Session"}
              </p>
              <p className="text-2xs text-slate-400 mt-0.5">
                {session.messages.length} messages
              </p>
            </button>
          ))}
          {(!sessions || sessions.length === 0) && (
            <p className="px-3 text-xs text-slate-400">
              No sessions yet. Create one to start chatting.
            </p>
          )}
        </div>

        {/* Chat area */}
        <div className="flex-1 flex flex-col">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {allMessages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "flex gap-3 max-w-3xl",
                  msg.role === "user" ? "ml-auto" : "",
                )}
              >
                {msg.role === "assistant" && (
                  <div className="w-7 h-7 rounded-full bg-brand-100 dark:bg-brand-900/30 flex items-center justify-center shrink-0">
                    <span className="text-brand-600 dark:text-brand-400 text-2xs font-bold">
                      DD
                    </span>
                  </div>
                )}
                <div
                  className={cn(
                    "rounded-lg p-3 text-sm max-w-[80%]",
                    msg.role === "user"
                      ? "bg-brand-600 text-white"
                      : "bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100",
                  )}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">
                    {msg.content}
                    {msg.is_streaming && (
                      <span className="inline-block w-2 h-4 bg-brand-600 animate-pulse ml-0.5" />
                    )}
                  </p>

                  {/* Sources and confidence for completed assistant messages */}
                  {msg.role === "assistant" &&
                    !msg.is_streaming &&
                    msg.content && (
                      <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center gap-2 flex-wrap">
                        {msg.confidence_tier && (
                          <ConfidenceBadge
                            tier={msg.confidence_tier}
                            size="sm"
                          />
                        )}
                        {msg.sources?.slice(0, 3).map((s) => (
                          <span
                            key={s.id}
                            className="inline-flex items-center gap-1 text-2xs text-blue-600 dark:text-blue-400"
                          >
                            <FileText className="w-3 h-3" />
                            {s.document_filename} p.{s.page_number}
                          </span>
                        ))}
                        <button
                          className="ml-auto btn-ghost p-1"
                          title={t("chat.saveAsQuestion")}
                        >
                          <BookmarkPlus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="shrink-0 border-t bg-white dark:bg-slate-900 p-4">
            <div className="flex items-end gap-2 max-w-3xl mx-auto">
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={t("chat.placeholder")}
                className="input flex-1 min-h-[44px] max-h-32 resize-y"
                rows={1}
                disabled={!activeSessionId || isStreaming}
              />
              {isStreaming ? (
                <button
                  onClick={handleStopStreaming}
                  className="btn-danger shrink-0"
                >
                  <StopCircle className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={handleSend}
                  disabled={!inputValue.trim() || !activeSessionId}
                  className="btn-primary shrink-0"
                >
                  <Send className="w-4 h-4" />
                </button>
              )}
            </div>
            {isStreaming && (
              <p className="text-2xs text-slate-400 text-center mt-2 animate-stream">
                {t("chat.streaming")}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
