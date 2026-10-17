// Covers which uploads are accepted as profile pictures: real PNG, JPEG, GIF and WebP files only,
// judged by their bytes, so an SVG or HTML file renamed .png is refused.
import { describe, expect, it } from 'vitest'
import { avatarContentType, detectAvatarFormat } from '#server/utils/avatars.ts'

const bytes = (...values: number[]) => new Uint8Array([...values, ...new Array(16).fill(0)])

describe('detectAvatarFormat', () => {
    it('recognizes PNG, JPEG and GIF by their signatures', () => {
        expect(detectAvatarFormat({ data: bytes(0x89, 0x50, 0x4e, 0x47) })?.extension).toBe('png')
        expect(detectAvatarFormat({ data: bytes(0xff, 0xd8, 0xff, 0xe0) })?.extension).toBe('jpg')
        expect(detectAvatarFormat({ data: bytes(0x47, 0x49, 0x46, 0x38) })?.extension).toBe('gif')
    })

    it('needs the WEBP marker, not just a RIFF header (a WAV file is RIFF too)', () => {
        const riff = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]
        const webp = new TextEncoder().encode('WEBP')
        const wave = new TextEncoder().encode('WAVE')
        expect(detectAvatarFormat({ data: new Uint8Array([...riff, ...webp]) })?.extension).toBe('webp')
        expect(detectAvatarFormat({ data: new Uint8Array([...riff, ...wave]) })).toBeNull()
    })

    it('refuses SVG and HTML', () => {
        expect(
            detectAvatarFormat({ data: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">') }),
        ).toBeNull()
        expect(detectAvatarFormat({ data: new TextEncoder().encode('<!doctype html><script>') })).toBeNull()
    })
})

describe('avatarContentType', () => {
    it('serves stored pictures by extension, and nothing else', () => {
        expect(avatarContentType({ storageKey: 'users/usr_1/avatar-1.webp' })).toBe('image/webp')
        expect(avatarContentType({ storageKey: 'users/usr_1/avatar-1.svg' })).toBeNull()
    })
})
