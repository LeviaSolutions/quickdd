-- DD-Analyst PostgreSQL Schema
-- Idempotent: all objects use IF NOT EXISTS.
-- Run inside a single transaction for safety.

BEGIN;

-- ============================================================
-- 1. PROJECTS
-- ============================================================
CREATE TABLE IF NOT EXISTS projects (
    id              TEXT PRIMARY KEY,                          -- UUID v4
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
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at      TIMESTAMPTZ DEFAULT NULL
);

-- ============================================================
-- 2. DOCUMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS documents (
    id              TEXT PRIMARY KEY,                          -- UUID v4
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    original_path   TEXT NOT NULL,
    stored_path     TEXT NOT NULL,
    file_size       INTEGER NOT NULL,
    mime_type       TEXT NOT NULL,
    file_hash       TEXT NOT NULL,                             -- SHA-256
    page_count      INTEGER DEFAULT NULL,
    ocr_confidence  DOUBLE PRECISION DEFAULT NULL,             -- 0.0 - 1.0
    is_encrypted    BOOLEAN NOT NULL DEFAULT FALSE,
    status          TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN (
                        'uploaded', 'detecting', 'extracting',
                        'chunking', 'embedding', 'indexed',
                        'error', 'skipped'
                    )),
    error_message   TEXT DEFAULT NULL,
    metadata_json   JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_documents_hash ON documents(project_id, file_hash);

