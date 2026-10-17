// Profile pictures people upload in Settings → Profile. Only common raster formats are accepted,
// checked by their first bytes rather than the name or the browser's claimed type, so an SVG or HTML
// file can never be stored and served as a picture.

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024

const AVATAR_FORMATS = [
    { extension: 'png', contentType: 'image/png', signature: [0x89, 0x50, 0x4e, 0x47] },
    { extension: 'jpg', contentType: 'image/jpeg', signature: [0xff, 0xd8, 0xff] },
    { extension: 'gif', contentType: 'image/gif', signature: [0x47, 0x49, 0x46, 0x38] },
    // RIFF....WEBP: the first four bytes; the format name is checked separately below.
    { extension: 'webp', contentType: 'image/webp', signature: [0x52, 0x49, 0x46, 0x46] },
] as const

export type AvatarFormat = (typeof AVATAR_FORMATS)[number]

/**
 * The image format of an uploaded picture, from its first bytes.
 *
 * @param input.data - The file contents.
 * @returns The format, or null when it isn't a PNG, JPEG, GIF or WebP image.
 */
export function detectAvatarFormat({ data }: { data: Uint8Array }) {
    const format = AVATAR_FORMATS.find(candidate => candidate.signature.every((byte, index) => data[index] === byte))
    if (format?.extension === 'webp' && new TextDecoder().decode(data.slice(8, 12)) !== 'WEBP') {
        return null
    }
    return format ?? null
}

/**
 * The content type to serve a stored picture with, from its storage key's extension.
 *
 * @param input.storageKey - e.g. `users/usr_…/avatar-1760000000000.png`.
 * @returns The content type, or null for anything that isn't a picture format we store.
 */
export function avatarContentType({ storageKey }: { storageKey: string }) {
    const extension = storageKey.split('.').at(-1)
    return AVATAR_FORMATS.find(format => format.extension === extension)?.contentType ?? null
}
