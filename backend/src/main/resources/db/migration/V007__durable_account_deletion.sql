-- Independent of the user's cascade: a rollback/crash must retain the intent.
CREATE TABLE account_deletion (
    id UUID PRIMARY KEY,
    subject_hash VARCHAR(64) NOT NULL UNIQUE,
    user_id UUID,
    identity_subject VARCHAR(255),
    csrf_ticket VARCHAR(128),
    oidc_reference VARCHAR(128),
    local_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL,
    next_attempt_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    CONSTRAINT account_deletion_state CHECK (
        (completed_at IS NULL AND user_id IS NOT NULL AND identity_subject IS NOT NULL)
        OR (completed_at IS NOT NULL AND local_deleted AND user_id IS NULL
            AND identity_subject IS NULL AND csrf_ticket IS NULL AND oidc_reference IS NULL)
    )
);
CREATE INDEX idx_account_deletion_pending ON account_deletion(next_attempt_at, created_at)
    WHERE completed_at IS NULL;
