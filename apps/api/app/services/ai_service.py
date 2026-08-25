from __future__ import annotations

from datetime import datetime, timezone

import httpx
from sqlmodel import Session

from app.config import get_settings
from app.db_models import AiJob, Book, User
from app.i18n_labels import normalize_locale
from app.services.book_context import build_writing_context
from app.services.book_style import style_profile_from_book
from app.services.token_budget import (
    PLAN_MONTHLY_TOKENS,
    assert_ai_allowed,
    assert_quota,
    estimate_tokens,
    quota_info,
    tokens_used_this_month,
)

settings = get_settings()

LOCALE_NAMES = {"en": "English", "pt-BR": "Brazilian Portuguese", "es": "Spanish"}


def get_quota(session: Session, user: User) -> dict:
    return quota_info(session, user)


def model_for_plan(plan: str) -> str:
    if settings.llm_model.strip():
        return settings.llm_model.strip()
    if plan == "studio":
        return settings.llm_model_studio.strip() or "gpt-4o"
    return settings.llm_model_pro.strip() or "gpt-4o-mini"


def usage_total_tokens(usage: int | dict[str, int] | None) -> int:
    """Normalize LLM usage payloads to an integer for AiJob.tokens_used."""
    if usage is None:
        return 0
    if isinstance(usage, dict):
        return int(usage.get("total_tokens") or 0)
    return int(usage or 0)


def provider_info() -> dict:
    live = settings.llm_live_enabled
    return {
        "live": live,
        "base_url": settings.resolved_llm_base_url,
        "provider": "openai" if settings.is_openai_cloud else "openai_compatible",
        "model_pro": model_for_plan("pro"),
        "model_studio": model_for_plan("studio"),
        "has_api_key": bool(settings.resolved_llm_api_key),
    }


