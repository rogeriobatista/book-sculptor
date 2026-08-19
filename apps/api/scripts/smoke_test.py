import time
from pathlib import Path

import httpx

base = "http://127.0.0.1:8000"
headers = {"Authorization": "Bearer dev:user_demo:demo@example.com"}
client = httpx.Client(base_url=base, headers=headers, timeout=120.0)

print("health", client.get("/health").json())
me = client.get("/api/v1/me")
print("me", me.status_code, me.json())

book = client.post(
    "/api/v1/books",
    json={"title": "Ashen Crown", "author": "Demo", "locale": "en", "mode": "book"},
)
print("create", book.status_code, book.json())
book.raise_for_status()
bid = book.json()["id"]

pdf = Path(__file__).resolve().parents[3] / "Ashen Crown.pdf"
if pdf.exists():
    files = [("files", (pdf.name, pdf.read_bytes(), "application/pdf"))]
    imp = client.post(f"/api/v1/books/{bid}/import", files=files)
    print("import", imp.status_code)
    imp.raise_for_status()
    print("chapters", len(imp.json().get("chapters", [])))
else:
    ch = client.post(
        f"/api/v1/books/{bid}/chapters",
        json={
            "title": "Opening",
            "kind": "chapter",
            "number": 1,
            "content_text": "Once upon a time.\n\n— Hello, said the knight.",
        },
    )
    print("chapter", ch.status_code)
    ch.raise_for_status()

prev = client.get(f"/api/v1/books/{bid}/preview")
print(
    "preview",
    prev.status_code,
    "pages",
    len(prev.json().get("pages", [])) if prev.status_code == 200 else prev.text[:200],
)
prev.raise_for_status()

ex = client.post(f"/api/v1/books/{bid}/exports", json={"format": "pdf"})
print("export create", ex.status_code, ex.json())
ex.raise_for_status()
eid = ex.json()["id"]
status = ex.json()
for _ in range(40):
    time.sleep(0.5)
    status = client.get(f"/api/v1/exports/{eid}").json()
    if status["status"] in {"ready", "failed"}:
        break
print("export final", status)
print("books", client.get("/api/v1/books").json())
