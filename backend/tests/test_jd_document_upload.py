"""
"Upload File" option of the New Job Role form: POST /api/admin/job-roles/extract-description.
Real PDF / DOCX / TXT documents are generated in memory; nothing is stored and no role / blueprint is created by the upload.
"""
import io
import zipfile

import pypdf
import pytest

import database
import models
import utils
from services import jd_document_service as svc
from tests import recruitment_helpers as h

client = h.client
URL = "/api/admin/job-roles/extract-description"

JD_LINES = ["Backend Engineer", "Responsibilities:", "Build Python and FastAPI services", "Design REST APIs", "Requirements: 3+ years of SQL"]


def make_pdf(lines):
    """A minimal, valid single-page text PDF (Helvetica) with correct xref offsets."""
    stream_lines = ["BT", "/F1 12 Tf", "14 TL", "50 750 Td"]
    for line in lines:
        stream_lines.append("(" + line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") + ") Tj T*")
    stream_lines.append("ET")
    stream = "\n".join(stream_lines).encode("latin-1")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(out.tell())
        out.write(f"{i} 0 obj\n".encode() + body + b"\nendobj\n")
    xref = out.tell()
    out.write(f"xref\n0 {len(objs) + 1}\n".encode() + b"0000000000 65535 f \n")
    for off in offsets:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return out.getvalue()


def blank_pdf(encrypt=None):
    writer = pypdf.PdfWriter()
    writer.add_blank_page(612, 792)       # a "scanned" page: no text operators at all
    if encrypt:
        writer.encrypt(encrypt)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def make_docx(paragraphs, bullets=(), extra=None):
    ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    body = []
    for text in paragraphs:
        num = "<w:pPr><w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"1\"/></w:numPr></w:pPr>" if text in bullets else ""
        body.append(f"<w:p>{num}<w:r><w:t xml:space=\"preserve\">{text}</w:t></w:r></w:p>")
    doc = f'<?xml version="1.0" encoding="UTF-8"?><w:document {ns}><w:body>{"".join(body)}</w:body></w:document>'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        z.writestr("word/document.xml", extra if extra is not None else doc)
    return buf.getvalue()


@pytest.fixture()
def db():
    session = database.SessionLocal()
    yield session
    session.close()


@pytest.fixture()
def admin(db):
    return h.make_admin(db, tag=h.new_tag())


def upload(token, name, data, content_type="application/octet-stream"):
    return client.post(URL, headers=h.auth(token), files={"file": (name, data, content_type)})


# ------------------------------------------------------------------ successful extraction
def test_txt_extraction_keeps_lines_and_bullets(admin):
    res = upload(admin["token"], "jd.txt", "Backend Engineer\r\n\r\n\r\n\r\n• Build APIs\r\n- Own   reliability today\r\n".encode("utf-8"))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["text"] == "Backend Engineer\n\n• Build APIs\n- Own reliability today"
    assert body["file_type"] == "txt" and body["filename"] == "jd.txt" and body["characters"] == len(body["text"])


def test_txt_utf8_bom_and_cp1252_are_decoded(admin):
    assert upload(admin["token"], "a.txt", b"\xef\xbb\xbfSenior Engineer \xe2\x80\x93 Remote").json()["text"] == "Senior Engineer – Remote"
    assert upload(admin["token"], "b.txt", "Café lead".encode("cp1252")).json()["text"] == "Café lead"


def test_pdf_extraction(admin):
    res = upload(admin["token"], "Job Description.PDF", make_pdf(JD_LINES), "application/pdf")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["file_type"] == "pdf" and body["pages"] == 1
    for line in JD_LINES:
        assert line in body["text"]
    assert body["text"].index("Responsibilities") < body["text"].index("Requirements")


def test_docx_extraction_keeps_paragraphs_and_marks_bullets(admin):
    data = make_docx(["Backend Engineer", "Build Python services", "Own reliability", "3+ years of SQL"], bullets=("Build Python services", "Own reliability"))
    res = upload(admin["token"], "jd.docx", data)
    assert res.status_code == 200, res.text
    assert res.json()["text"] == "Backend Engineer\n• Build Python services\n• Own reliability\n3+ years of SQL"
    assert res.json()["file_type"] == "docx"


