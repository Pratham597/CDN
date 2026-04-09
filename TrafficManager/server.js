import express from 'express';
import fetch from 'node-fetch';
import geoip from 'geoip-lite';
import dotenv from 'dotenv';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';

dotenv.config();

const app = express();
const PORT = 4000;

/**
 * Edge Nodes Configuration
 * Notice latency is now 0. It will be calculated dynamically!
 */
let nodes = [
    { name: "A", region: "America", url: `http://127.0.0.1:3001`, latency: 0, active: 0, healthy: true },
    { name: "B", region: "Europe", url: `http://127.0.0.1:3002`, latency: 0, active: 0, healthy: true },
    { name: "C", region: "Asia", url: `http://127.0.0.1:3003`, latency: 0, active: 0, healthy: true }
];

/**
 * Round-robin counter for tiebreaking equal-load nodes
 */
let rrIndex = 0;

/**
 * Utility: Calculate Score (Lower is better)
 * Score = latency (ms) + active_connections * 20
 * When all nodes are local, latency is ~equal, so this becomes pure least-connections.
 */
function calculateScore(node) {
    if (!node.healthy) return Infinity;
    return node.latency + (node.active * 20);
}

/**
 * Choose Best Node — Pure Dynamic Load Balancing
 * No sticky sessions. Every request picks the least-loaded healthy node.
 * Tiebreaker: round-robin to distribute evenly across equal-load nodes.
 */
function chooseNode(region) {
    // Priority order per region (preferred → fallbacks)
    const routingPriority = {
        "Asia": ["C", "B", "A"],
        "Europe": ["B", "A", "C"],
        "America": ["A", "B", "C"]
    };
    const priority = routingPriority[region] || routingPriority["America"];

    // All healthy, non-overloaded nodes
    const available = nodes.filter(n => n.healthy && n.active < 10);
    if (available.length === 0) return null;

    // Score each node
    const scored = available.map(n => ({
        node: n,
        score: calculateScore(n),
        regionRank: priority.indexOf(n.name) // lower = preferred region
    }));

    // Sort: primary = score (load), secondary = region preference
    scored.sort((a, b) => {
        const diff = a.score - b.score;
        if (Math.abs(diff) < 10) {
            // Scores within 10ms are considered equal — use region preference first
            const rankDiff = a.regionRank - b.regionRank;
            if (rankDiff !== 0) return rankDiff;
            // Same region rank → round-robin
            return 0;
        }
        return diff;
    });

    // Extract top-tier nodes (within 10ms of best score)
    const bestScore = scored[0].score;
    const topTier = scored.filter(s => s.score - bestScore < 10);

    // Round-robin within top tier for even distribution
    const selected = topTier[rrIndex % topTier.length].node;
    rrIndex++;

    return selected;
}

/**
 * Route Request — True Proxy (no browser redirect)
 */
app.get('/file/:name', async (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Expose-Headers", "X-Cache, X-Edge-Node");

    let region = req.query.region || 'America';
    if (!['America', 'Europe', 'Asia'].includes(region)) region = 'America';

    const node = chooseNode(region);

    if (!node) {
        console.error(`[503] All nodes overloaded or offline`);
        return res.status(503).send("All edge nodes are busy or offline.");
    }

    console.log(`[ROUTE] Region: ${region} -> Node ${node.name} | load=${node.active} latency=${node.latency}ms`);

    const query = req.url.includes('?') ? req.url.split('?')[1] : '';
    const redirectUrl = `${node.url}/file/${req.params.name}${query ? '?' + query : ''}&nodeName=${node.name}`;
    
    // Perform 302 HTTP Redirect to offload data transmission from Traffic Manager
    res.redirect(302, redirectUrl);
});


/**
 * Metrics Endpoint
 */
app.get('/metrics', (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");

    let totalHits = 0;
    let totalMisses = 0;
    let totalCacheSize = 0;

    const mappedNodes = nodes.map(n => {
        totalHits += (n.hits || 0);
        totalMisses += (n.misses || 0);
        totalCacheSize += (n.cache_size || 0);

        return {
            name: n.name,
            region: n.region,
            status: n.healthy ? "ONLINE" : "OFFLINE",
            active_connections: n.active,
            rtt_latency_ms: n.latency,
            hits: n.hits || 0,
            misses: n.misses || 0,
            cache_size: n.cache_size || 0
        };
    });

    res.json({
        nodes: mappedNodes,
        global_hits: totalHits,
        global_misses: totalMisses,
        global_cache_size: totalCacheSize
    });
});


/**
 * Background Health Check (Dynamic Latency + Timeout)
 */
async function checkHealth() {
    for (let node of nodes) {
        const startTime = Date.now();

        try {
            // AbortController ensures we don't hang if an edge node freezes
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 3000); // 3 sec timeout

            const res = await fetch(`${node.url}/health`, { signal: controller.signal });
            clearTimeout(timeout);

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();
            const rtt = Date.now() - startTime; // Calculate actual network latency

            node.active = data.active_connections;
            node.latency = rtt;
            node.hits = data.hits || 0;
            node.misses = data.misses || 0;
            node.cache_size = data.cache_size || 0;

            if (!node.healthy) {
                console.log(`[HEALTH] 🟢 Node ${node.name} recovered.`);
            }
            node.healthy = true;

        } catch (err) {
            if (node.healthy) {
                console.error(`[HEALTH] 🔴 Node ${node.name} went DOWN! (${err.message})`);
            }
            node.healthy = false;
            node.active = 0;
            node.latency = 9999;
        }
    }
}

// Run health checks every 5 seconds
setInterval(checkHealth, 5000);

/**
 * Socket Server & Start
 */
const server = http.createServer(app);
global.io = new SocketIOServer(server, { cors: { origin: '*' } });

global.io.on('connection', (socket) => {
    console.log(`[SOCKET] Connected: ${socket.id}`);
    // broadcast to others only — prevents duplicate log in the connecting client
    socket.broadcast.emit('cdn:log', { message: `New peer connected (${socket.id.slice(0, 6)})` });

    // Ensure frontend can emit manual tests if needed
    socket.on('cdn:request', (payload) => {
        if (!payload || !payload.coords) return;
        global.io.emit('cdn:request', payload);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Traffic Manager running on ${PORT}`);
    console.log(`View live metrics at ${PORT}/metrics`);
});