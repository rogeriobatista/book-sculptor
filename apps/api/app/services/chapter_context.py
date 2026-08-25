"""Prior-chapter context for AI copilot consistency.

Deprecated: use book_context.build_writing_context instead.
Kept for backward-compatible imports.
"""

from app.services.book_context import prior_chapters_context

__all__ = ["prior_chapters_context"]
