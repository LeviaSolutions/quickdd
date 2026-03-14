"""Pydantic schemas for the LLM service API."""

from __future__ import annotations

from pydantic import BaseModel, Field


class InferenceConfig(BaseModel):
    """Adjustable inference parameters."""

    temperature: float = Field(default=0.1, ge=0.0, le=2.0)
    top_p: float = Field(default=0.9, ge=0.0, le=1.0)
    max_tokens: int = Field(default=4096, ge=1, le=16384)
    stop_sequences: list[str] = Field(default_factory=list)


class ChatMessage(BaseModel):
    """Single message in a chat sequence."""

    role: str = Field(..., pattern=r"^(system|user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    """Request for LLM chat completion (free query mode)."""

    project_id: str
    messages: list[ChatMessage]
    config: InferenceConfig | None = None
    stream: bool = True


class ChatCompletionResponse(BaseModel):
    """Non-streaming chat completion result."""

    answer: str
    model_used: str
    prompt_tokens: int
    completion_tokens: int
    sources: list[dict] = Field(default_factory=list)
