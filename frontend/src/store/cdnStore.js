import { create } from 'zustand'
import { getNearestEdge } from '../lib/geo'

const CANVAS = { width: 1000, height: 600 }
const GRAPH_VERSION = 3  // bumped — layout changed

// Layout: Origin (top) → Edges (middle) → User (bottom)
const ORIGIN_POS  = { x: 390, y: 40  }   // top center
const EDGE_POS = {
  'edge-us-east':   { x: 80,  y: 260 },   // middle left
  'edge-eu-central':{ x: 390, y: 260 },   // middle center
  'edge-ap-south':  { x: 700, y: 260 },   // middle right
}

const EDGE_NODES = [
  { id: 'edge-us-east', name: 'US-East', region: 'us-east-1', coords: { lat: 37.5, lon: -77.4 } },
  { id: 'edge-eu-central', name: 'EU-Central', region: 'eu-central-1', coords: { lat: 50.11, lon: 8.68 } },
  { id: 'edge-ap-south', name: 'AP-South', region: 'ap-south-1', coords: { lat: 19.08, lon: 72.88 } },
]

const ORIGIN_NODE = { id: 'origin', name: 'Origin', region: 'origin', coords: { lat: 0, lon: 0 } }

function nowIso() {
  return new Date().toISOString()
}

function shortTime() {
  return new Date().toTimeString().slice(0, 8)
}

