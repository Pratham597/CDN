export const AHMEDABAD_FALLBACK = { lat: 23.02, lon: 72.57 }

export function haversineKm(a, b) {
  const R = 6371
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
  return R * c
}

export function getNearestEdge(userCoords, edgeNodes) {
  if (!userCoords || !Number.isFinite(userCoords.lat) || !Number.isFinite(userCoords.lon)) {
    return null
  }

  let best = null
  for (const edge of edgeNodes) {
    const d = haversineKm(userCoords, edge.coords)
    if (!best || d < best.distanceKm) {
      best = { ...edge, distanceKm: d }
    }
  }
  return best
}

export async function resolveUserCoords() {
  if (typeof window === 'undefined') return AHMEDABAD_FALLBACK

  const geoPromise = new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('geolocation_unavailable'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 2500, maximumAge: 60_000 }
    )
  })

  try {
    return await geoPromise
  } catch {}

  try {
    const res = await fetch('https://ipapi.co/json/')
    if (!res.ok) throw new Error('ipapi_failed')
    const data = await res.json()
    const lat = Number(data.latitude)
    const lon = Number(data.longitude)
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon }
  } catch {}

  return AHMEDABAD_FALLBACK
}

export function coordsToFlowPosition(
  coords,
  canvas = { width: 1000, height: 600 },
  padding = 90
) {
  const lon = Math.max(-180, Math.min(180, coords.lon))
  const lat = Math.max(-90, Math.min(90, coords.lat))

  const w = Math.max(1, canvas.width - padding * 2)
  const h = Math.max(1, canvas.height - padding * 2)

  const x = padding + ((lon + 180) / 360) * w
  const y = padding + ((90 - lat) / 180) * h

  return { x, y }
}