def run_chapter_ai(
    session: Session,
    *,
    user: User,
    book: Book,
    chapter_id: str | None,
    action: str,
    prompt: str,
    selection: str = "",
) -> AiJob:
    locale = normalize_locale(book.locale)
    language = LOCALE_NAMES.get(locale, "English")
    system, user_prompt = _prompts_for_action(
        session=session,
        book=book,
        chapter_id=chapter_id,
        action=action,
        prompt=prompt,
        selection=selection,
        language=language,
    )
    model = model_for_plan(user.plan)
    assert_quota(session, user, prompt_texts=(system, user_prompt))

    job = AiJob(
        book_id=book.id,
        user_id=user.id,
        chapter_id=chapter_id,
        job_type="chapter",
        action=action,
        model=model,
        status="processing",
        prompt=user_prompt,
        locale=locale,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    session.add(job)
    session.commit()
    session.refresh(job)

    if not settings.llm_live_enabled:
        result = _offline_result(action, prompt, selection, language, book.title)
        est_in = estimate_tokens(system, user_prompt)
        est_out = max(1, len(result.split()))
        job.result_text = result
        job.input_tokens = est_in
        job.output_tokens = est_out
        job.tokens_used = est_in + est_out
        job.status = "ready"
        job.updated_at = datetime.now(timezone.utc)
        session.add(job)
        session.commit()
        session.refresh(job)
        return job

    model = model_for_plan(user.plan)
    try:
        text, usage = _chat_completion(
            model=model,
            system=system,
            user_prompt=user_prompt,
            temperature=0.85 if action in {"generate", "start", "continue"} else 0.7,
        )
        job.result_text = text
        job.input_tokens = usage.get("input_tokens", 0)
        job.output_tokens = usage.get("output_tokens", 0)
        job.tokens_used = usage.get("total_tokens", 0)
        job.status = "ready"
    except Exception as exc:  # noqa: BLE001
        job.status = "failed"
        job.error = str(exc)

    job.updated_at = datetime.now(timezone.utc)
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


def iter_chapter_ai_stream(
    session: Session,
    *,
    user: User,
    book: Book,
    chapter_id: str | None,
    action: str,
    prompt: str,
    selection: str = "",
):
    """Yield SSE-ready dicts: delta / done / error. Persists AiJob when finished."""
    locale = normalize_locale(book.locale)
    language = LOCALE_NAMES.get(locale, "English")
    system, user_prompt = _prompts_for_action(
        session=session,
        book=book,
        chapter_id=chapter_id,
        action=action,
        prompt=prompt,
        selection=selection,
        language=language,
    )
    model = model_for_plan(user.plan)
    assert_quota(
        session,
        user,
        prompt_texts=(system, user_prompt),
    )

    job = AiJob(
        book_id=book.id,
        user_id=user.id,
        chapter_id=chapter_id,
        job_type="chapter",
        action=action,
        model=model,
        status="processing",
        prompt=user_prompt,
        locale=locale,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    job_id = job.id
    quota = quota_info(session, user)

    yield {"type": "start", "job_id": job_id, "quota": quota}

    parts: list[str] = []
    usage: dict[str, int] = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    try:
        if not settings.llm_live_enabled:
            result = _offline_result(action, prompt, selection, language, book.title)
            chunk = 24
            for i in range(0, len(result), chunk):
                piece = result[i : i + chunk]
                parts.append(piece)
                yield {"type": "delta", "text": piece}
            usage = {
                "input_tokens": estimate_tokens(system, user_prompt),
                "output_tokens": max(1, len(result.split())),
                "total_tokens": estimate_tokens(system, user_prompt) + max(1, len(result.split())),
            }
        else:
            temperature = 0.85 if action in {"generate", "start", "continue"} else 0.7
            for piece in _chat_completion_stream(
                model=model,
                system=system,
                user_prompt=user_prompt,
                temperature=temperature,
                usage_out=usage,
            ):
                parts.append(piece)
                yield {"type": "delta", "text": piece}

        text = "".join(parts).strip()
        if not text:
            raise RuntimeError("LLM returned empty content.")

        if usage["total_tokens"] <= 0:
            usage["input_tokens"] = estimate_tokens(system, user_prompt)
            usage["output_tokens"] = max(1, len(text.split()))
            usage["total_tokens"] = usage["input_tokens"] + usage["output_tokens"]

        job = session.get(AiJob, job_id)
        if job:
            job.result_text = text
            job.input_tokens = usage["input_tokens"]
            job.output_tokens = usage["output_tokens"]
            job.tokens_used = usage["total_tokens"]
            job.status = "ready"
            job.updated_at = datetime.now(timezone.utc)
            session.add(job)
            session.commit()

        quota_after = quota_info(session, user)
        yield {
            "type": "done",
            "job_id": job_id,
            "tokens_used": usage["total_tokens"],
            "input_tokens": usage["input_tokens"],
            "output_tokens": usage["output_tokens"],
            "text": text,
            "quota": quota_after,
        }
    except Exception as exc:  # noqa: BLE001
        job = session.get(AiJob, job_id)
        if job:
            job.status = "failed"
            job.error = str(exc)
            job.updated_at = datetime.now(timezone.utc)
            session.add(job)
            session.commit()
        yield {"type": "error", "job_id": job_id, "error": str(exc)}


def _prompts_for_action(
    *,
    session: Session,
    book: Book,
    chapter_id: str | None,
    action: str,
    prompt: str,
    selection: str,
    language: str,
) -> tuple[str, str]:
    profile = style_profile_from_book(book)
    style_block = profile.to_prompt_block(language)
    context_block = build_writing_context(
        session,
        book=book,
        chapter_id=chapter_id,
        profile=profile,
        selection=selection,
        action=action,
    )
    system_parts = [
        "You are a warm, practical literary coach helping authors write books.",
        f"Always write in {language}. Keep prose clear, vivid, and publishable.",
        "Unless asked for notes or an outline list, return only the story text "
        "ready to paste into a chapter—no markdown fences, no meta commentary.",
    ]
    if style_block:
        system_parts.append(style_block)
        system_parts.append(
            "Honor the book voice profile in every response. "
            "Do not break POV, tone, or genre conventions unless the author explicitly asks."
        )
    system = "\n".join(system_parts)
    user_prompt = _build_user_prompt(
        action,
        prompt,
        selection,
        language,
        book_title=book.title,
        book_author=book.author,
        context_block=context_block,
    )
    return system, user_prompt


def _chat_completion(
    *,
    model: str,
    system: str,
    user_prompt: str,
    temperature: float,
    timeout: float | None = None,
    max_tokens: int | None = None,
) -> tuple[str, dict[str, int]]:
    url = f"{settings.resolved_llm_base_url}/chat/completions"
    api_key = settings.resolved_llm_api_key
    if not api_key:
        if settings.is_openai_cloud:
            raise RuntimeError("OPENAI_API_KEY / LLM_API_KEY is required for OpenAI cloud.")
        api_key = "local"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
    }
    if max_tokens is not None:
        body["max_tokens"] = max_tokens

    read_timeout = float(timeout if timeout is not None else settings.llm_timeout_seconds)
    http_timeout = httpx.Timeout(
        connect=10.0,
        read=read_timeout,
        write=30.0,
        pool=10.0,
    )
    try:
        with httpx.Client(timeout=http_timeout) as client:
            response = client.post(url, headers=headers, json=body)
            if response.status_code >= 400:
                detail = response.text[:800]
                raise RuntimeError(
                    f"LLM HTTP {response.status_code} at {url}: {detail}"
                )
            payload = response.json()
    except httpx.TimeoutException as exc:
        raise TimeoutError(
            f"LLM request timed out after {read_timeout:.0f}s"
        ) from exc

    choices = payload.get("choices") or []
    if not choices:
        raise RuntimeError(f"LLM response missing choices: {payload!r}"[:500])
    message = choices[0].get("message") or {}
    text = (message.get("content") or "").strip()
    if not text:
        raise RuntimeError("LLM returned empty content.")
    usage_raw = payload.get("usage") or {}
    input_t = int(usage_raw.get("prompt_tokens") or 0)
    output_t = int(usage_raw.get("completion_tokens") or 0)
    total_t = int(usage_raw.get("total_tokens") or 0)
    if total_t <= 0:
        total_t = input_t + output_t
    if total_t <= 0:
        total_t = max(1, len(text.split()))
        input_t = estimate_tokens(system, user_prompt)
        output_t = max(1, total_t - input_t)
    return text, {
        "input_tokens": input_t,
        "output_tokens": output_t,
        "total_tokens": total_t,
    }


def _chat_completion_stream(
    *,
    model: str,
    system: str,
    user_prompt: str,
    temperature: float,
    usage_out: dict[str, int] | None = None,
):
    """Yield text deltas from an OpenAI-compatible streaming chat completion."""
    import json

    url = f"{settings.resolved_llm_base_url}/chat/completions"
    api_key = settings.resolved_llm_api_key
    if not api_key:
        if settings.is_openai_cloud:
            raise RuntimeError("OPENAI_API_KEY / LLM_API_KEY is required for OpenAI cloud.")
        api_key = "local"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    body: dict = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "stream": True,
        "stream_options": {"include_usage": True},
    }

    with httpx.Client(timeout=settings.llm_timeout_seconds) as client:
        with client.stream("POST", url, headers=headers, json=body) as response:
            if response.status_code >= 400:
                detail = response.read().decode("utf-8", errors="replace")[:800]
                raise RuntimeError(
                    f"LLM HTTP {response.status_code} at {url}: {detail}"
                )
            for line in response.iter_lines():
                if not line:
                    continue
                if line.startswith("data:"):
                    data = line[5:].strip()
                else:
                    data = line.strip()
                if not data or data == "[DONE]":
                    if data == "[DONE]":
                        break
                    continue
                try:
                    payload = json.loads(data)
                except json.JSONDecodeError:
                    continue

                usage_raw = payload.get("usage")
                if usage_out is not None and isinstance(usage_raw, dict):
                    input_t = int(usage_raw.get("prompt_tokens") or 0)
                    output_t = int(usage_raw.get("completion_tokens") or 0)
                    total_t = int(usage_raw.get("total_tokens") or 0)
                    if total_t > 0 or input_t > 0 or output_t > 0:
                        usage_out["input_tokens"] = input_t
                        usage_out["output_tokens"] = output_t
                        usage_out["total_tokens"] = total_t or (input_t + output_t)

                choices = payload.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                piece = delta.get("content") or ""
                if piece:
                    yield piece


