import type { TableColumn } from '@nuxt/ui'
import type { Column, RowData } from '@tanstack/vue-table'
import { h } from 'vue'
import { UButton, UIcon, UTooltip } from '#components'
import type { GlossaryTerm } from '~/utils/glossary.ts'
import { GLOSSARY } from '~/utils/glossary.ts'

declare module '@tanstack/vue-table' {
    // Columns can name a glossary term to explain in their header.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface ColumnMeta<TData extends RowData, TValue> {
        term?: GlossaryTerm
    }
}

/**
 * Make every column with a text header sortable by clicking it: first click sorts ascending, the
 * next descending. Columns opt out with `enableSorting: false` (or an empty or custom header), and
 * `meta.term` adds a hover explanation from the glossary next to the header.
 * Missing values sort last either way; columns whose cell isn't a plain value give an `accessorFn`
 * that returns what to sort by.
 *
 * @param input.columns - The table's columns.
 * @returns The same columns with clickable headers.
 */
export function sortableColumns<Row>({ columns }: { columns: TableColumn<Row>[] }): TableColumn<Row>[] {
    return columns.map(column => {
        const label = column.header
        if (column.enableSorting === false || typeof label !== 'string' || !label) {
            return column
        }
        return {
            sortUndefined: 'last',
            ...column,
            header: ({ column: tableColumn }: { column: Column<Row> }) =>
                sortHeader({ label, tableColumn, term: column.meta?.term }),
        } as TableColumn<Row>
    })
}

/**
 * A header button showing the column's sort state.
 *
 * Nuxt UI components aren't registered globally, so the button is imported, not resolved by name.
 *
 * @param input.label - The column's name.
 * @param input.tableColumn - TanStack's column, for its sort state.
 * @param input.term - Glossary term to explain on hover, if any.
 * @returns The header content.
 */
function sortHeader<Row>({
    label,
    tableColumn,
    term,
}: {
    label: string
    tableColumn: Column<Row>
    term?: GlossaryTerm
}) {
    const sorted = tableColumn.getIsSorted()
    const button = h(UButton, {
        label,
        color: 'neutral',
        variant: 'ghost',
        size: 'sm',
        class: '-mx-2.5 font-medium',
        trailingIcon:
            sorted === 'asc'
                ? 'i-lucide-arrow-up-narrow-wide'
                : sorted === 'desc'
                  ? 'i-lucide-arrow-down-wide-narrow'
                  : 'i-lucide-arrow-up-down',
        'aria-label': `Sort by ${label}`,
        onClick: () => tableColumn.toggleSorting(sorted === 'asc'),
    })
    if (!term) {
        return button
    }
    return h('span', { class: 'inline-flex items-center' }, [
        button,
        h(UTooltip, { text: GLOSSARY[term] }, () =>
            h(
                'span',
                {
                    class: 'inline-flex size-6 cursor-help items-center justify-center rounded-full text-muted hover:bg-elevated hover:text-highlighted',
                    tabindex: 0,
                    role: 'img',
                    'aria-label': GLOSSARY[term],
                },
                [h(UIcon, { name: 'i-lucide-info', class: 'size-3.5' })],
            ),
        ),
    ])
}
