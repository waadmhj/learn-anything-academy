"""Extract plain text from an uploaded syllabus or study material (PDF, Word, Markdown, text)."""
from __future__ import annotations

import io
import re
import zipfile

from defusedxml import ElementTree as SafeET

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
TEXT_EXT = (".txt", ".md", ".markdown", ".csv", ".rst", ".org", ".tex")


class MaterialError(ValueError):
    pass


def _decode(data: bytes) -> str:
    for enc in ("utf-8-sig", "utf-16", "cp1252", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    raise MaterialError("Couldn't read this file's text encoding.")


def _pdf(data: bytes) -> str:
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            raise MaterialError("This PDF is password-protected. Export an unprotected copy and try again.")
        text = "\n\n".join((page.extract_text() or "") for page in reader.pages)
    except PdfReadError as e:
        raise MaterialError(f"Couldn't read this PDF: {e}") from e
    if len(text.strip()) < 20:
        raise MaterialError("This PDF has no selectable text (it may be scanned images). Paste the text instead.")
    return text


def _docx(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            info = z.getinfo("word/document.xml")
            if info.file_size > 50 * 1024 * 1024:
                raise MaterialError("This Word document is too large.")
            xml = z.read(info)
    except (zipfile.BadZipFile, KeyError) as e:
        raise MaterialError("Couldn't read this Word document.") from e
    root = SafeET.fromstring(xml)
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    lines = []
    for p in root.iter(f"{ns}p"):
        style = p.find(f"{ns}pPr/{ns}pStyle")
        text = "".join(t.text or "" for t in p.iter(f"{ns}t")).strip()
        if not text:
            continue
        level = re.search(r"Heading(\d)", style.get(f"{ns}val", "")) if style is not None else None
        lines.append(("#" * int(level.group(1)) + " " + text) if level else text)
    return "\n".join(lines)


def extract(filename: str, data: bytes) -> str:
    if len(data) > MAX_UPLOAD_BYTES:
        raise MaterialError("Files can be up to 15 MB.")
    name = filename.lower()
    if name.endswith(".pdf"):
        return _pdf(data)
    if name.endswith(".docx"):
        return _docx(data)
    if name.endswith(TEXT_EXT):
        return _decode(data)
    raise MaterialError("Upload a PDF, Word (.docx), Markdown or text file.")
