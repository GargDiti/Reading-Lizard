
import hashlib
import logging
import uuid
from pathlib import Path

import chromadb

from services.embedding_service import (
    DATA_DIR,
    delete_vectorizer,
    fit_vectorizer,
    load_vectorizer,
    save_vectorizer,
)


# Use a stable path regardless of the terminal's current directory.
CHROMA_DIR = Path(__file__).resolve().parent.parent / "chroma_data"

client = chromadb.PersistentClient(path=str(CHROMA_DIR))
COLLECTION_NAME = "learnloom_chunks"
logger = logging.getLogger(__name__)

collection = client.get_or_create_collection(
    name=COLLECTION_NAME,
    metadata={"hnsw:space": "cosine"}
)


def make_chunk_id(source_url: str, chunk_id: int) -> str:
    """Create a stable ID for each website chunk."""
    raw_id = f"{source_url}::{chunk_id}"
    return hashlib.sha256(raw_id.encode("utf-8")).hexdigest()


def index_chunks(source_url: str, chunks: list[dict]) -> int:
    """Rebuild the shared TF-IDF collection while retaining other websites."""
    global collection

    if not source_url or not source_url.strip():
        raise ValueError("Source URL is required.")

    valid_chunks = [
        chunk for chunk in chunks
        if isinstance(chunk.get("text"), str)
        and chunk["text"].strip()
    ]

    if not valid_chunks:
        raise ValueError("No valid text chunks were supplied.")

    # Refit on every indexed website, then replace the fixed-dimension collection.
    existing = collection.get(
        include=["documents", "metadatas"]
    )

    records_by_id = {}

    for i, document in enumerate(existing["documents"]):
        metadata = existing["metadatas"][i] or {}

        if metadata.get("source_url") != source_url and document.strip():
            record = {
                "id": existing["ids"][i],
                "text": document,
                "metadata": metadata,
            }
            records_by_id[record["id"]] = record

    for index, chunk in enumerate(valid_chunks):
        try:
            chunk_number = int(chunk.get("chunk_id", index))
        except (TypeError, ValueError) as error:
            raise ValueError("Each chunk must have an integer chunk_id.") from error

        chunk_record = {
            "id": make_chunk_id(source_url, chunk_number),
            "text": chunk["text"],
            "metadata": {
                "source_url": source_url,
                "section_title": chunk.get(
                    "section_title", "Untitled"
                ),
                "section_level": chunk.get("section_level", 2),
                "chunk_id": chunk_number,
            },
        }
        records_by_id[chunk_record["id"]] = chunk_record

    records = list(records_by_id.values())
    all_texts = [record["text"] for record in records]

    try:
        vectorizer, matrix = fit_vectorizer(all_texts)
    except ValueError as error:
        raise ValueError(
            "TF-IDF could not build a vocabulary from the indexed text."
        ) from error

    version = uuid.uuid4().hex
    temporary_name = f"{COLLECTION_NAME}_build_{version[:12]}"
    backup_name = f"{COLLECTION_NAME}_backup_{version[:12]}"
    save_vectorizer(vectorizer, version)

    temporary_collection = None
    old_collection = collection
    old_renamed = False
    published = False

    try:
        temporary_collection = client.create_collection(
            name=temporary_name,
            metadata={
                "hnsw:space": "cosine",
                "tfidf_vectorizer_version": version,
            },
        )
        temporary_collection.add(
            ids=[record["id"] for record in records],
            documents=all_texts,
            metadatas=[record["metadata"] for record in records],
            embeddings=matrix.toarray().tolist(),
        )

        old_collection.modify(name=backup_name)
        old_renamed = True
        temporary_collection.modify(name=COLLECTION_NAME)
        published = True

        collection = client.get_collection(name=COLLECTION_NAME)

        try:
            client.delete_collection(name=backup_name)
        except Exception:
            logger.warning("Could not remove previous Chroma collection %s.", backup_name)
        else:
            old_version = (old_collection.metadata or {}).get(
                "tfidf_vectorizer_version"
            )
            if old_version:
                delete_vectorizer(old_version)
    except Exception:
        if old_renamed and not published:
            try:
                old_collection.modify(name=COLLECTION_NAME)
            except Exception:
                logger.exception("Could not restore the previous Chroma collection.")

        if not published:
            try:
                client.delete_collection(name=temporary_name)
            except Exception:
                pass
            delete_vectorizer(version)
        raise

    return len(valid_chunks)


def search_chunks(
    query: str,
    source_url: str,
    top_k: int = 4,
) -> list[dict]:
    """Retrieve the most similar chunks using cosine similarity."""
    if not source_url or not source_url.strip():
        raise ValueError("Source URL is required for website-scoped search.")

    if not query or not query.strip():
        return []

    if top_k <= 0 or collection.count() == 0:
        return []

    where = {"source_url": source_url}
    available = collection.get(where=where, include=["metadatas"])
    available_count = len(available["ids"])

    if available_count == 0:
        return []

    version = (collection.metadata or {}).get("tfidf_vectorizer_version")
    vectorizer = load_vectorizer(version)

    stored_sample = collection.get(
        where=where,
        limit=1,
        include=["embeddings"],
    )
    stored_dimension = len(stored_sample["embeddings"][0])
    if stored_dimension != len(vectorizer.vocabulary_):
        raise RuntimeError(
            "Stored Chroma vectors and TF-IDF vocabulary do not match. "
            "Reindex the website before searching."
        )

    query_vector = vectorizer.transform([query.strip()])

    # Avoid returning arbitrary results for queries with no known terms.
    if query_vector.nnz == 0:
        return []

    # The query must use the same feature space as stored vectors.
    query_embedding = query_vector.toarray().tolist()

    results = collection.query(
        query_embeddings=query_embedding,
        n_results=min(top_k, available_count),
        where=where,
        include=["documents", "metadatas", "distances"],
    )

    retrieved = []

    for i, document in enumerate(results["documents"][0]):
        metadata = results["metadatas"][0][i]
        distance = results["distances"][0][i]

        similarity = float(1.0 - distance)
        if similarity <= 0:
            continue

        retrieved.append({
            "text": document,
            "source_url": metadata["source_url"],
            "section_title": metadata["section_title"],
            "chunk_id": metadata["chunk_id"],
            "distance": float(distance),
            "similarity": similarity,
        })

    return retrieved


def get_indexed_topics(source_url: str) -> list[dict]:
    """Return section names stored with a previously indexed website."""
    if not source_url or not source_url.strip() or collection.count() == 0:
        return []

    indexed = collection.get(where={"source_url": source_url}, include=["metadatas"])
    topics = []
    seen = set()
    for metadata in indexed.get("metadatas") or []:
        metadata = metadata or {}
        title = (metadata.get("section_title") or "").strip()
        if not title or title.casefold() in seen:
            continue
        seen.add(title.casefold())
        try:
            level = int(metadata.get("section_level", 2))
        except (TypeError, ValueError):
            level = 2
        topics.append({"level": min(3, max(1, level)), "title": title})
    return topics
