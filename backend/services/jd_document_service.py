"""
Job-description document -> plain text (Admin "Upload File" option on the New Job Role form).

Everything happens in memory: the upload is never written to disk, never executed and never stored. The file type is decided
from the CONTENT (magic bytes / zip structure), not from the extension alone, and the extension must agree with it.
Only text comes out; the caller (the admin) reviews and edits it before the job role is created.
"""
import io
import re
import unicodedata
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from typing import Optional

import pypdf
from pypdf.errors import PyPdfError

MAX_UPLOAD_BYTES = 10 * 1024 * 1024            # 10 MB (the proxies in front of the API allow 25-50 MB)
MAX_TEXT_CHARS = 20000                         # same ceiling as the job-role description column / API
ALLOWED_EXTENSIONS = (".pdf", ".docx", ".txt")
MAX_PDF_PAGES = 100
MAX_DOCX_XML_BYTES = 20 * 1024 * 1024          # decompressed size of word/document.xml (zip-bomb guard)
MAX_DOCX_ENTRIES = 2000

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


class DocumentError(Exception):
    """A user-facing extraction problem. `status_code` is the HTTP status the API should answer with."""

    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


@dataclass
class ExtractedDocument:
    text: str
    file_type: str          # "pdf" | "docx" | "txt"
    pages: Optional[int] = None


def safe_filename(name: Optional[str]) -> str:
    """Display-only name: no directories, no control characters. The file itself is never written anywhere."""
    base = re.split(r"[\\/]", name or "")[-1]
    base = "".join(ch for ch in base if unicodedata.category(ch)[0] != "C").strip()
    return base[:150] or "document"


def extension_of(name: Optional[str]) -> str:
    base = safe_filename(name).lower()
    return base[base.rfind("."):] if "." in base else ""


def normalize_text(raw: str) -> str:
    """Tidy whitespace without destroying structure: line breaks, bullets, numbering and headings are kept."""
    text = unicodedata.normalize("NFC", raw)
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\f", "\n")
    text = text.replace(" ", " ").replace("​", "").replace("﻿", "").replace(" ", "\n").replace(" ", "\n\n")
    text = "".join(ch for ch in text if ch in "\n\t" or unicodedata.category(ch)[0] != "C")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ------------------------------------------------------------------------------ type detection
def _looks_like_pdf(data: bytes) -> bool:
    return data[:1024].lstrip(b"\x00\t\r\n ").startswith(b"%PDF-")


def _looks_like_zip(data: bytes) -> bool:
    return data[:4] in (b"PK\x03\x04", b"PK\x05\x06")


def _decode_text(data: bytes) -> str:
    if b"\x00" in data and not (data.startswith(b"\xff\xfe") or data.startswith(b"\xfe\xff")):
        raise DocumentError("This file does not look like a plain-text document. Upload a .txt, .pdf or .docx file.")
    if data.startswith(b"\xef\xbb\xbf"):
        return data[3:].decode("utf-8")
    if data.startswith(b"\xff\xfe") or data.startswith(b"\xfe\xff"):
        return data.decode("utf-16")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return data.decode("cp1252")        # common for text saved by older Windows tools
        except UnicodeDecodeError:
            raise DocumentError("The text file could not be decoded. Save it as UTF-8 and try again.")


# ------------------------------------------------------------------------------ extractors
def _extract_pdf(data: bytes) -> ExtractedDocument:
    try:
        reader = pypdf.PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted:
            try:
                if not reader.decrypt(""):
                    raise DocumentError("This PDF is password protected. Remove the password and upload it again.")
            except DocumentError:
                raise
            except Exception:
                raise DocumentError("This PDF is password protected. Remove the password and upload it again.")
        page_count = len(reader.pages)
        if page_count == 0:
            raise DocumentError("This PDF has no pages.")
        if page_count > MAX_PDF_PAGES:
            raise DocumentError(f"This PDF has {page_count} pages. Upload a job description of at most {MAX_PDF_PAGES} pages.")
        parts = []
        for page in reader.pages:
            parts.append(page.extract_text() or "")
    except DocumentError:
        raise
    except (PyPdfError, ValueError, KeyError, TypeError, IndexError, AttributeError, RecursionError, OSError, NotImplementedError):
        raise DocumentError("This PDF is damaged or could not be read. Re-export it or paste the description manually.")
    except Exception:
        raise DocumentError("This PDF could not be read. Re-export it or paste the description manually.")
    text = normalize_text("\n\n".join(parts))
    if not text:
        raise DocumentError("No text could be extracted from this PDF. It looks like a scanned or image-only document, "
                            "which needs OCR (not available here). Upload a text-based PDF or a .docx, or type the description.")
    return ExtractedDocument(text=text, file_type="pdf", pages=page_count)


