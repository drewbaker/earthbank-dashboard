<script setup lang="ts">
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from 'd3-force'
import { select } from 'd3-selection'
import type { ZoomBehavior, ZoomTransform } from 'd3-zoom'
import { zoom, zoomIdentity } from 'd3-zoom'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { navigateTo } from '#imports'
import type { FundNetwork } from '#shared/schemas/index.ts'

const props = defineProps<{ network: FundNetwork }>()

type GraphNode = SimulationNodeDatum & FundNetwork['nodes'][number]
type GraphLink = SimulationLinkDatum<GraphNode> & { relation: FundNetwork['edges'][number]['relation'] }

const WIDTH = 760
const HEIGHT = 480
// The layout is computed once per network (300 ticks), then drawn as static SVG.
const SETTLE_TICKS = 300
// How far people can zoom out (to see a big network) and in (to read crowded labels).
const ZOOM_EXTENT: [number, number] = [0.2, 6]
// Room around the nodes when fitting, so labels under the outer nodes stay visible.
const FIT_PADDING = 48

const nodes = ref<GraphNode[]>([])
const links = ref<GraphLink[]>([])
const hoveredId = ref<string | null>(null)
const svgElement = ref<SVGSVGElement | null>(null)
const viewTransform = ref<ZoomTransform>(zoomIdentity)
let zoomBehavior: ZoomBehavior<SVGSVGElement, unknown> | null = null

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
        nextTick(() => fitToView())
    },
    { immediate: true },
)

// Drag (mouse or touch) pans; the wheel, a trackpad pinch or a two-finger pinch zooms. d3-zoom
// ignores the click that ends a drag, so dragging across a fund doesn't open it.
onMounted(() => {
    if (!svgElement.value) {
        return
    }
    zoomBehavior = zoom<SVGSVGElement, unknown>()
        .scaleExtent(ZOOM_EXTENT)
        .on('zoom', event => {
            viewTransform.value = event.transform
        })
    select(svgElement.value).call(zoomBehavior)
    fitToView()
})

onBeforeUnmount(() => {
    if (svgElement.value) {
        select(svgElement.value).on('.zoom', null)
    }
})

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
 * Zoom and pan so the whole network fits the view.
 *
 * @returns Nothing.
 */
function fitToView() {
    if (!svgElement.value || !zoomBehavior || !nodes.value.length) {
        return
    }
    const xs = nodes.value.map(node => node.x ?? 0)
    const ys = nodes.value.map(node => node.y ?? 0)
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const scale = Math.min(
        WIDTH / (maxX - minX + FIT_PADDING * 2),
        HEIGHT / (maxY - minY + FIT_PADDING * 2),
        // Don't blow a tiny network up to giant circles.
        1.5,
    )
    const target = zoomIdentity
        .translate(WIDTH / 2, HEIGHT / 2)
        .scale(Math.max(scale, ZOOM_EXTENT[0]))
        .translate(-(minX + maxX) / 2, -(minY + maxY) / 2)
    zoomBehavior.transform(select(svgElement.value), target)
}

/**
 * Zoom in or out around the centre of the view (the + and − buttons).
 *
 * @param input.factor - Above 1 zooms in, below 1 out.
 * @returns Nothing.
 */
function zoomBy({ factor }: { factor: number }) {
    if (svgElement.value && zoomBehavior) {
        zoomBehavior.scaleBy(select(svgElement.value), factor)
    }
}

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
        <div class="relative">
            <svg
                ref="svgElement"
                :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
                class="network-canvas h-auto w-full rounded-md border border-default bg-default"
                role="img"
                aria-label="Team network: drag to pan, scroll or pinch to zoom"
            >
                <g :transform="viewTransform.toString()">
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
                </g>
            </svg>
            <div class="absolute top-2 right-2 flex flex-col gap-1">
                <UButton
                    icon="i-lucide-plus"
                    size="xs"
                    color="neutral"
                    aria-label="Zoom in"
                    @click="zoomBy({ factor: 1.5 })"
                />
                <UButton
                    icon="i-lucide-minus"
                    size="xs"
                    color="neutral"
                    aria-label="Zoom out"
                    @click="zoomBy({ factor: 1 / 1.5 })"
                />
                <UButton
                    icon="i-lucide-maximize"
                    size="xs"
                    color="neutral"
                    aria-label="Fit the whole network"
                    @click="fitToView()"
                />
            </div>
        </div>
        <p class="text-xs text-dimmed">Drag to move around; scroll or pinch to zoom.</p>
    </div>
</template>

<style scoped>
.network-canvas {
    cursor: grab;
    touch-action: none;
}
.network-canvas:active {
    cursor: grabbing;
}
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