def _build_user_prompt(
    action: str,
    prompt: str,
    selection: str,
    language: str,
    *,
    book_title: str = "",
    book_author: str = "",
    prior_context: str = "",
    context_block: str = "",
) -> str:
    book_line = f'Book title: "{book_title}". Author: "{book_author or "unknown"}".'
    ctx = context_block or prior_context
    context_section = f"\n\n{ctx}" if ctx else ""
    if action == "start":
        return (
            f"{book_line}{context_section}\n"
            f"A beginner wants to start their first chapter in {language}.\n"
            f"Idea / synopsis:\n{prompt}\n\n"
            "Write Chapter 1 as readable prose (800–1200 words if possible), "
            "with a clear opening, character presence, and a hook for the next chapter."
        )
    if action == "outline":
        return (
            f"{book_line}{context_section}\n"
            f"Create a simple chapter outline in {language} for this book idea:\n{prompt}\n\n"
            "Return 6–10 numbered chapter titles with one short sentence each. "
            "Keep it friendly for a first-time author."
        )
    if action == "generate":
        return (
            f"{book_line}{context_section}\n"
            f"Write a new chapter section in {language}.\nBrief from the author:\n{prompt}"
        )
    if action == "continue":
        tail = "" if context_section else f"\n\nContext:\n{selection or prompt}"
        return (
            f"{book_line}{context_section}\n"
            f"Continue this manuscript naturally in {language}, matching established voice."
            f"{tail}\n\n"
            "Write the next 2–4 paragraphs only."
        )
    if action == "rewrite":
        passage = "" if context_section else f"\n\nSelection:\n{selection}"
        return (
            f"{book_line}{context_section}\n"
            f"Rewrite the selection in {language}, improving clarity and rhythm "
            f"without changing plot.{passage}\n\nNotes: {prompt}"
        )
    if action == "tone":
        passage = "" if context_section else f"\n\nSelection:\n{selection}"
        return (
            f"{book_line}{context_section}\n"
            f"Adjust the tone of the selection in {language}. "
            f"Desired tone: {prompt or 'warmer and clearer'}.{passage}"
        )
    if action == "dialogue":
        passage = "" if context_section else f"\n\nPassage:\n{selection or prompt}"
        return (
            f"{book_line}{context_section}\n"
            f"Improve or add natural dialogue in {language} for this passage.{passage}\n\n"
            "Return the revised passage only."
        )
    if action == "simplify":
        passage = "" if context_section else f"\n\nPassage:\n{selection or prompt}"
        return (
            f"{book_line}{context_section}\n"
            f"Rewrite this passage in simpler, clearer {language} for a general reader.{passage}"
        )
    if action == "consistent":
        passage = "" if context_section else f"\n\nSelection:\n{selection or prompt}"
        return (
            f"{book_line}{context_section}\n"
            f"Revise the selection in {language} so it matches the book's established "
            "voice, POV, tone, and continuity with earlier chapters.\n"
            "Preserve plot facts and character names. Improve only diction, rhythm, and consistency."
            f"{passage}\n\n"
            f"Author notes (optional): {prompt or '(none)'}"
        )
    if action == "finalize":
        chapter_text = "" if context_section else f"\n\nChapter text so far:\n{selection or prompt}"
        return (
            f"{book_line}{context_section}\n"
            f"Read the chapter text below carefully in {language}. "
            "Write a satisfying chapter ending (desfecho) that resolves the emotional beat "
            "of this chapter, closes the scene, and leaves a soft hook for what may come next—"
            "without starting a new chapter title.\n\n"
            "Return only the concluding paragraphs (about 2–5), ready to append at the end.\n\n"
            f"Author notes (optional): {prompt or '(none)'}"
            f"{chapter_text}"
        )
    return prompt


