import io
import pytest
from fastapi import UploadFile
from app.pipeline.intake import process_intake, IntakeError
import pypdf


def make_upload(filename: str, content: bytes) -> UploadFile:
    return UploadFile(filename=filename, file=io.BytesIO(content))


@pytest.mark.asyncio
async def test_intake_zero_byte_file():
    """Verify 0-byte files raise a friendly IntakeError."""
    upload = make_upload("empty.txt", b"")
    with pytest.raises(IntakeError, match="is empty \\(0 bytes\\)"):
        await process_intake("job-intake-01", [upload])


@pytest.mark.asyncio
async def test_intake_spoofed_pdf_extension():
    """Verify executable/text renamed to .pdf fails magic header check."""
    fake_pdf = b"MZ\x90\x00\x03\x00\x00\x00BinaryExeCodeHere"
    upload = make_upload("malware.pdf", fake_pdf)
    with pytest.raises(IntakeError, match="valid PDF header format"):
        await process_intake("job-intake-02", [upload])


@pytest.mark.asyncio
async def test_intake_spoofed_docx_extension():
    """Verify random text renamed to .docx fails zip header check."""
    fake_docx = b"This is just plain text renamed to docx"
    upload = make_upload("notes.docx", fake_docx)
    with pytest.raises(IntakeError, match="not a valid Office open XML document"):
        await process_intake("job-intake-03", [upload])


@pytest.mark.asyncio
async def test_intake_zip_rejection():
    """Verify direct zip archives are rejected with clear user instruction."""
    zip_bytes = b"PK\x03\x04\x14\x00\x00\x00FakeZipArchive"
    upload = make_upload("archive.zip", zip_bytes)
    with pytest.raises(IntakeError, match="Direct ZIP uploads are not supported"):
        await process_intake("job-intake-04", [upload])


@pytest.mark.asyncio
async def test_intake_path_traversal_sanitization():
    """Verify path traversal in filename is completely stripped."""
    content = b"Line 1\nLine 2\nLine 3"
    upload = make_upload("../../../etc/passwd.txt", content)
    manifest, paths = await process_intake("job-intake-05", [upload])
    assert len(manifest.files) == 1
    assert ".." not in paths[0]
    assert manifest.files[0].name == "passwd.txt"


@pytest.mark.asyncio
async def test_intake_duplicate_filenames():
    """Verify duplicate filenames in same batch are cleanly deduplicated."""
    u1 = make_upload("report.txt", b"First report contents")
    u2 = make_upload("report.txt", b"Second report contents")
    manifest, paths = await process_intake("job-intake-06", [u1, u2])
    assert len(manifest.files) == 2
    assert manifest.files[0].name == "report.txt"
    assert manifest.files[1].name == "report_1.txt"
    assert len(set(paths)) == 2


@pytest.mark.asyncio
async def test_intake_corrupted_json():
    """Verify invalid JSON raises friendly IntakeError."""
    bad_json = b"{invalid: json, missing quotes: yes, }"
    upload = make_upload("broken.json", bad_json)
    with pytest.raises(IntakeError, match="invalid or corrupted JSON"):
        await process_intake("job-intake-07", [upload])


@pytest.mark.asyncio
async def test_intake_latin1_csv():
    """Verify CSV with non-UTF8 latin-1 characters parses gracefully."""
    # Byte 0xE9 is é in ISO-8859-1 (latin-1)
    latin1_csv = b"id,name,value\n1,Caf\xe9,42\n2,Cr\xe8me,88\n"
    upload = make_upload("latin.csv", latin1_csv)
    manifest, _ = await process_intake("job-intake-08", [upload])
    assert manifest.files[0].units == 2
    assert manifest.unitKind == "rows"


@pytest.mark.asyncio
async def test_intake_scanned_pdf():
    """Verify scanned PDF with blank text layer produces safe fallback preview."""
    # Construct a minimal valid PDF with 1 page with no text
    writer = pypdf.PdfWriter()
    writer.add_blank_page(width=72, height=72)
    buf = io.BytesIO()
    writer.write(buf)
    pdf_bytes = buf.getvalue()

    upload = make_upload("scanned.pdf", pdf_bytes)
    manifest, _ = await process_intake("job-intake-09", [upload])
    assert manifest.files[0].units == 1
    assert manifest.files[0].unitKind == "pages"
    assert "OCR" in manifest.files[0].preview
