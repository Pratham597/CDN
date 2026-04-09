import sys
import requests
import threading
import time
from flask import Flask, jsonify, Response
from cache_module import Cache
from dotenv import load_dotenv
import os

load_dotenv()

app = Flask(__name__)
print(os.getenv("ORIGIN_URL"))

# --- CONFIGURATION ---
ORIGIN_URL = os.getenv("ORIGIN_URL")+":5000" 

# --- LOAD MANAGEMENT STATE ---
active_connections = 0
conn_lock = threading.Lock()
# --- METRICS ---
cache_hits = 0
cache_misses = 0
metrics_lock = threading.Lock()


cache = Cache(max_size=5,ttl=60)

# --- APIs ---

@app.route('/health', methods=['GET'])
def health():
    # Traffic Manager (code1) expects JSON with 'active_connections'
    with conn_lock:
        current_active = active_connections
    with metrics_lock:
        current_hits = cache_hits
        current_misses = cache_misses
        current_cache_size = len(cache.store)
    return jsonify({
        "active_connections": current_active, 
        "status": "healthy",
        "hits": current_hits,
        "misses": current_misses,
        "cache_size": current_cache_size
    }), 200

@app.route('/cache/<filename>', methods=['DELETE'])
def purge_cache(filename):
    cache.delete(filename)
    return jsonify({"status": "purged", "file": filename}), 200

@app.route('/metrics', methods=['GET'])
def metrics():
    with metrics_lock:
        total = cache_hits + cache_misses
        hit_ratio = cache_hits / total if total > 0 else 0

        return jsonify({
            "hits": cache_hits,
            "misses": cache_misses,
            "hit_ratio": hit_ratio,
            "cache_size": len(cache.store)
        })

@app.route('/file/<filename>', methods=['GET'])
def get_file(filename):
    from flask import request as flask_request
    node_name = flask_request.args.get('nodeName', '')
    global active_connections
    print(f"Received request for {filename}")
    # 1. Load Shedding Check
    with conn_lock:
        if active_connections >= 10:
            print(f"[BUSY] Rejecting {filename}")
            return "BUSY", 503
        active_connections += 1
        print(f"[IN] {filename} | Active: {active_connections}")

    try:
        # 2. Check Cache
        cached_content = cache.get(filename)

        if cached_content is not None:
            # CASE 1: CACHE HIT
            print(f"[CACHE HIT] {filename}")

            global cache_hits
            with metrics_lock:
                cache_hits += 1

<<<<<<< HEAD
=======
            time.sleep(0.1)
>>>>>>> 7b0beff43efd74fc67f56cba4cde9a4dec7ce574
            response = Response(cached_content)
            response.headers['X-Cache'] = 'HIT'
            response.headers['Access-Control-Allow-Origin'] = '*'
            if node_name:
                response.headers['X-Edge-Node'] = node_name
                response.headers['Access-Control-Expose-Headers'] = 'X-Cache, X-Edge-Node'
            else:
                response.headers['Access-Control-Expose-Headers'] = 'X-Cache'
            return response

        # 3. CASE 2: CACHE MISS
        print(f"[CACHE MISS] {filename}")
        global cache_misses
        with metrics_lock:
            cache_misses += 1
        try:
            # Origin (code2) takes 2 seconds to respond, timeout set to 10s to be safe
            origin_resp = requests.get(f"{ORIGIN_URL}/content/{filename}", timeout=20)
            if origin_resp.status_code != 200:
                return "Origin file not found", origin_resp.status_code
            content = origin_resp.content
        except requests.exceptions.RequestException:
            return "Origin unreachable", 502

        # Delay is removed here because code2 handles the 2-second sleep natively
        cache.set(filename, content)

        response = Response(content)
        response.headers['X-Cache'] = 'MISS'
        response.headers['Access-Control-Allow-Origin'] = '*'
        if node_name:
            response.headers['X-Edge-Node'] = node_name
            response.headers['Access-Control-Expose-Headers'] = 'X-Cache, X-Edge-Node'
        else:
            response.headers['Access-Control-Expose-Headers'] = 'X-Cache'
        return response

    finally:
        # 4. Release Connection Count
        with conn_lock:
            active_connections -= 1
            print(f"[OUT] {filename} | Active: {active_connections}")

if __name__ == '__main__':
    # Ports required by Traffic Manager: 3001, 3002, 3003
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3001
    app.run(host='0.0.0.0', port=port, threaded=True)