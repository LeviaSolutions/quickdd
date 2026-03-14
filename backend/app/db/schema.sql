-- DD-Analyst SQLite Schema
-- All tables use strict typing where possible.
-- Timestamps are ISO-8601 TEXT (SQLite has no native datetime).

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- ============================================================
-- 1. PROJECTS
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
    id              TEXT PRIMARY KEY,                -- UUID v4
    name            TEXT NOT NULL,
    description     TEXT DEFAULT '',
    asset_class     TEXT NOT NULL CHECK (asset_class IN (
                        'office', 'logistics', 'retail',
                        'residential', 'mixed_use'
                    )),
    status          TEXT NOT NULL DEFAULT 'created' CHECK (status IN (
                        'created', 'ingesting', 'processing',
                        'completed', 'archived', 'error'
                    )),
    file_count      INTEGER NOT NULL DEFAULT 0,
    question_count  INTEGER NOT NULL DEFAULT 0,
    answered_count  INTEGER NOT NULL DEFAULT 0,
    language        TEXT NOT NULL DEFAULT 'de' CHECK (language IN ('de', 'en')),
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    deleted_at      TEXT DEFAULT NULL
);

-- ============================================================
-- 2. DOCUMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
    id              TEXT PRIMARY KEY,                -- UUID v4
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    original_path   TEXT NOT NULL,
    stored_path     TEXT NOT NULL,
    file_size       INTEGER NOT NULL,
    mime_type       TEXT NOT NULL,
    file_hash       TEXT NOT NULL,                   -- SHA-256
    page_count      INTEGER DEFAULT NULL,
    ocr_confidence  REAL DEFAULT NULL,               -- 0.0 - 1.0
    is_encrypted    INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN (
                        'uploaded', 'detecting', 'extracting',
                        'chunking', 'embedding', 'indexed',
                        'error', 'skipped'
                    )),
    error_message   TEXT DEFAULT NULL,
    metadata_json   TEXT DEFAULT '{}',               -- Arbitrary JSON metadata
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_hash ON documents(project_id, file_hash);

-- ============================================================
-- 3. CHUNKS
-- ============================================================
CREATE TABLE IF NOT EXISTS chunks (
    id              TEXT PRIMARY KEY,                -- UUID v4
    document_id     TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index     INTEGER NOT NULL,
    text            TEXT NOT NULL,
    page_number     INTEGER DEFAULT NULL,
    section         TEXT DEFAULT NULL,
    token_count     INTEGER NOT NULL,
    start_char      INTEGER DEFAULT NULL,
    end_char        INTEGER DEFAULT NULL,
    embedding_id    TEXT DEFAULT NULL,               -- ChromaDB embedding ID
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);

-- ============================================================
-- 3a. CHUNKS FTS5 (Full-Text Search for BM25 retrieval)
-- ============================================================
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    text,
    content='chunks',
    content_rowid='rowid',
    tokenize='unicode61 remove_diacritics 2'
);

-- Triggers to keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS chunks_fts_insert AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_fts_delete AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_fts_update AFTER UPDATE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
    INSERT INTO chunks_fts(rowid, text) VALUES (new.rowid, new.text);
END;

