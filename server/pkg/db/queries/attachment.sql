-- name: CreateAttachment :one
INSERT INTO attachment (workspace_id, issue_id, comment_id, uploader_type, uploader_id, filename, url, content_type, size_bytes)
VALUES ($1, sqlc.narg(issue_id), sqlc.narg(comment_id), $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ListAttachmentsByIssue :many
SELECT * FROM attachment
WHERE issue_id = $1 AND workspace_id = $2
ORDER BY created_at ASC;

-- name: ListAttachmentsByComment :many
SELECT * FROM attachment
WHERE comment_id = $1 AND workspace_id = $2
ORDER BY created_at ASC;

-- name: GetAttachment :one
SELECT * FROM attachment
WHERE id = $1 AND workspace_id = $2;

-- name: ListAttachmentsByCommentIDs :many
SELECT * FROM attachment
WHERE comment_id = ANY($1::uuid[])
ORDER BY created_at ASC;

-- name: DeleteAttachment :exec
DELETE FROM attachment WHERE id = $1 AND workspace_id = $2;
