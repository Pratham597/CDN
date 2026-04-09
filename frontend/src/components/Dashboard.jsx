'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import CDNCanvas from './CDNCanvas'
import Sidebar from './Sidebar'
import BottomLog from './BottomLog'
import { useSocket } from './SocketProvider'
import { resolveUserCoords } from '../lib/geo'
import { useCdnStore } from '../store/cdnStore'



export default function Dashboard() {
  const { socket, emitRequest } = useSocket()
  const [clientKey] = useState(() => {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
    return `${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`
  })

  const local = useCdnStore((s) => s.local)
  const setLocalCoords = useCdnStore((s) => s.setLocalCoords)
  const spawnRequest = useCdnStore((s) => s.spawnRequest)
  const addLog = useCdnStore((s) => s.addLog)
  const resetGraph = useCdnStore((s) => s.resetGraph)

  const userKey = useMemo(() => {
    if (socket?.id) return socket.id
    return clientKey
  }, [clientKey, socket?.id])

  useEffect(() => {
    let cancelled = false
    resetGraph()
    resolveUserCoords().then((coords) => {
      if (cancelled) return
      setLocalCoords(coords)
      addLog(`Geo initialized (${coords.lat.toFixed(2)}, ${coords.lon.toFixed(2)})`)
    })
    return () => {
      cancelled = true
    }
  }, [addLog, resetGraph, setLocalCoords])

  useEffect(() => {
    const tmInterval = setInterval(async () => {
      try {
        const res = await fetch('http://127.0.0.1:4000/metrics')
        if (res.ok) {
          const data = await res.json()
          useCdnStore.setState({ tmMetrics: data })
        }
      } catch (e) {}
    }, 5000)

    const originInterval = setInterval(async () => {
      try {
        const res = await fetch('http://127.0.0.1:5000/metrics')
        if (res.ok) {
          const data = await res.json()
          useCdnStore.setState({ originMetrics: data })
        }
      } catch (e) {}
    }, 5000)

    return () => {
      clearInterval(tmInterval)
      clearInterval(originInterval)
    }
  }, [])

  const onFetch = useCallback(async () => {
    if (!local.coords) return
    const fileName = 'test.txt'
    const startTime = Date.now()

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s to match TM proxy
      
      const regionParam = local.nearestEdgeId === 'edge-ap-south' ? 'Asia' : local.nearestEdgeId === 'edge-eu-central' ? 'Europe' : 'America';
      const res = await fetch(`http://127.0.0.1:4000/file/${fileName}?region=${regionParam}`, { signal: controller.signal })
      clearTimeout(timeoutId);
      
      const endTime = Date.now()
      const latencyMs = endTime - startTime
      const cacheStatus = res.headers.get("X-Cache") || "MISS"

      // TM proxy sets X-Edge-Node header (A/B/C)
      const edgeNode = res.headers.get("X-Edge-Node") || ''
      let edgeId = local.nearestEdgeId || 'edge-us-east'
      if (edgeNode === 'A') edgeId = 'edge-us-east'
      else if (edgeNode === 'B') edgeId = 'edge-eu-central'
      else if (edgeNode === 'C') edgeId = 'edge-ap-south'

      spawnRequest({
        userNodeId: 'user',
        userKey,
        coords: local.coords,
        fileName,
        cacheStatus,
        forceEdgeId: edgeId,
        latencyMs
      })

      emitRequest({
        userKey,
        sourceSocketId: socket?.id || null,
        coords: local.coords,
        fileName,
        cacheStatus,
        forceEdgeId: edgeId,
        latencyMs
      })
    } catch (e) {
      addLog(`Fetch failed: ${e.message}`)
    }
  }, [emitRequest, local.coords, local.nearestEdgeId, socket?.id, spawnRequest, userKey, addLog])

  return (
    <div className="h-screen w-screen bg-black">
      <div className="h-full w-full p-4 grid grid-cols-[320px_1fr] grid-rows-[1fr_220px] gap-4">
        <div className="row-span-2">
          <Sidebar onFetch={onFetch} />
        </div>
        <div className="min-h-0">
          <CDNCanvas />
        </div>
        <div className="min-h-0">
          <BottomLog />
        </div>
      </div>
    </div>
  )
}
