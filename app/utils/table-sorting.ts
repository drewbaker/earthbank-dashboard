import type { TableColumn } from '@nuxt/ui'
import type { Column } from '@tanstack/vue-table'
import { h } from 'vue'
import { UButton } from '#components'

/**
 * Make every column with a text header sortable by clicking it: first click sorts ascending, the
 * next descending. Columns opt out with `enableSorting: false` (or an empty or custom header).
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
            header: ({ column: tableColumn }: { column: Column<Row> }) => sortHeader({ label, tableColumn }),
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
 * @returns The header content.
 */
function sortHeader<Row>({ label, tableColumn }: { label: string; tableColumn: Column<Row> }) {
    const sorted = tableColumn.getIsSorted()
    return h(UButton, {
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
}
