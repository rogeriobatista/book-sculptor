"""Background worker: processes queued export jobs."""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

# Allow importing the API package
API_ROOT = Path(__file__).resolve().parents[1] / "api"
sys.path.insert(0, str(API_ROOT))

from sqlmodel import Session, select  # noqa: E402

from app.db import engine, init_db  # noqa: E402
from app.db_models import ExportJob  # noqa: E402
from app.services.export_runner import process_export_job  # noqa: E402


def poll_once() -> int:
    processed = 0
    with Session(engine) as session:
        jobs = session.exec(
            select(ExportJob)
            .where(ExportJob.status == "queued")
            .order_by(ExportJob.created_at)
            .limit(5)
        ).all()
        ids = [j.id for j in jobs]
    for job_id in ids:
        with Session(engine) as session:
            process_export_job(session, job_id)
            processed += 1
    return processed


def main() -> None:
    init_db()
    interval = float(os.environ.get("WORKER_POLL_SECONDS", "3"))
    print("Book Sculptor worker started", flush=True)
    while True:
        try:
            n = poll_once()
            if n:
                print(f"Processed {n} export job(s)", flush=True)
        except Exception as exc:  # noqa: BLE001
            print(f"Worker error: {exc}", flush=True)
        time.sleep(interval)


if __name__ == "__main__":
    main()
