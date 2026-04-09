'use client'

import { useMemo } from 'react'
import { useCdnStore } from '../store/cdnStore'


export default function Sidebar({ onFetch }) {
  const local = useCdnStore((s) => s.local)
  const stats = useCdnStore((s) => s.stats)
  const socket = useCdnStore((s) => s.socket)
  const tmMetrics = useCdnStore((s) => s.tmMetrics)
  const originMetrics = useCdnStore((s) => s.originMetrics)

  const cacheHits = tmMetrics?.global_hits ?? 0
  const cacheMisses = tmMetrics?.global_misses ?? 0

  const cacheRatio = useMemo(() => {
    const total = cacheHits + cacheMisses
    if (total === 0) return 0
    return cacheHits / total
  }, [cacheHits, cacheMisses])

  // Real latency: measured end-to-end RTT from last actual fetch
  const lastLatencyMs = stats.lastLatencyMs
  const lastEdgeNode = stats.lastEdgeNode

  return (
    <div className="h-full w-full rounded-xl bg-surface border border-white/10 p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="text-lg font-semibold tracking-wide">CDN Control</div>
        <div
          className={`text-xs px-2 py-1 rounded-full border ${socket.connected ? 'border-emerald-400/40 text-emerald-200' : 'border-rose-400/40 text-rose-200'
            }`}
        >
          {socket.connected ? 'LIVE' : 'OFFLINE'}
        </div>
      </div>

      <div className="rounded-lg bg-panel border border-white/10 p-3">
        <div className="text-xs text-slate-300">Current Region</div>
        <div className="mt-1 font-mono text-sm">{local.region}</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-panel border border-white/10 p-3 col-span-2">
          <div className="text-xs text-slate-300">Live Traffic Control</div>
          <div className="mt-1 flex flex-col gap-1 text-xs font-mono">
            {tmMetrics?.nodes?.map((n) => (
              <div key={n.name} className="flex justify-between">
                <span>Edge {n.name} ({n.region})</span>
                <span className={n.status === 'ONLINE' ? 'text-emerald-400' : 'text-rose-400'}>
                  {n.status === 'ONLINE' ? `${n.active_connections} conn | ${n.cache_size} cached` : 'OFFLINE'} | {n.rtt_latency_ms}ms
                </span>
              </div>
            )) || 'Waiting for TM metrics...'}
          </div>
        </div>

        <div className="rounded-lg bg-panel border border-white/10 p-3 col-span-2">
          <div className="flex justify-between text-xs text-slate-300">
            <span>Origin Storage</span>
            <span>Files cached: {tmMetrics?.nodes?.reduce((a, n) => a + n.active_connections, 0) ?? '—'} active conns</span>
          </div>
          <div className="mt-1 text-xs font-mono">
            Files in Source: {originMetrics ? originMetrics.total_files : 'Waiting...'}
          </div>
        </div>

        <div className="rounded-lg bg-panel border border-white/10 p-3">
          <div className="text-xs text-slate-300">Last RTT</div>
          <div className="mt-1 font-mono text-sm">
            {lastLatencyMs == null ? '—' : `${lastLatencyMs} ms`}
          </div>
          {lastEdgeNode && (
            <div className="text-xs text-slate-400 mt-1">via Edge {lastEdgeNode}</div>
          )}
        </div>
        <div className="rounded-lg bg-panel border border-white/10 p-3">
          <div className="text-xs text-slate-300">Cache Ratio</div>
          <div className="mt-1 font-mono text-sm">{`${Math.round(cacheRatio * 100)}%`}</div>
        </div>
        <div className="rounded-lg bg-panel border border-white/10 p-3">
          <div className="text-xs text-slate-300">Hits</div>
          <div className="mt-1 font-mono text-sm">{cacheHits}</div>
        </div>
        <div className="rounded-lg bg-panel border border-white/10 p-3">
          <div className="text-xs text-slate-300">Misses</div>
          <div className="mt-1 font-mono text-sm">{cacheMisses}</div>
        </div>
      </div>

      <button
        type="button"
        onClick={onFetch}
        className="mt-auto w-full rounded-lg bg-cyan-400/15 hover:bg-cyan-400/25 border border-cyan-300/40 text-cyan-100 py-3 font-semibold tracking-wide"
      >
        Fetch Data
      </button>

      <div className="text-xs text-slate-400">
        {local.coords ? `Your coords: ${local.coords.lat.toFixed(2)}, ${local.coords.lon.toFixed(2)}` : 'Locating…'}
      </div>
    </div>
  )
}

