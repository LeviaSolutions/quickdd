"""LLM Manager -- supports OpenAI-compatible and Anthropic providers.

OpenAI-compatible targets ollama / vLLM running locally.
Anthropic is available as a fallback for development.
Provider is toggled via DDA_LLM_PROVIDER env var ("openai" | "anthropic").
"""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncGenerator
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)


class LLMManager:
    """Dual-provider LLM inference manager."""

    def __init__(self) -> None:
        self._client: Any = None
        self._provider = settings.llm_provider

        if self._provider == "openai":
            self._init_openai()
        elif self._provider == "anthropic":
            self._init_anthropic()
        else:
            raise ValueError(f"Unknown LLM provider: {self._provider}")

    # ---- Properties ----

    @property
    def is_loaded(self) -> bool:
        return self._client is not None

    @property
    def model_name(self) -> str:
        if self._provider == "openai":
            return settings.openai_model
        return settings.anthropic_model

    # ---- Initialisation ----

    def _init_openai(self) -> None:
        from openai import AsyncOpenAI

        self._client = AsyncOpenAI(
            base_url=settings.openai_base_url,
            api_key=settings.openai_api_key,
        )
        logger.info(
            "OpenAI-compatible LLM: %s at %s",
            settings.openai_model,
            settings.openai_base_url,
        )

    def _init_anthropic(self) -> None:
        import anthropic

        api_key = settings.anthropic_api_key or os.environ.get(
            "ANTHROPIC_API_KEY", ""
        )
        if not api_key:
            raise ValueError(
                "ANTHROPIC_API_KEY required. Set DDA_ANTHROPIC_API_KEY or "
                "ANTHROPIC_API_KEY environment variable."
            )
        self._client = anthropic.AsyncAnthropic(api_key=api_key)
        logger.info("Anthropic LLM: %s", settings.anthropic_model)

    # ---- Lifecycle ----

    async def unload(self) -> None:
        """Release the LLM client."""
        self._client = None
        logger.info("LLM client released (provider=%s)", self._provider)

    # ---- Public inference API ----

    async def generate(
        self,
        messages: list[dict],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
        top_p: float | None = None,
        stop: list[str] | None = None,
    ) -> dict[str, Any]:
        """Non-streaming chat completion.

        Returns dict with keys: text, prompt_tokens, completion_tokens.
        """
        if self._provider == "openai":
            return await self._generate_openai(
                messages,
                temperature=temperature,
                max_tokens=max_tokens,
                top_p=top_p,
                stop=stop,
            )
        return await self._generate_anthropic(
            messages,
            temperature=temperature,
            max_tokens=max_tokens,
            top_p=top_p,
            stop=stop,
        )

    async def generate_stream(
        self,
        messages: list[dict],
        *,
        temperature: float | None = None,
        max_tokens: int | None = None,
        top_p: float | None = None,
        stop: list[str] | None = None,
    ) -> AsyncGenerator[str, None]:
        """Streaming chat completion -- yields token strings."""
        if self._provider == "openai":
            async for chunk in self._stream_openai(
                messages,
                temperature=temperature,
                max_tokens=max_tokens,
                top_p=top_p,
            ):
                yield chunk
        else:
            async for chunk in self._stream_anthropic(
                messages,
                temperature=temperature,
                max_tokens=max_tokens,
                top_p=top_p,
                stop=stop,
            ):
                yield chunk

    # ---- OpenAI-compatible backend ----

    def _prepare_openai_messages(
        self, messages: list[dict]
    ) -> list[dict]:
        """Pass through messages, coercing content to str when scalar."""
        result: list[dict] = []
        for msg in messages:
            content = msg.get("content", "")
            if isinstance(content, list):
                # Multimodal content blocks (text + image_url) -- pass as-is
                result.append({"role": msg["role"], "content": content})
            else:
                result.append({"role": msg["role"], "content": str(content)})
        return result

    async def _generate_openai(
        self,
        messages: list[dict],
        **kwargs: Any,
    ) -> dict[str, Any]:
        prepared = self._prepare_openai_messages(messages)
        response = await self._client.chat.completions.create(
            model=settings.openai_model,
            messages=prepared,
            temperature=kwargs.get("temperature") or settings.temperature,
            max_tokens=kwargs.get("max_tokens") or settings.max_output_tokens,
            top_p=kwargs.get("top_p") or settings.top_p,
            stop=kwargs.get("stop"),
            stream=False,
        )
        choice = response.choices[0]
        usage = response.usage
        return {
            "text": choice.message.content or "",
            "prompt_tokens": usage.prompt_tokens if usage else 0,
            "completion_tokens": usage.completion_tokens if usage else 0,
        }

    async def _stream_openai(
        self,
        messages: list[dict],
        **kwargs: Any,
    ) -> AsyncGenerator[str, None]:
        prepared = self._prepare_openai_messages(messages)
        stream = await self._client.chat.completions.create(
            model=settings.openai_model,
            messages=prepared,
            temperature=kwargs.get("temperature") or settings.temperature,
            max_tokens=kwargs.get("max_tokens") or settings.max_output_tokens,
            top_p=kwargs.get("top_p") or settings.top_p,
            stream=True,
        )
        async for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                yield chunk.choices[0].delta.content

    # ---- Anthropic backend ----

    def _prepare_anthropic_params(
        self,
        messages: list[dict],
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Convert generic message list to Anthropic API params."""
        system_parts: list[str] = []
        api_messages: list[dict] = []

        for msg in messages:
            if msg["role"] == "system":
                system_parts.append(str(msg.get("content", "")))
            else:
                api_messages.append(
                    {"role": msg["role"], "content": msg["content"]}
                )

        # Anthropic requires at least one user message
        if not api_messages:
            api_messages.append({"role": "user", "content": "."})

        # Merge consecutive same-role messages (Anthropic requirement)
        merged: list[dict] = [api_messages[0]]
        for m in api_messages[1:]:
            if m["role"] == merged[-1]["role"]:
                merged[-1] = {
                    **merged[-1],
                    "content": str(merged[-1]["content"])
                    + "\n\n"
                    + str(m["content"]),
                }
            else:
                merged.append(m)

        params: dict[str, Any] = {
            "model": settings.anthropic_model,
            "messages": merged,
            "max_tokens": kwargs.get("max_tokens") or settings.max_output_tokens,
            "temperature": kwargs.get("temperature") or settings.temperature,
            "top_p": kwargs.get("top_p") or settings.top_p,
        }

        if system_parts:
            params["system"] = "\n\n".join(system_parts)

        if kwargs.get("stop"):
            params["stop_sequences"] = kwargs["stop"]

        return params

    async def _generate_anthropic(
        self,
        messages: list[dict],
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Non-streaming generation via Anthropic API."""
        params = self._prepare_anthropic_params(messages, **kwargs)
        response = await self._client.messages.create(**params)

        text = ""
        for block in response.content:
            if block.type == "text":
                text += block.text

        return {
            "text": text,
            "prompt_tokens": response.usage.input_tokens,
            "completion_tokens": response.usage.output_tokens,
        }

    async def _stream_anthropic(
        self,
        messages: list[dict],
        **kwargs: Any,
    ) -> AsyncGenerator[str, None]:
        """Streaming generation via Anthropic API."""
        params = self._prepare_anthropic_params(messages, **kwargs)
        async with self._client.messages.stream(**params) as stream:
            async for text in stream.text_stream:
                yield text
