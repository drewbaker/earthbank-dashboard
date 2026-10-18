<script setup lang="ts">
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force'
import { computed, ref, watch } from 'vue'
import { navigateTo } from '#imports'
import type { FundNetwork } from '#shared/schemas/index.ts'

const props = defineProps<{ network: FundNetwork }>()

type GraphNode = SimulationNodeDatum & FundNetwork['nodes'][number]
type GraphLink = SimulationLinkDatum<GraphNode> & { relation: FundNetwork['edges'][number]['relation'] }

const WIDTH = 760
const HEIGHT = 480
// The layout is computed once per network (300 ticks), then drawn as static SVG.
const SETTLE_TICKS = 300

const nodes = ref<GraphNode[]>([])
const links = ref<GraphLink[]>([])
const hoveredId = ref<string | null>(null)

watch(
    () => props.network,
    network => {
        const graphNodes: GraphNode[] = network.nodes.map(node => ({ ...node }))
        const graphLinks: GraphLink[] = network.edges.map(edge => ({
            source: edge.source,
            target: edge.target,
            relation: edge.relation,
        }))
        forceSimulation(graphNodes)
            .force(
                'link',
                forceLink<GraphNode, GraphLink>(graphLinks)
                    .id(node => node.id)
                    .distance(70),
            )
            .force('charge', forceManyBody().strength(-220))
            .force('center', forceCenter(WIDTH / 2, HEIGHT / 2))
            .force('collide', forceCollide(28))
            .stop()
            .tick(SETTLE_TICKS)
        nodes.value = graphNodes
        links.value = graphLinks
    },
    { immediate: true },
)

const hoveredNeighbors = computed(() => {
    const ids = new Set<string>()
    if (!hoveredId.value) {
        return ids
    }
    ids.add(hoveredId.value)
    for (const link of links.value) {
        const source = (link.source as GraphNode).id
        const target = (link.target as GraphNode).id
        if (source === hoveredId.value) {
            ids.add(target)
        }
        if (target === hoveredId.value) {
            ids.add(source)
        }
    }
    return ids
})

/**
 * The class that colors a node by what it is.
 *
 * @param input.node - The node.
 * @returns A semantic fill class.
 */
function nodeClass({ node }: { node: GraphNode }) {
    if (node.kind === 'fund') {
        return node.is_focus ? 'network-node--focus' : 'network-node--fund'
    }
    if (node.kind === 'person') {
        return 'network-node--person'
    }
    return node.organization_kind === 'school' ? 'network-node--school' : 'network-node--organization'
}

/**
 * Open a node's fund profile, when it has one.
 *
 * @param input.node - The clicked node.
 * @returns Resolves after navigation.
 */
async function openNode({ node }: { node: GraphNode }) {
    if (node.fund_id && !node.is_focus) {
        await navigateTo(`/funds/${node.fund_id}`)
    }
}
</script>

<template>
    <div class="space-y-2">
        <div class="flex flex-wrap gap-3 text-xs text-muted">
            <span class="flex items-center gap-1"><span class="network-swatch network-node--focus" /> This fund</span>
            <span class="flex items-center gap-1"><span class="network-swatch network-node--person" /> Team</span>
            <span class="flex items-center gap-1"
                ><span class="network-swatch network-node--organization" /> Past employer</span
            >
            <span class="flex items-center gap-1"><span class="network-swatch network-node--school" /> School</span>
            <span class="flex items-center gap-1"
                ><span class="network-swatch network-node--fund" /> Other fund on the list</span
            >
        </div>
        <svg
            :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
            class="h-auto w-full rounded-md border border-default bg-default"
            role="img"
            aria-label="Team network"
        >
            <line
                v-for="(link, index) in links"
                :key="index"
                :x1="(link.source as GraphNode).x"
                :y1="(link.source as GraphNode).y"
                :x2="(link.target as GraphNode).x"
                :y2="(link.target as GraphNode).y"
                class="network-link"
                :class="{
                    'is-dimmed':
                        hoveredId &&
                        !(
                            hoveredNeighbors.has((link.source as GraphNode).id) &&
                            hoveredNeighbors.has((link.target as GraphNode).id)
                        ),
                }"
                :stroke-dasharray="link.relation === 'education' ? '4 3' : undefined"
            />
            <g
                v-for="node in nodes"
                :key="node.id"
                :transform="`translate(${node.x ?? 0},${node.y ?? 0})`"
                :class="{
                    'is-dimmed': hoveredId && !hoveredNeighbors.has(node.id),
                    'cursor-pointer': node.fund_id && !node.is_focus,
                }"
                @mouseenter="hoveredId = node.id"
                @mouseleave="hoveredId = null"
                @click="openNode({ node })"
            >
                <circle
                    :r="node.kind === 'person' ? 6 : node.is_focus ? 12 : 9"
                    class="network-node"
                    :class="nodeClass({ node })"
                />
                <text :y="node.kind === 'person' ? 16 : 22" text-anchor="middle" class="network-label">
                    {{ node.label }}
                </text>
            </g>
        </svg>
    </div>
</template>

<style scoped>
.network-link {
    stroke: var(--ui-border-accented);
    stroke-width: 1;
}
.network-node {
    stroke: var(--ui-bg);
    stroke-width: 2;
}
.network-node--focus {
    fill: var(--ui-primary);
}
.network-node--fund {
    fill: var(--ui-secondary);
}
.network-node--person {
    fill: var(--ui-text-muted);
}
.network-node--organization {
    fill: var(--ui-warning);
}
.network-node--school {
    fill: var(--ui-info);
}
.network-label {
    fill: var(--ui-text);
    font-size: 10px;
    pointer-events: none;
}
.network-swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 9999px;
    background-color: currentColor;
}
.network-swatch.network-node--focus {
    background-color: var(--ui-primary);
}
.network-swatch.network-node--fund {
    background-color: var(--ui-secondary);
}
.network-swatch.network-node--person {
    background-color: var(--ui-text-muted);
}
.network-swatch.network-node--organization {
    background-color: var(--ui-warning);
}
.network-swatch.network-node--school {
    background-color: var(--ui-info);
}
.is-dimmed {
    opacity: 0.2;
}
</style>