-- ============================================================
-- 3. CHUNKS
-- ============================================================
CREATE TABLE IF NOT EXISTS chunks (
    id              TEXT PRIMARY KEY,                          -- UUID v4
    document_id     TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index     INTEGER NOT NULL,
    text            TEXT NOT NULL,
    page_number     INTEGER DEFAULT NULL,
    section         TEXT DEFAULT NULL,
    token_count     INTEGER NOT NULL,
    start_char      INTEGER DEFAULT NULL,
    end_char        INTEGER DEFAULT NULL,
    embedding_id    TEXT DEFAULT NULL,                         -- ChromaDB embedding ID
    tsv             TSVECTOR,                                  -- Full-text search vector
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chunks_document ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_tsv ON chunks USING GIN (tsv);

-- Auto-populate tsvector column on insert/update
CREATE OR REPLACE FUNCTION chunks_tsv_trigger_fn() RETURNS trigger AS $$
BEGIN
    NEW.tsv := to_tsvector('simple', NEW.text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS chunks_tsv_trigger ON chunks;
CREATE TRIGGER chunks_tsv_trigger
    BEFORE INSERT OR UPDATE ON chunks
    FOR EACH ROW EXECUTE FUNCTION chunks_tsv_trigger_fn();

-- ============================================================
-- 4. TABLES_EXTRACTED (structured table extractions)
-- Renamed from "tables" to avoid keyword confusion.
-- ============================================================
CREATE TABLE IF NOT EXISTS tables_extracted (
    id              TEXT PRIMARY KEY,                          -- UUID v4
    document_id     TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    table_index     INTEGER NOT NULL,
    page_number     INTEGER DEFAULT NULL,
    caption         TEXT DEFAULT NULL,
    headers_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
    rows_json       JSONB NOT NULL DEFAULT '[]'::jsonb,
    row_count       INTEGER NOT NULL DEFAULT 0,
    col_count       INTEGER NOT NULL DEFAULT 0,
    table_type      TEXT DEFAULT NULL,                         -- rent_roll, opex, capex, etc.
    embedding_id    TEXT DEFAULT NULL,                         -- ChromaDB embedding ID
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tables_extracted_document ON tables_extracted(document_id);

-- ============================================================
-- 5. QUESTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS questions (
    id                    TEXT PRIMARY KEY,                     -- e.g. "LEGAL-001"
    category              TEXT NOT NULL,
    subcategory           TEXT DEFAULT NULL,
    asset_classes_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
    question_de           TEXT NOT NULL,
    question_en           TEXT NOT NULL,
    expected_format       TEXT NOT NULL,
    search_keywords_de    JSONB DEFAULT '[]'::jsonb,
    search_keywords_en    JSONB DEFAULT '[]'::jsonb,
    priority              TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN (
                              'critical', 'high', 'medium', 'low'
                          )),
    source_hint           TEXT DEFAULT NULL,
    llm_instruction       TEXT DEFAULT NULL,
    validation_rule       TEXT DEFAULT NULL,                    -- Regex or range
    depends_on_json       JSONB DEFAULT '[]'::jsonb,
    severity_weight       INTEGER NOT NULL DEFAULT 5 CHECK (severity_weight BETWEEN 1 AND 10),
    regulatory_reference  TEXT DEFAULT NULL,
    requires_table_qa     BOOLEAN NOT NULL DEFAULT FALSE,
    multi_hop_required    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_questions_category ON questions(category);
CREATE INDEX IF NOT EXISTS idx_questions_priority ON questions(priority);

-- ============================================================
-- 6. ANSWERS
-- ============================================================
CREATE TABLE IF NOT EXISTS answers (
    id                TEXT PRIMARY KEY,                         -- UUID v4
    project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    question_id       TEXT NOT NULL REFERENCES questions(id),
    answer_text       TEXT NOT NULL,
    confidence_tier   TEXT NOT NULL CHECK (confidence_tier IN (
                          'high', 'medium', 'low', 'insufficient_data'
                      )),
    confidence_score  DOUBLE PRECISION NOT NULL CHECK (confidence_score BETWEEN 0.0 AND 1.0),
    retrieval_score   DOUBLE PRECISION DEFAULT NULL,
    consistency_score DOUBLE PRECISION DEFAULT NULL,
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
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(project_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_answers_project ON answers(project_id);
CREATE INDEX IF NOT EXISTS idx_answers_question ON answers(question_id);
CREATE INDEX IF NOT EXISTS idx_answers_confidence ON answers(confidence_tier);

-- ============================================================
-- 7. ANSWER SOURCES (citation links)
-- ============================================================
CREATE TABLE IF NOT EXISTS answer_sources (
    id              TEXT PRIMARY KEY,                           -- UUID v4
    answer_id       TEXT NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
    chunk_id        TEXT REFERENCES chunks(id) ON DELETE SET NULL,
    table_id        TEXT REFERENCES tables_extracted(id) ON DELETE SET NULL,
    relevance_score DOUBLE PRECISION NOT NULL CHECK (relevance_score BETWEEN 0.0 AND 1.0),
    rank_position   INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_answer_sources_answer ON answer_sources(answer_id);

-- ============================================================
-- 8. CONTRADICTIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS contradictions (
    id                  TEXT PRIMARY KEY,                       -- UUID v4
    answer_id           TEXT NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
    source_a_chunk_id   TEXT REFERENCES chunks(id) ON DELETE SET NULL,
    source_b_chunk_id   TEXT REFERENCES chunks(id) ON DELETE SET NULL,
    description         TEXT NOT NULL,
    severity            TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN (
                            'high', 'medium', 'low'
                        )),
    resolved            BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_by         TEXT DEFAULT NULL,
    resolved_at         TIMESTAMPTZ DEFAULT NULL,
    resolution_note     TEXT DEFAULT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contradictions_answer ON contradictions(answer_id);

-- ============================================================
-- 9. OVERRIDES (manual answer corrections)
-- ============================================================
CREATE TABLE IF NOT EXISTS overrides (
    id              TEXT PRIMARY KEY,                           -- UUID v4
    answer_id       TEXT NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
    override_text   TEXT NOT NULL,
    user_name       TEXT NOT NULL,
    reason          TEXT DEFAULT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_overrides_answer ON overrides(answer_id);

-- ============================================================
-- 10. REVIEW SIGNOFFS (mandatory for critical questions)
-- ============================================================
CREATE TABLE IF NOT EXISTS review_signoffs (
    id              TEXT PRIMARY KEY,                           -- UUID v4
    answer_id       TEXT NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
    reviewer_name   TEXT NOT NULL,
    signed_off_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    comment         TEXT DEFAULT NULL,
    UNIQUE(answer_id, reviewer_name)
);

CREATE INDEX IF NOT EXISTS idx_signoffs_answer ON review_signoffs(answer_id);

-- ============================================================
-- 11. AUDIT LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id              BIGSERIAL PRIMARY KEY,
    project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
    action          TEXT NOT NULL,                              -- e.g. 'document.upload', 'answer.override'
    entity_type     TEXT DEFAULT NULL,                          -- 'project', 'document', 'answer', etc.
    entity_id       TEXT DEFAULT NULL,
    details         JSONB DEFAULT '{}'::jsonb,
    user_name       TEXT DEFAULT 'system',
    ip_address      TEXT DEFAULT NULL,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT now()
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
    is_custom   BOOLEAN NOT NULL DEFAULT FALSE,
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
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 14. CALIBRATION RUNS
-- ============================================================
CREATE TABLE IF NOT EXISTS calibration_runs (
    id                TEXT PRIMARY KEY,                         -- UUID v4
    model_name        TEXT NOT NULL,
    run_date          TIMESTAMPTZ NOT NULL DEFAULT now(),
    total_questions   INTEGER NOT NULL,
    accuracy_high     DOUBLE PRECISION NOT NULL,
    accuracy_medium   DOUBLE PRECISION NOT NULL,
    accuracy_low      DOUBLE PRECISION NOT NULL,
    threshold_adj     JSONB DEFAULT '{}'::jsonb,
    notes             TEXT DEFAULT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 15. USERS (authentication & authorization)
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT NOT NULL,
    name            TEXT NOT NULL,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN (
                        'admin', 'analyst', 'viewer'
                    )),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

COMMIT;
