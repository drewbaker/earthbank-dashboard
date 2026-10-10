import type { NavigationMenuItem } from '@nuxt/ui'

// The sidebar. Adding a page means adding its route file and one entry here.
export const primaryNavigation: NavigationMenuItem[] = [
    { label: 'Overview', icon: 'i-lucide-layout-dashboard', to: '/' },
    { label: 'Pipeline', icon: 'i-lucide-hand-coins', to: '/pipeline' },
    { label: 'Forecast', icon: 'i-lucide-chart-line', to: '/forecast' },
    { label: 'Milestones & Tasks', icon: 'i-lucide-list-checks', to: '/milestones' },
    { label: 'Activity', icon: 'i-lucide-activity', to: '/activity' },
]

export const secondaryNavigation: NavigationMenuItem[] = [
    { label: 'Settings', icon: 'i-lucide-settings', to: '/settings' },
]
