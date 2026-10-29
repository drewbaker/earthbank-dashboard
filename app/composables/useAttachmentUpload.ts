import { MAX_ATTACHMENT_BYTES } from '#shared/constants/attachments.ts'
import { apiErrorMessage } from '~/composables/useApi.ts'

/**
 * Upload files to a task, or to one of your comments on it.
 *
 * @returns `uploadAttachments({ taskId, files, commentId })`.
 */
export function useAttachmentUpload() {
    /**
     * Upload each file in turn. A file that fails doesn't stop the rest.
     *
     * @param input.taskId - The task.
     * @param input.files - Files to upload.
     * @param input.commentId - Attach them to this comment instead of the task.
     * @returns Messages for files that failed (empty when all uploaded).
     */
    return async function uploadAttachments({
        taskId,
        files,
        commentId = null,
    }: {
        taskId: string
        files: File[]
        commentId?: string | null
    }) {
        const failures: string[] = []
        for (const file of files) {
            if (file.size > MAX_ATTACHMENT_BYTES) {
                failures.push(`${file.name} is over 25 MB.`)
                continue
            }
            const form = new FormData()
            form.append('file', file)
            if (commentId) {
                form.append('comment_id', commentId)
            }
            try {
                // FormData can't go through the JSON helper; $fetch sends it as multipart.
                await $fetch(`/v1/tasks/${taskId}/attachments`, { method: 'POST', body: form })
            } catch (error) {
                failures.push(`${file.name}: ${apiErrorMessage({ error, fallback: 'upload failed' })}`)
            }
        }
        return failures
    }
}

/**
 * Upload files to a funder or a fund (the AI then reads them).
 *
 * @param input.uploadPath - The API path, e.g. `/v1/funds/fmg_…/attachments`.
 * @param input.files - Files to upload.
 * @param input.fields - Extra form fields (a funder file's `opportunity_id`).
 * @returns Messages for files that failed (empty when all uploaded).
 */
export async function uploadOwnerFiles({
    uploadPath,
    files,
    fields = {},
}: {
    uploadPath: string
    files: File[]
    fields?: Record<string, string>
}) {
    const failures: string[] = []
    for (const file of files) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
            failures.push(`${file.name} is over 25 MB.`)
            continue
        }
        const form = new FormData()
        form.append('file', file)
        for (const [name, value] of Object.entries(fields)) {
            form.append(name, value)
        }
        try {
            await $fetch(uploadPath, { method: 'POST', body: form })
        } catch (error) {
            failures.push(`${file.name}: ${apiErrorMessage({ error, fallback: 'upload failed' })}`)
        }
    }
    return failures
}
