"""The public assessment metadata keeps the job description's line structure so the opening page can render its Markdown."""
from routers.public_assessment import DESCRIPTION_PREVIEW_CHARS, _description_preview


def test_markdown_line_structure_is_kept():
    raw = "## Machine Learning Engineer\r\n\r\n\r\n\r\n**Experience:**   3+ years\n- Python\n-   SQL\n"
    assert _description_preview(raw) == "## Machine Learning Engineer\n\n**Experience:** 3+ years\n- Python\n- SQL"


def test_plain_text_and_empty_values():
    assert _description_preview("We are hiring.  Apply now.") == "We are hiring. Apply now."
    assert _description_preview(None) == ""
    assert _description_preview("   \n \n") == ""


def test_long_text_is_cut_at_a_line_boundary():
    raw = "\n".join(f"- requirement number {i} " + "x" * 60 for i in range(200))
    out = _description_preview(raw)
    assert len(out) <= DESCRIPTION_PREVIEW_CHARS + 4
    assert out.endswith("\n...")
    body = out[: -len("\n...")]
    assert all(line.startswith("- requirement number") and line.endswith("x" * 60) for line in body.split("\n")), "no line is cut in half"


def test_one_huge_line_is_hard_cut():
    out = _description_preview("y" * (DESCRIPTION_PREVIEW_CHARS * 2))
    assert len(out) <= DESCRIPTION_PREVIEW_CHARS + 4 and out.endswith("\n...")