-- ============================================================
-- 4. TABLES (Structured table extractions)
-- ============================================================
CREATE TABLE IF NOT EXISTS tables (
    id              TEXT PRIMARY KEY,                -- UUID v4
    document_id     TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    table_index     INTEGER NOT NULL,
    page_number     INTEGER DEFAULT NULL,
    caption         TEXT DEFAULT NULL,
    headers_json    TEXT NOT NULL DEFAULT '[]',       -- JSON array of column headers
    rows_json       TEXT NOT NULL DEFAULT '[]',       -- JSON array of row arrays
    row_count       INTEGER NOT NULL DEFAULT 0,
    col_count       INTEGER NOT NULL DEFAULT 0,
    table_type      TEXT DEFAULT NULL,               -- rent_roll, opex, capex, etc.
    embedding_id    TEXT DEFAULT NULL,               -- ChromaDB embedding ID
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_tables_document ON tables(document_id);

-- ============================================================
-- 5. QUESTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS questions (
    id                    TEXT PRIMARY KEY,           -- e.g. "LEGAL-001"
    category              TEXT NOT NULL,
    subcategory           TEXT DEFAULT NULL,
    asset_classes_json    TEXT NOT NULL DEFAULT '[]', -- JSON array: ["office","retail"]
    question_de           TEXT NOT NULL,
    question_en           TEXT NOT NULL,
    expected_format       TEXT NOT NULL,
    search_keywords_de    TEXT DEFAULT '[]',          -- JSON array
    search_keywords_en    TEXT DEFAULT '[]',          -- JSON array
    priority              TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN (
                              'critical', 'high', 'medium', 'low'
                          )),
    source_hint           TEXT DEFAULT NULL,
    llm_instruction       TEXT DEFAULT NULL,
    validation_rule       TEXT DEFAULT NULL,          -- Regex or range
    depends_on_json       TEXT DEFAULT '[]',          -- JSON array of question IDs
    severity_weight       INTEGER NOT NULL DEFAULT 5 CHECK (severity_weight BETWEEN 1 AND 10),
    regulatory_reference  TEXT DEFAULT NULL,
    requires_table_qa     INTEGER NOT NULL DEFAULT 0,
    multi_hop_required    INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_questions_category ON questions(category);
CREATE INDEX IF NOT EXISTS idx_questions_priority ON questions(priority);

-- ============================================================
-- 6. ANSWERS
-- ============================================================
CREATE TABLE IF NOT EXISTS answers (
    id                TEXT PRIMARY KEY,               -- UUID v4
    project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    question_id       TEXT NOT NULL REFERENCES questions(id),
    answer_text       TEXT NOT NULL,
    confidence_tier   TEXT NOT NULL CHECK (confidence_tier IN (
                          'high', 'medium', 'low', 'insufficient_data'
                      )),
    confidence_score  REAL NOT NULL CHECK (confidence_score BETWEEN 0.0 AND 1.0),
    retrieval_score   REAL DEFAULT NULL,
    consistency_score REAL DEFAULT NULL,
    hop_count         INTEGER NOT NULL DEFAULT 1,
    model_used        TEXT NOT NULL,
    prompt_tokens     INTEGER DEFAULT NULL,
    completion_tokens INTEGER DEFAULT NULL,
    processing_time_ms INTEGER DEFAULT NULL,
    status            TEXT NOT NULL DEFAULT 'generated' CHECK (status IN (
                          'pending', 'generating', 'generated',
                          'reviewed', 'overridden', 'error'
                      )),
    raw_llm_output    TEXT DEFAULT NULL,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(project_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_answers_project ON answers(project_id);
CREATE INDEX IF NOT EXISTS idx_answers_question ON answers(question_id);
CREATE INDEX IF NOT EXISTS idx_answers_confidence ON answers(confidence_tier);

-- ============================================================
-- 7. ANSWER SOURCES (citation links)
-- ============================================================
CREATE TABLE IF NOT EXISTS answer_sources (
    id              TEXT PRIMARY KEY,                 -- UUID v4
    answer_id       TEXT NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
    chunk_id        TEXT REFERENCES chunks(id) ON DELETE SET NULL,
    table_id        TEXT REFERENCES tables(id) ON DELETE SET NULL,
    relevance_score REAL NOT NULL CHECK (relevance_score BETWEEN 0.0 AND 1.0),
    rank_position   INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_answer_sources_answer ON answer_sources(answer_id);

-- ============================================================
-- 8. CONTRADICTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS contradictions (
    id                  TEXT PRIMARY KEY,             -- UUID v4
    answer_id           TEXT NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
    source_a_chunk_id   TEXT REFERENCES chunks(id) ON DELETE SET NULL,
    source_b_chunk_id   TEXT REFERENCES chunks(id) ON DELETE SET NULL,
    description         TEXT NOT NULL,
    severity            TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN (
                            'high', 'medium', 'low'
                        )),
    resolved            INTEGER NOT NULL DEFAULT 0,
    resolved_by         TEXT DEFAULT NULL,
    resolved_at         TEXT DEFAULT NULL,
    resolution_note     TEXT DEFAULT NULL,
    created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_contradictions_answer ON contradictions(answer_id);

-- ============================================================
-- 9. OVERRIDES (manual answer corrections)
-- ============================================================
CREATE TABLE IF NOT EXISTS overrides (
    id              TEXT PRIMARY KEY,                 -- UUID v4
    answer_id       TEXT NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
    override_text   TEXT NOT NULL,
    user_name       TEXT NOT NULL,
    reason          TEXT DEFAULT NULL,
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_overrides_answer ON overrides(answer_id);

-- ============================================================
-- 10. REVIEW SIGNOFFS (mandatory for critical questions)
-- ============================================================
CREATE TABLE IF NOT EXISTS review_signoffs (
    id              TEXT PRIMARY KEY,                 -- UUID v4
    answer_id       TEXT NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
    reviewer_name   TEXT NOT NULL,
    signed_off_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    comment         TEXT DEFAULT NULL,
    UNIQUE(answer_id, reviewer_name)
);

CREATE INDEX IF NOT EXISTS idx_signoffs_answer ON review_signoffs(answer_id);

-- ============================================================
-- 11. AUDIT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
    action          TEXT NOT NULL,                    -- e.g. 'document.upload', 'answer.override'
    entity_type     TEXT DEFAULT NULL,                -- 'project', 'document', 'answer', etc.
    entity_id       TEXT DEFAULT NULL,
    details         TEXT DEFAULT '{}',                -- JSON
    user_name       TEXT DEFAULT 'system',
    ip_address      TEXT DEFAULT NULL,
    timestamp       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_log(project_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);

-- ============================================================
-- 12. PROJECT QUESTIONS (junction table for selected questions)
-- ============================================================
CREATE TABLE IF NOT EXISTS project_questions (
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    is_custom   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_pq_project ON project_questions(project_id);

-- ============================================================
-- 13. CUSTOM QUESTIONS (user-added questions per project)
-- ============================================================
CREATE TABLE IF NOT EXISTS custom_questions (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    category        TEXT NOT NULL,
    question_de     TEXT NOT NULL,
    question_en     TEXT NOT NULL DEFAULT '',
    expected_format TEXT NOT NULL DEFAULT 'free_text',
    priority        TEXT NOT NULL DEFAULT 'medium',
    created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ============================================================
-- 14. CALIBRATION RUNS
-- ============================================================
CREATE TABLE IF NOT EXISTS calibration_runs (
    id                TEXT PRIMARY KEY,               -- UUID v4
    model_name        TEXT NOT NULL,
    run_date          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    total_questions   INTEGER NOT NULL,
    accuracy_high     REAL NOT NULL,                  -- Accuracy for HIGH confidence
    accuracy_medium   REAL NOT NULL,
    accuracy_low      REAL NOT NULL,
    threshold_adj     TEXT DEFAULT '{}',              -- JSON: adjusted thresholds
    notes             TEXT DEFAULT NULL,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