def test_filename_is_reduced_to_a_safe_display_name(admin):
    res = upload(admin["token"], "../../etc/pass\x00wd\\evil.txt", b"Backend Engineer")
    assert res.status_code == 200
    assert res.json()["filename"] == "evil.txt"


# ------------------------------------------------------------------ rejected input
@pytest.mark.parametrize("name,data", [("empty.txt", b""), ("spaces.txt", b"   \n\n  \t "), ("empty.docx", make_docx([""])), ])
def test_empty_documents_are_rejected(admin, name, data):
    res = upload(admin["token"], name, data)
    assert res.status_code == 422
    assert "empty" in res.json()["detail"].lower() or "no text" in res.json()["detail"].lower()


def test_scanned_pdf_without_text_explains_ocr(admin):
    res = upload(admin["token"], "scan.pdf", blank_pdf())
    assert res.status_code == 422
    assert "OCR" in res.json()["detail"] and "scanned" in res.json()["detail"]


def test_password_protected_pdf_is_rejected(admin):
    res = upload(admin["token"], "locked.pdf", blank_pdf(encrypt="secret"))
    assert res.status_code == 422
    assert "password" in res.json()["detail"].lower()


@pytest.mark.parametrize("name", ["resume.doc", "notes.rtf", "photo.png", "run.exe", "page.html", "noextension", "archive.zip"])
def test_unsupported_types_are_rejected(admin, name):
    res = upload(admin["token"], name, b"Backend Engineer")
    assert res.status_code == 415
    assert ".pdf" in res.json()["detail"]


def test_legacy_doc_gets_a_specific_hint(admin):
    res = upload(admin["token"], "old.doc", b"\xd0\xcf\x11\xe0")
    assert res.status_code == 415 and ".docx" in res.json()["detail"]


def test_file_larger_than_the_limit_is_rejected(admin):
    res = upload(admin["token"], "huge.txt", b"a" * (svc.MAX_UPLOAD_BYTES + 1))
    assert res.status_code == 413
    assert "10 MB" in res.json()["detail"]
    assert upload(admin["token"], "ok.txt", b"a" * 5000).status_code == 200      # a normal size still works


def test_text_longer_than_the_job_description_limit_is_rejected_not_truncated(admin):
    res = upload(admin["token"], "long.txt", ("Responsibility line.\n" * 1500).encode())
    assert res.status_code == 422 and "20,000" in res.json()["detail"]


@pytest.mark.parametrize("name,data", [
    ("bad.pdf", b"%PDF-1.4\n1 0 obj << /Broken"),                           # truncated / corrupted PDF
    ("garbage.pdf", bytes(range(256)) * 20),                                  # not a PDF at all
    ("garbage.docx", bytes(range(256)) * 20),                                 # not a zip
    ("bad.docx", b"PK\x03\x04" + b"\x00" * 64),                               # zip signature, corrupt body
    ("fake.txt", b"%PDF-1.4 hello"),                                          # a PDF renamed to .txt
    ("fake2.txt", b"PK\x03\x04abcd"),                                         # a zip renamed to .txt
    ("binary.txt", b"abc\x00\x01\x02def" * 10),                               # binary content in a .txt
    ("renamed.pdf", b"Backend Engineer needed"),                              # text renamed to .pdf
])
def test_corrupted_or_mislabelled_files_are_rejected_with_a_clear_message(admin, name, data):
    res = upload(admin["token"], name, data)
    assert res.status_code == 422, (name, res.text)
    detail = res.json()["detail"]
    assert isinstance(detail, str) and detail
    assert "Traceback" not in detail and "pypdf" not in detail and "Error(" not in detail