def _paragraph_text(paragraph: ET.Element) -> str:
    out = []
    for node in paragraph.iter():
        if node.tag == f"{_W}t" and node.text:
            out.append(node.text)
        elif node.tag == f"{_W}tab":
            out.append("\t")
        elif node.tag in (f"{_W}br", f"{_W}cr"):
            out.append("\n")
    return "".join(out)


def _extract_docx(data: bytes) -> ExtractedDocument:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            infos = archive.infolist()
            if len(infos) > MAX_DOCX_ENTRIES:
                raise DocumentError("This Word document is not valid.")
            names = {info.filename: info for info in infos}
            if "[Content_Types].xml" not in names or "word/document.xml" not in names:
                raise DocumentError("This file is not a valid Word (.docx) document.")
            info = names["word/document.xml"]
            if info.file_size > MAX_DOCX_XML_BYTES:
                raise DocumentError("This Word document is too large to process.")
            with archive.open(info) as handle:
                xml_bytes = handle.read(MAX_DOCX_XML_BYTES + 1)
            if len(xml_bytes) > MAX_DOCX_XML_BYTES:
                raise DocumentError("This Word document is too large to process.")
    except DocumentError:
        raise
    except (zipfile.BadZipFile, zipfile.LargeZipFile, RuntimeError, NotImplementedError, OSError, EOFError, ValueError):
        raise DocumentError("This Word document is damaged or password protected and could not be read.")
    if b"<!DOCTYPE" in xml_bytes[:4096].upper() or b"<!ENTITY" in xml_bytes.upper():
        raise DocumentError("This Word document contains unsupported content.")   # entity-expansion (XML bomb) guard
    try:
        root = ET.fromstring(xml_bytes)
    except (ET.ParseError, ValueError, RecursionError):
        raise DocumentError("This Word document is damaged and could not be read.")
    lines = []
    for paragraph in root.iter(f"{_W}p"):
        text = _paragraph_text(paragraph)
        if not text.strip():
            lines.append("")
            continue
        numbered = paragraph.find(f"{_W}pPr/{_W}numPr")
        lines.append(("• " if numbered is not None else "") + text)
    text = normalize_text("\n".join(lines))
    if not text:
        raise DocumentError("This Word document contains no text.")
    return ExtractedDocument(text=text, file_type="docx")


def _extract_txt(data: bytes) -> ExtractedDocument:
    text = normalize_text(_decode_text(data))
    if not text:
        raise DocumentError("This text file is empty.")
    return ExtractedDocument(text=text, file_type="txt")


# ------------------------------------------------------------------------------ entry point
def extract_job_description(filename: Optional[str], data: bytes) -> ExtractedDocument:
    ext = extension_of(filename)
    if ext not in ALLOWED_EXTENSIONS:
        if ext == ".doc":
            raise DocumentError("Legacy .doc files are not supported. Save the document as .docx or .pdf and upload it again.", 415)
        raise DocumentError("Unsupported file type. Upload a .pdf, .docx or .txt file.", 415)
    if not data:
        raise DocumentError("The uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise DocumentError(f"The file is larger than the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.", 413)

    is_pdf, is_zip = _looks_like_pdf(data), _looks_like_zip(data)
    if ext == ".pdf":
        if not is_pdf:
            raise DocumentError("This file is not a valid PDF, even though its name ends in .pdf.")
        doc = _extract_pdf(data)
    elif ext == ".docx":
        if not is_zip:
            raise DocumentError("This file is not a valid Word (.docx) document, even though its name ends in .docx.")
        doc = _extract_docx(data)
    else:
        if is_pdf or is_zip:
            raise DocumentError("This file is not a plain-text document, even though its name ends in .txt.")
        doc = _extract_txt(data)

    if len(doc.text) > MAX_TEXT_CHARS:
        raise DocumentError(f"The document contains {len(doc.text):,} characters; a job description can have at most {MAX_TEXT_CHARS:,}. "
                            "Upload a shorter document or the relevant part only.")
    return doc
