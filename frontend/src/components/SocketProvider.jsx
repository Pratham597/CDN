'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { useCdnStore } from '../store/cdnStore'

const SocketContext = createContext(null)

export function SocketProvider({ children }) {
  const [socket, setSocket] = useState(null)
  const setSocketState = useCdnStore((s) => s.setSocketState)
  const addLog = useCdnStore((s) => s.addLog)
  const upsertRemoteUserNode = useCdnStore((s) => s.upsertRemoteUserNode)
  const spawnRequest = useCdnStore((s) => s.spawnRequest)
  const socketIdRef = useRef(null)

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://127.0.0.1:4000'
    const s = io(url, { transports: ['websocket'] })

    s.on('connect', () => {
      socketIdRef.current = s.id
      setSocketState({ id: s.id, connected: true })
      addLog(`Socket connected (${s.id.slice(0, 6)})`)
    })

    s.on('disconnect', () => {
      setSocketState({ connected: false })
      addLog('Socket disconnected')
    })

    s.on('cdn:log', (payload) => {
      if (!payload || typeof payload.message !== 'string') return
      addLog(payload.message)
    })

    s.on('cdn:request', (payload) => {
      if (!payload || !payload.coords) return
      if (payload.sourceSocketId && payload.sourceSocketId === socketIdRef.current) return

      const userKey = String(payload.userKey || payload.sourceSocketId || 'remote')
      const coords = payload.coords
      const fileName = payload.fileName || 'data'
      const cacheStatus = payload.cacheStatus === 'HIT' ? 'HIT' : 'MISS'
      const forceEdgeId = payload.forceEdgeId
      const latencyMs = typeof payload.latencyMs === 'number' ? payload.latencyMs : null

      const userNodeId = upsertRemoteUserNode({ userKey, coords })
      spawnRequest({ userNodeId, userKey, coords, fileName, cacheStatus, forceEdgeId, latencyMs })
    })

    setSocket(s)
    return () => {
      s.disconnect()
    }
  }, [addLog, setSocketState, spawnRequest, upsertRemoteUserNode])

  const emitRequest = useCallback(
    (payload) => {
      if (!socket || !socket.connected) return
      socket.emit('cdn:request', payload)
    },
    [socket]
  )

  const value = useMemo(() => ({ socket, emitRequest }), [socket, emitRequest])

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
}

export function useSocket() {
  return useContext(SocketContext)
}

