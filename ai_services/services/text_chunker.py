
import re
from services.topic_extractor import clean_topic_title


def chunk_markdown(
    markdown: str,
    max_chars: int = 2500,
    overlap_chars: int = 250,
) -> list[dict]:
    """
    Split Markdown into smaller chunks while preserving section headings.
    """

    if not markdown or not markdown.strip():
        return []

    if max_chars <= 0 or overlap_chars < 0:
        raise ValueError("Invalid chunk size or overlap.")

    if overlap_chars >= max_chars:
        raise ValueError("Overlap must be smaller than max_chars.")

    sections = []
    current_title = "Introduction"
    current_level = 1
    current_lines = []

    # Split the document at Markdown headings.
    for line in markdown.splitlines():
        heading = re.match(r"^(#{1,3})\s+(.+)$", line)

        if heading:
            if current_lines:
                sections.append(
                    (current_title, current_level, "\n".join(current_lines).strip())
                )

            current_title = clean_topic_title(heading.group(2))
            current_level = len(heading.group(1))
            current_lines = []
        else:
            current_lines.append(line)

    if current_lines:
        sections.append(
            (current_title, current_level, "\n".join(current_lines).strip())
        )

    chunks = []

    for title, section_level, section_text in sections:
        if not section_text:
            continue

        paragraphs = re.split(r"\n\s*\n", section_text)
        current_text = ""

        for paragraph in paragraphs:
            paragraph = paragraph.strip()

            if not paragraph:
                continue

            # Break very long paragraphs at word boundaries.
            pieces = []
            remaining = paragraph

            while len(remaining) > max_chars:
                split_at = remaining.rfind(" ", 0, max_chars + 1)

                if split_at <= 0:
                    split_at = max_chars

                pieces.append(remaining[:split_at].strip())
                remaining = remaining[split_at:].strip()

            if remaining:
                pieces.append(remaining)

            for piece in pieces:
                candidate = (
                    f"{current_text}\n\n{piece}"
                    if current_text
                    else piece
                )

                if len(candidate) <= max_chars:
                    current_text = candidate
                    continue

                if current_text:
                    chunks.append({
                        "section_title": title,
                        "section_level": section_level,
                        "text": current_text,
                    })

                # Preserve some context from the previous chunk.
                overlap = current_text[-overlap_chars:].strip()

                if " " in overlap:
                    overlap = overlap.split(" ", 1)[1]

                current_text = (
                    f"{overlap}\n\n{piece}" if overlap else piece
                )

                # If overlap plus piece is too long, keep the piece.
                if len(current_text) > max_chars:
                    current_text = piece

        if current_text:
            chunks.append({
                "section_title": title,
                "section_level": section_level,
                "text": current_text,
            })

    # Add stable, sequential IDs to the chunks.
    for index, chunk in enumerate(chunks):
        chunk["chunk_id"] = index

    return chunks