def _offline_result(
    action: str,
    prompt: str,
    selection: str,
    language: str,
    book_title: str = "",
) -> str:
    idea = (prompt or selection or "uma história por contar").strip()
    title = book_title or "Sem título"
    hint = (
        "Configure LLM_BASE_URL + LLM_API_KEY (or OPENAI_API_KEY) "
        "for OpenAI or a local OpenAI-compatible server."
    )
    if language.startswith("Portuguese") or language == "Brazilian Portuguese":
        if action == "outline":
            return (
                "1. O chamado — O protagonista sente que a vida precisa mudar.\n"
                "2. A porta — Um encontro inesperado abre o caminho.\n"
                "3. A dúvida — Medo e coragem disputam a decisão.\n"
                "4. A travessia — Os primeiros passos fora do conhecido.\n"
                "5. O espelho — Uma verdade difícil vem à tona.\n"
                "6. A escolha — O final deste arco e o começo do próximo.\n\n"
                f"(Rascunho local para “{title}”: {idea})"
            )
        if action in {"start", "generate"}:
            return (
                f"Na manhã em que tudo começou, o mundo de “{title}” ainda parecia comum.\n\n"
                f"{idea[0].upper() + idea[1:] if idea else 'A ideia ainda esperava nascer.'} "
                "As ruas estavam quietas, mas havia um detalhe fora do lugar: "
                "uma carta sem remetente, um olhar demorado, uma pergunta sem resposta.\n\n"
                "— Se eu seguir, não volto igual — murmurou a personagem principal.\n\n"
                "E assim, sem saber o tamanho da jornada, deu o primeiro passo.\n\n"
                f"(Texto de demonstração local. {hint})"
            )
        if action == "continue":
            base = selection.strip() or idea
            return (
                f"{base}\n\n"
                "O silêncio que veio depois não era vazio: era expectativa. "
                "Cada detalhe do ambiente ganhava peso, como se a história "
                "tivesse finalmente encontrado o ritmo certo."
            )
        if action == "consistent":
            return (
                f"{(selection or idea).strip()}\n\n"
                "(Versão alinhada ao perfil do livro — modo local.)"
            )
        if action == "finalize":
            return (
                "A noite fechou o arco daquele dia com a sensação de que algo "
                "importante havia sido dito, mesmo sem palavras demais.\n\n"
                "A personagem principal ficou quieta por um instante, "
                "como quem guarda um segredo e, ao mesmo tempo, se prepara para o próximo passo.\n\n"
                "E assim o capítulo se encerrou—não como um fim absoluto, "
                "mas como uma porta deixada entreaberta."
            )
        return (
            f"{(selection or idea).strip()}\n\n"
            f"(Versão revisada em modo local — {hint})"
        )

    if action == "outline":
        return (
            "1. The spark — Something small unsettles everyday life.\n"
            "2. The invitation — An unexpected chance appears.\n"
            "3. The hesitation — Fear and hope compete.\n"
            "4. The crossing — First steps into the unknown.\n"
            "5. The mirror — A difficult truth surfaces.\n"
            "6. The turn — This arc ends; the next begins.\n\n"
            f"(Local outline for “{title}”: {idea})"
        )
    if action in {"start", "generate"}:
        return (
            f"On the morning everything changed, “{title}” still looked ordinary.\n\n"
            f"{idea} The quiet held a single wrong note: a letter with no sender, "
            "a lingering glance, a question without an answer.\n\n"
            "“If I go, I won’t come back the same,” the protagonist whispered.\n\n"
            "And so the first step was taken.\n\n"
            f"(Local demo text. {hint})"
        )
    if action == "finalize":
        return (
            "Night closed the arc of that day with the feeling that something "
            "important had been said, even with few words.\n\n"
            "The protagonist stayed quiet for a moment, "
            "like someone holding a secret and getting ready for the next step.\n\n"
            "And so the chapter ended—not as an absolute finish, "
            "but as a door left slightly open."
        )
    return (
        f"{(selection or idea).strip()}\n\n"
        f"(Local AI revision — {hint})"
    )