def test_docx_missing_its_main_document_and_xml_bombs_are_rejected(admin):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("hello.txt", "x")
    assert upload(admin["token"], "notword.docx", buf.getvalue()).status_code == 422
    bomb = ('<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]>'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>&b;</w:t></w:r></w:p></w:body></w:document>')
    res = upload(admin["token"], "bomb.docx", make_docx([], extra=bomb))
    assert res.status_code == 422 and "unsupported" in res.json()["detail"].lower()


def test_missing_file_part_is_a_validation_error(admin):
    assert client.post(URL, headers=h.auth(admin["token"])).status_code == 422


# ------------------------------------------------------------------ access control / tenancy / statelessness
def test_unauthenticated_and_non_admin_uploads_are_refused(db, admin):
    assert client.post(URL, files={"file": ("jd.txt", b"Backend Engineer", "text/plain")}).status_code == 401
    assert client.post(URL, headers={"Authorization": "Bearer not-a-token"}, files={"file": ("jd.txt", b"x", "text/plain")}).status_code == 401
    org = admin["org"]
    student = models.User(email=f"stu.{h.new_tag()}@rwtest.com", hashed_password="x", role=models.UserRole.STUDENT, organization_id=org.id)
    candidate = models.User(email=f"cand.{h.new_tag()}@rwtest.com", hashed_password="x", role=models.UserRole.CANDIDATE, organization_id=org.id)
    db.add_all([student, candidate])
    db.commit()
    for user in (student, candidate):
        token = utils.create_access_token(data={"sub": user.email, "role": user.role})
        assert upload(token, "jd.txt", b"Backend Engineer").status_code in (401, 403)
    inactive = h.make_admin(db, tag=h.new_tag(), active=False)
    assert upload(inactive["token"], "jd.txt", b"Backend Engineer").status_code in (401, 403)


def test_upload_is_stateless_and_creates_nothing(db, admin):
    org_id = admin["org"].id
    before_roles = db.query(models.JobDescription).filter(models.JobDescription.organization_id == org_id).count()
    before_logs = db.query(models.ActivityLog).filter(models.ActivityLog.organization_id == org_id).count()
    res = upload(admin["token"], "jd.txt", h.JD_TEXT.encode())
    assert res.status_code == 200
    db.expire_all()
    assert db.query(models.JobDescription).filter(models.JobDescription.organization_id == org_id).count() == before_roles, "no job role is created"
    assert db.query(models.ActivityLog).filter(models.ActivityLog.organization_id == org_id).count() == before_logs
    assert set(res.json()) == {"text", "filename", "file_type", "pages", "characters", "size_bytes"}, "only the extracted text and basic metadata come back"


def test_extracted_text_creates_a_role_through_the_normal_flow_and_stays_in_its_tenant(db, admin, monkeypatch):
    other = h.make_admin(db, tag=h.new_tag())
    extracted = upload(admin["token"], "jd.docx", make_docx([h.JD_TEXT, "Build Python services"], bullets=("Build Python services",))).json()["text"]
    edited = extracted + "\nNice to have: Docker"                                   # the admin edits before submitting
    created = client.post("/api/admin/job-roles/", headers=h.auth(admin["token"]),
                          json={"title": "Backend Engineer", "description": edited})
    assert created.status_code == 201, created.text
    role = created.json()
    assert role["status"] == "DRAFT" and not role["blueprint"], "no blueprint is generated and nothing is published by the upload or the create"
    assert role["share_path"] is None
    assert "• Build Python services" in client.get(f"/api/admin/job-roles/{role['id']}", headers=h.auth(admin["token"])).json()["description"]
    assert client.get(f"/api/admin/job-roles/{role['id']}", headers=h.auth(other["token"])).status_code == 404
    assert all(r["id"] != role["id"] for r in client.get("/api/admin/job-roles/", headers=h.auth(other["token"])).json())
    # the same JD typed by hand yields an identical role (same endpoint, same validation)
    manual = client.post("/api/admin/job-roles/", headers=h.auth(admin["token"]), json={"title": "Backend Engineer", "description": edited})
    assert manual.status_code == 201 and manual.json()["description"] == role["description"]


def test_blueprint_generation_is_not_triggered_by_the_upload(db, admin, monkeypatch):
    calls = h.patch_gemini_blueprint(monkeypatch)
    assert upload(admin["token"], "jd.txt", h.JD_TEXT.encode()).status_code == 200
    assert calls["n"] == 0
