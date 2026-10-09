// Covers the rules that decide which Google accounts may sign in, and the redirect guard.
import { describe, expect, it } from 'vitest'
import { checkWorkspaceIdentity, safeRedirectPath } from '#server/utils/auth/google.ts'

const workspaceDomain = 'theearthbank.org'
const validPayload = {
    sub: '1234567890',
    email: 'Drew@TheEarthBank.org',
    email_verified: true,
    hd: 'theearthbank.org',
    name: 'Drew Baker',
    picture: 'https://example.com/drew.png',
}

describe('checkWorkspaceIdentity', () => {
    it('accepts a verified Earth Bank Workspace account and lowercases the email', () => {
        expect(checkWorkspaceIdentity({ payload: validPayload, workspaceDomain })).toEqual({
            identity: {
                googleSub: '1234567890',
                email: 'drew@theearthbank.org',
                name: 'Drew Baker',
                avatarUrl: 'https://example.com/drew.png',
            },
        })
    })

    it('rejects personal Gmail accounts (no hd claim)', () => {
        const payload = { ...validPayload, email: 'drew@gmail.com', hd: undefined }
        expect(checkWorkspaceIdentity({ payload, workspaceDomain })).toEqual({ rejection: 'wrong_workspace' })
    })

    it('rejects other Workspaces', () => {
        const payload = { ...validPayload, email: 'someone@resolvefund.com', hd: 'resolvefund.com' }
        expect(checkWorkspaceIdentity({ payload, workspaceDomain })).toEqual({ rejection: 'wrong_workspace' })
    })

    it('rejects an email outside the domain even when hd matches', () => {
        const payload = { ...validPayload, email: 'drew@example.com' }
        expect(checkWorkspaceIdentity({ payload, workspaceDomain })).toEqual({ rejection: 'wrong_email_domain' })
    })

    it('rejects unverified emails', () => {
        const payload = { ...validPayload, email_verified: false }
        expect(checkWorkspaceIdentity({ payload, workspaceDomain })).toEqual({ rejection: 'email_not_verified' })
    })

    it('rejects payloads without subject or email', () => {
        expect(checkWorkspaceIdentity({ payload: null, workspaceDomain })).toEqual({ rejection: 'missing_claims' })
        expect(checkWorkspaceIdentity({ payload: { ...validPayload, sub: undefined }, workspaceDomain })).toEqual({
            rejection: 'missing_claims',
        })
    })
})

describe('safeRedirectPath', () => {
    it('keeps same-site paths', () => {
        expect(safeRedirectPath({ redirect: '/pipeline?goal=opex' })).toBe('/pipeline?goal=opex')
    })

    it('rejects other sites and protocol-relative URLs', () => {
        expect(safeRedirectPath({ redirect: 'https://evil.example' })).toBe('/')
        expect(safeRedirectPath({ redirect: '//evil.example' })).toBe('/')
        expect(safeRedirectPath({ redirect: '/\\evil.example' })).toBe('/')
        expect(safeRedirectPath({ redirect: undefined })).toBe('/')
    })
})
