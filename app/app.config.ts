// Colors match the Earth Bank loans app (loans.theearthbank.org) so the two products feel like one.
export default {
    ui: {
        colors: {
            primary: 'green',
            secondary: 'blue',
            success: 'green',
            info: 'blue',
            warning: 'yellow',
            error: 'red',
            neutral: 'zinc',
        },
        button: { defaultVariants: { variant: 'soft' } },
        badge: { defaultVariants: { variant: 'soft' } },
        input: { defaultVariants: { variant: 'soft' } },
        textarea: { defaultVariants: { variant: 'soft' } },
        select: { defaultVariants: { variant: 'soft' } },
        selectMenu: { defaultVariants: { variant: 'soft' } },
        inputMenu: { defaultVariants: { variant: 'soft' } },
        inputNumber: { defaultVariants: { variant: 'soft' } },
        // Tooltips wrap instead of cutting text off with "…", up to 300px (or 80% of a narrow screen).
        tooltip: {
            slots: {
                content: 'h-auto max-w-[min(300px,80vw)] py-1.5',
                text: 'whitespace-normal [overflow-wrap:anywhere]',
            },
        },
    },
}
