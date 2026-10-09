export type EmailMessage = { to: string; subject: string; html: string; text: string }

export interface EmailProvider {
    name: string
    send(input: EmailMessage): Promise<{ id: string | null }>
}