function makeId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}:${crypto.randomUUID()}`
  return `${prefix}:${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`
}

function colorFromKey(key) {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360
  return `hsl(${h} 90% 60%)`
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function jitterForKey(key, radius = 28) {
  let seed = 0
  for (let i = 0; i < key.length; i++) seed = (seed * 33 + key.charCodeAt(i)) >>> 0
  const angle = ((seed % 360) * Math.PI) / 180
  const r = radius * (0.6 + ((seed % 97) / 97) * 0.4)
  return { dx: Math.cos(angle) * r, dy: Math.sin(angle) * r }
}

function baseUserPosForEdgeId(_edgeId) {
  // User always sits at the bottom row, centered
  return { x: 390, y: 470 }
}

function buildBaseNodes() {
  const origin = {
    id: ORIGIN_NODE.id,
    type: 'cdn',
    position: { x: ORIGIN_POS.x, y: ORIGIN_POS.y },
    data: { title: 'Origin Server', subtitle: 'Source of truth', kind: 'origin' },
    sourcePosition: 'bottom',  // connects DOWN to edge nodes
    targetPosition: 'top',
  }

  const edges = EDGE_NODES.map((edge) => {
    return {
      id: edge.id,
      type: 'cdn',
      position: EDGE_POS[edge.id] || { x: 390, y: 260 },
      data: { title: `Edge ${edge.name}`, subtitle: edge.region, kind: 'edge' },
      targetPosition: 'top',    // receives from origin above
      sourcePosition: 'bottom', // connects DOWN to user
    }
  })

  const localUser = {
    id: 'user',
    type: 'cdn',
    position: { x: 390, y: 470 },
    data: { title: 'You', subtitle: 'Locating…', kind: 'user', accent: 'rgba(34,197,94,0.9)' },
    sourcePosition: 'top',     // connects UP to edge node
    targetPosition: 'bottom',
  }

  return [localUser, origin, ...edges]
}

function buildBaseEdges() {
  // Static backbone lines: Origin (top) → each Edge (middle)
  return EDGE_NODES.map((edge) => ({
    id: `e:${ORIGIN_NODE.id}:${edge.id}`,
    source: ORIGIN_NODE.id,   // origin is source (top)
    target: edge.id,           // edge is target (middle)
    type: 'smoothstep',
    animated: false,
    style: { stroke: 'rgba(148,163,184,0.35)' },
  }))
}

function computeRegionFromNearest(nearest) {
  if (!nearest) return { region: 'unknown', nearestEdgeId: null, distanceKm: null }
  return { region: nearest.region, nearestEdgeId: nearest.id, distanceKm: nearest.distanceKm }
}

function buildPath({ userNodeId, edgeId, cacheStatus }) {
  if (cacheStatus === 'HIT') return [userNodeId, edgeId, userNodeId]
  return [userNodeId, edgeId, ORIGIN_NODE.id, edgeId, userNodeId]
}

export const useCdnStore = create((set, get) => ({
  graphVersion: GRAPH_VERSION,
  nodes: buildBaseNodes(),
  edges: buildBaseEdges(),
  edgeCatalog: EDGE_NODES,
  origin: ORIGIN_NODE,
  local: {
    coords: null,
    region: 'unknown',
    nearestEdgeId: null,
    distanceKm: null,
  },
  socket: {
    id: null,
    connected: false,
  },
  stats: {
    cacheHits: 0,
    cacheMisses: 0,
    lastLatencyMs: null,   // real measured RTT from last fetch
    lastEdgeNode: null,    // last edge that served the request
  },
  logs: [],
  activeRequests: [],
  tmMetrics: null,
  originMetrics: null,

  resetGraph: () => {
    set((s) => ({
      graphVersion: GRAPH_VERSION,
      nodes: buildBaseNodes(),
      edges: buildBaseEdges(),
      activeRequests: [],
      tmMetrics: null,
      originMetrics: null,
      local: { ...s.local, coords: null, region: 'unknown', nearestEdgeId: null, distanceKm: null },
    }))
  },

  setSocketState: (next) => {
    set((s) => ({ socket: { ...s.socket, ...next } }))
  },

  addLog: (message) => {
    const entry = { id: makeId('log'), ts: nowIso(), time: shortTime(), message }
    set((s) => {
      const next = [...s.logs, entry]
      return { logs: next.slice(-300) }
    })
  },

  setLocalCoords: (coords) => {
    const nearest = getNearestEdge(coords, get().edgeCatalog.map((e) => ({ ...e, coords: e.coords })))
    const localInfo = computeRegionFromNearest(nearest)
    const userBase = baseUserPosForEdgeId(localInfo.nearestEdgeId)
    const userPos = { x: clamp(userBase.x - 110, 20, CANVAS.width - 220), y: clamp(userBase.y, 20, CANVAS.height - 160) }

    set((s) => ({
      local: { coords, ...localInfo },
      nodes: s.nodes.map((n) =>
        n.id === 'user'
          ? {
              ...n,
              position: userPos,
              data: {
                ...n.data,
                title: 'You',
                subtitle: `${coords.lat.toFixed(2)}, ${coords.lon.toFixed(2)} • ${localInfo.region}`,
              },
            }
          : n
      ),
    }))
  },

  upsertRemoteUserNode: ({ userKey, coords }) => {
    const nodeId = `user:${userKey}`
    const nearest = getNearestEdge(coords, EDGE_NODES.map((e) => ({ ...e, coords: e.coords })))
    const base = baseUserPosForEdgeId(nearest?.id)
    const { dx, dy } = jitterForKey(userKey, 34)
    const jittered = {
      x: clamp(base.x + dx - 110, 20, CANVAS.width - 260),
      y: clamp(base.y + dy, 20, CANVAS.height - 180),
    }

    set((s) => {
      const exists = s.nodes.some((n) => n.id === nodeId)
      const node = {
        id: nodeId,
        type: 'cdn',
        position: jittered,
        data: {
          title: `User ${userKey.slice(0, 5)}`,
          subtitle: `${coords.lat.toFixed(2)}, ${coords.lon.toFixed(2)}`,
          kind: 'user',
          accent: colorFromKey(userKey),
        },
      }

      const nodes = exists ? s.nodes.map((n) => (n.id === nodeId ? node : n)) : [...s.nodes, node]
      return { nodes }
    })

    return nodeId
  },

  spawnRequest: ({ userNodeId, userKey, coords, fileName, cacheStatus, forceEdgeId, latencyMs }) => {
    const nearest = forceEdgeId 
      ? EDGE_NODES.find(e => e.id === forceEdgeId)
      : getNearestEdge(coords, EDGE_NODES.map((e) => ({ ...e, coords: e.coords })))
    if (!nearest) return

    const path = buildPath({ userNodeId, edgeId: nearest.id, cacheStatus })
    const requestId = makeId('req')
    const color = colorFromKey(userKey)

    const request = {
      id: requestId,
      userKey,
      userNodeId,
      coords,
      nearestEdgeId: nearest.id,
      nearestEdgeRegion: nearest.region,
      distanceKm: forceEdgeId ? null : nearest.distanceKm,
      fileName,
      cacheStatus,
      color,
      path,
      segmentIndex: 0,
      t: 0,
      speed: (path.length - 1) / Math.max(latencyMs || 500, 50),
      createdAt: nowIso(),
    }

    set((s) => ({
      activeRequests: [...s.activeRequests, request].slice(-250),
      stats:
        cacheStatus === 'HIT'
          ? { ...s.stats, cacheHits: s.stats.cacheHits + 1, lastLatencyMs: latencyMs ?? s.stats.lastLatencyMs, lastEdgeNode: nearest.name }
          : { ...s.stats, cacheMisses: s.stats.cacheMisses + 1, lastLatencyMs: latencyMs ?? s.stats.lastLatencyMs, lastEdgeNode: nearest.name },
    }))

    const prefix = userNodeId === 'user' ? 'You' : `User ${userKey.slice(0, 5)}`
    const latStr = latencyMs ? ` in ${latencyMs}ms` : ''
    get().addLog(`${prefix} hit ${nearest.name} (${nearest.region}): CACHE ${cacheStatus} (${fileName})${latStr}`)
  },

  tick: (dtMs) => {
    if (!dtMs || dtMs <= 0) return

    set((s) => {
      const next = []
      for (const r of s.activeRequests) {
        let segmentIndex = r.segmentIndex
        let t = r.t + dtMs * r.speed

        while (t >= 1 && segmentIndex < r.path.length - 2) {
          t -= 1
          segmentIndex += 1
        }

        const done = segmentIndex >= r.path.length - 2 && t >= 1
        if (!done) {
          next.push({ ...r, segmentIndex, t: Math.min(t, 1) })
        }
      }
      return { activeRequests: next }
    })
  },
}))

export function getEdgeCatalog() {
  return EDGE_NODES
}
