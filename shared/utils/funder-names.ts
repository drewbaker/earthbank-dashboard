/**
 * The key two funder names share when they mean the same organization.
 *
 * @param input.name - Organization name as typed.
 * @returns Lowercased name with punctuation and repeated spaces removed.
 */
export function funderNameKey({ name }: { name: string }) {
    return name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
}
