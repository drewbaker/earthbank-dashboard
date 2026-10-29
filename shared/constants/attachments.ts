// Where a funder or fund file came from: uploaded on its page, or attached to an email sent to the
// dashboard address.
export const ATTACHMENT_ORIGINS = ['upload', 'email'] as const
export type AttachmentOrigin = (typeof ATTACHMENT_ORIGINS)[number]

// How the AI reading of a funder or fund file went. skipped: nothing readable, or a personal document.
export const ATTACHMENT_READ_STATUSES = ['queued', 'reading', 'done', 'skipped', 'failed'] as const
export type AttachmentReadStatus = (typeof ATTACHMENT_READ_STATUSES)[number]

/** Largest file the server accepts (keep the client's check in step). */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
