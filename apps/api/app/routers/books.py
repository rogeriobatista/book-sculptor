from __future__ import annotations

from datetime import datetime, timezone
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import delete
from sqlmodel import Session, select

from app.access import assert_can_edit, get_book_role, get_owned_book, plan_allows_new_book
from app.auth import CurrentUser
from app.db import get_session
from app.db_models import AiJob, Book, BookMember, Chapter, ChapterActivity, ChapterComment, ChapterVersion, ExportJob, MarketplaceListing, User
from app.i18n_labels import normalize_locale
from app.layout import LayoutSettings, layout_options_payload
from app.preview import diagnostic_payload, preview_payload
from app.schemas import BookCreate, BookOut, BookUpdate, CoverGenerateBody
from app.services.book_builder import load_domain_book, settings_from_book
from app.services.import_service import import_files_into_book

router = APIRouter(prefix="/books", tags=["books"])
logger = logging.getLogger(__name__)


def _book_out(session: Session, book: Book, user: User | None = None) -> BookOut:
    count = len(session.exec(select(Chapter).where(Chapter.book_id == book.id)).all())
    role = get_book_role(session, user, book) if user else "owner"
    return BookOut(
        id=book.id,
        title=book.title,
        author=book.author,
        locale=book.locale,
        mode=book.mode,
        settings=book.settings_json or {},
        chapter_count=count,
        my_role=role,
        cover_url=book.cover_url,
        cover_source=book.cover_source,
        cover_prompt=book.cover_prompt,
    )


@router.get("/options")
def options() -> dict:
    return layout_options_payload()


@router.get("", response_model=list[BookOut])
def list_books(
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> list[BookOut]:
    owned = session.exec(select(Book).where(Book.owner_id == user.id)).all()
    member_ids = [
        m.book_id
        for m in session.exec(select(BookMember).where(BookMember.user_id == user.id)).all()
    ]
    shared = []
    if member_ids:
        shared = list(session.exec(select(Book).where(Book.id.in_(member_ids))).all())
    books = {b.id: b for b in [*owned, *shared]}
    return [_book_out(session, b, user) for b in books.values()]


@router.post("", response_model=BookOut)
def create_book(
    body: BookCreate,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> BookOut:
    plan_allows_new_book(session, user)
    settings = LayoutSettings().to_dict()
    book = Book(
        owner_id=user.id,
        title=body.title.strip() or "Untitled",
        author=body.author.strip(),
        locale=normalize_locale(body.locale),
        mode=body.mode,
        settings_json=settings,
    )
    session.add(book)
    session.commit()
    session.refresh(book)
    session.add(BookMember(book_id=book.id, user_id=user.id, role="owner"))
    session.commit()
    return _book_out(session, book, user)


@router.get("/{book_id}", response_model=BookOut)
def get_book(
    book_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> BookOut:
    book = get_owned_book(session, user, book_id)
    return _book_out(session, book, user)


@router.patch("/{book_id}", response_model=BookOut)
def update_book(
    book_id: str,
    body: BookUpdate,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> BookOut:
    book = get_owned_book(session, user, book_id)
    assert_can_edit(session, user, book)
    if body.title is not None:
        book.title = body.title.strip() or book.title
    if body.author is not None:
        book.author = body.author.strip()
    if body.locale is not None:
        book.locale = normalize_locale(body.locale)
    if body.mode is not None:
        book.mode = body.mode
    if body.settings is not None:
        book.settings_json = LayoutSettings.from_dict(body.settings).to_dict()
    book.updated_at = datetime.now(timezone.utc)
    session.add(book)
    session.commit()
    session.refresh(book)
    return _book_out(session, book, user)


@router.post("/{book_id}/cover", response_model=BookOut)
async def upload_cover(
    book_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
    file: UploadFile = File(...),
) -> BookOut:
    from app.services.cover_service import save_cover_bytes

    book = get_owned_book(session, user, book_id)
    assert_can_edit(session, user, book)
    data = await file.read()
    content_type = (file.content_type or "application/octet-stream").lower()
    save_cover_bytes(
        book,
        user_id=user.id,
        data=data,
        content_type=content_type,
        source="upload",
    )
    session.add(book)
    session.commit()
    session.refresh(book)
    return _book_out(session, book, user)


@router.post("/{book_id}/cover/generate", response_model=BookOut)
def generate_cover(
    book_id: str,
    body: CoverGenerateBody,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> BookOut:
    from app.services.cover_service import generate_cover_image

    book = get_owned_book(session, user, book_id)
    assert_can_edit(session, user, book)
    generate_cover_image(
        session,
        user=user,
        book=book,
        prompt=body.prompt or "",
        style=body.style or "literary",
    )
    session.refresh(book)
    return _book_out(session, book, user)


@router.delete("/{book_id}/cover", response_model=BookOut)
def delete_cover(
    book_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> BookOut:
    from app.services.cover_service import clear_cover

    book = get_owned_book(session, user, book_id)
    assert_can_edit(session, user, book)
    clear_cover(book)
    book.updated_at = datetime.now(timezone.utc)
    session.add(book)
    session.commit()
    session.refresh(book)
    return _book_out(session, book, user)


@router.delete("/{book_id}")
def delete_book(
    book_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    book = get_owned_book(session, user, book_id)
    if book.owner_id != user.id:
        raise HTTPException(403, "Only the owner can delete this book.")
    _delete_book_cascade(session, book)
    session.commit()
    return {"ok": True}


def _delete_book_cascade(session: Session, book: Book) -> None:
    """Remove book and all dependent rows (versions, exports, AI jobs, etc.)."""
    if book.cover_key:
        from app.storage import delete_key

        delete_key(book.cover_key)
    chapter_ids = [
        row.id
        for row in session.exec(select(Chapter).where(Chapter.book_id == book.id)).all()
    ]
    if chapter_ids:
        session.execute(
            delete(ChapterVersion).where(ChapterVersion.chapter_id.in_(chapter_ids))
        )
    session.execute(delete(ChapterVersion).where(ChapterVersion.book_id == book.id))
    session.execute(delete(ChapterComment).where(ChapterComment.book_id == book.id))
    session.execute(delete(ChapterActivity).where(ChapterActivity.book_id == book.id))
    session.execute(delete(Chapter).where(Chapter.book_id == book.id))
    session.execute(delete(ExportJob).where(ExportJob.book_id == book.id))
    session.execute(delete(AiJob).where(AiJob.book_id == book.id))
    session.execute(delete(MarketplaceListing).where(MarketplaceListing.book_id == book.id))
    session.execute(delete(BookMember).where(BookMember.book_id == book.id))
    session.flush()
    session.delete(book)
    session.flush()


@router.post("/{book_id}/import")
async def import_files(
    book_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
    files: list[UploadFile] = File(...),
    replace: str = Form("false"),
    use_ai_structure: str = Form("true"),
) -> dict:
    """Import one or more PDF/DOCX files into the book.

    Each file is structure-detected (prologue/chapters/epilogue).
    When ``replace`` is false (default), new chapters are appended.
    When true, existing chapters are removed first.
    When ``use_ai_structure`` is true (Pro/Studio), ambiguous headings are
    refined with AI after local heuristics.
    """
    book = get_owned_book(session, user, book_id)
    assert_can_edit(session, user, book)
    replace_flag = str(replace).strip().lower() in {"1", "true", "yes", "on"}
    ai_flag = str(use_ai_structure).strip().lower() in {"1", "true", "yes", "on"}
    if user.plan == "free":
        ai_flag = False
    payloads: list[tuple[str, bytes]] = []
    for upload in files:
        raw_name = (upload.filename or "manuscript.docx").strip() or "manuscript.docx"
        payloads.append((raw_name, await upload.read()))
    if not payloads or all(not data for _, data in payloads):
        raise HTTPException(400, "No file content received.")
    try:
        chapters = import_files_into_book(
            session,
            book,
            payloads,
            replace=replace_flag,
            user=user,
            use_ai_structure=ai_flag,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Import failed for book %s", book_id)
        raise HTTPException(
            500,
            f"Import failed: {exc}",
        ) from exc
    session.refresh(book)
    return {
        "book": _book_out(session, book, user),
        "chapters": [
            {
                "id": c.id,
                "title": c.title,
                "kind": c.kind,
                "position": c.position,
                "full_label": c.full_label,
            }
            for c in chapters
        ],
    }


@router.get("/{book_id}/preview")
def preview(
    book_id: str,
    user: CurrentUser,
    session: Session = Depends(get_session),
) -> dict:
    book = get_owned_book(session, user, book_id)
    domain = load_domain_book(session, book)
    if not domain.chapters:
        raise HTTPException(400, "Add or import chapters before preview.")
    settings = settings_from_book(book)
    payload = preview_payload(domain, settings)
    payload["diagnostic"] = diagnostic_payload(domain)
    payload["book_meta"] = _book_out(session, book, user).model_dump()
    return payload
