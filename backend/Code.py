# Code.py
import sys
import json
import requests
from collections import defaultdict

sys.stdout.reconfigure(encoding='utf-8')

# ---------------------------
# Utilities
# ---------------------------

def calculate_centroid(places):
    if not places:
        return None, None
    lat_sum = 0.0
    lon_sum = 0.0
    count = 0
    for p in places:
        lat = p.get("lat") or p.get("Lat")
        lon = p.get("lon") or p.get("Lon")
        if lat is not None and lon is not None:
            lat_sum += float(lat)
            lon_sum += float(lon)
            count += 1
    if count == 0:
        return None, None
    return lat_sum / count, lon_sum / count


def load_data(url, prefix):
    """โหลดรายการจาก backend แล้วเติม prefix เป็น id (เช่น P123 / R45 / A3)"""
    try:
        resp = requests.get(url, timeout=20)
        resp.raise_for_status()
        data = resp.json()
        for item in data:
            item['id'] = f"{prefix}{item['ID']}"
        return data
    except Exception as e:
        print(f"Failed to load {url}: {e}", file=sys.stderr)
        return []


def load_distances_for_ids(ids):
    """ขอกราฟระยะจาก backend /distances?ids=P1,P2,..."""
    ids_param = ",".join(ids)
    url = f"http://localhost:8080/distances?ids={ids_param}"
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
        return resp.json()  # { "P1": [{"to":"P2","distance":..}, ...], ... }
    except Exception as e:
        print(f"[ERROR] Load distances failed: {e}", file=sys.stderr)
        return {}


def build_graph(distance_data):
    """แปลงระยะเป็น adjacency list: {node: [(neighbor, dist), ...]}"""
    graph = defaultdict(list)
    for from_node, neighbors in distance_data.items():
        for neighbor in neighbors:
            to_id = neighbor['to']
            dist = float(neighbor['distance'])
            graph[from_node].append((to_id, dist))
    return graph


def edge_dist(graph, frm, to, default=float("inf")):
    """คืนระยะทางกราฟระหว่าง frm→to ถ้าไม่มี ให้ default"""
    for nid, d in graph.get(frm, []):
        if nid == to:
            return float(d)
    return default


# ---------------------------
# Boykov / MST helpers
# ---------------------------

def pick_zones_from_coords(landmarks, start_id, take_near=4, take_far=4):
    """
    เลือก zoneA/zoneB จากพิกัด:
    - zoneA = start + แลนด์มาร์กใกล้ start (take_near จุด)
    - zoneB = แลนด์มาร์กไกลสุด (take_far จุด)
    คืนค่า CSV ของ landmark_id (เป็นตัวเลขดิบ)
    """
    start = next((p for p in landmarks if p['id'] == start_id), None)
    if not start:
        # ถ้าไม่พบ start ในชุด ให้ส่ง start เดี่ยวๆ เป็น zoneA
        try:
            return str(int(start_id[1:])), ""
        except Exception:
            return "", ""

    sx = start.get('lat') or start.get('Lat')
    sy = start.get('lon') or start.get('Lon')

    def dist(p):
        x = p.get('lat') or p.get('Lat')
        y = p.get('lon') or p.get('Lon')
        if x is None or y is None or sx is None or sy is None:
            return float('inf')
        dx = float(sx) - float(x)
        dy = float(sy) - float(y)
        return (dx * dx + dy * dy) ** 0.5

    others = [p for p in landmarks if p['id'] != start_id and p['id'].startswith('P')]
    if not others:
        try:
            return str(int(start_id[1:])), ""
        except Exception:
            return "", ""

    others_sorted = sorted(others, key=dist)
    near = others_sorted[:max(0, int(take_near))]
    far = list(reversed(others_sorted))[:max(0, int(take_far))]

    zoneA = []
    try:
        zoneA.append(int(start_id[1:]))
    except Exception:
        pass
    zoneA += [int(p['id'][1:]) for p in near]

    zoneB = [int(p['id'][1:]) for p in far]

    return ",".join(map(str, zoneA)), ",".join(map(str, zoneB))


def fetch_mst_from_api_byflow(
    start_id,
    distance=4000,
    k=20,
    k_mst=20,
    mode="penalize",
    penalty=1.3,
    zoneA_csv="",
    zoneB_csv="",
    prefer="",
    prefer2="",
    prefer3="",
    w1=0.75,
    w2=0.85,
    w3=0.95,
    n_top=40,     # << NEW: ให้ backend แบ่งโซนด้วย top-N ตาม root ได้
):
    """
    เรียก /mst/byflow (Boykov + MST + type preferences)
    - ถ้า zoneA_csv/zoneB_csv ว่าง → backend จะ auto-zone ตาม root + n_top (หรือไม่ปรับโทษถ้าปล่อยว่างทั้งคู่ได้ตามฝั่งเซิร์ฟเวอร์)
    - ถ้า prefer* ว่าง → จะไม่ปรับน้ำหนักด้วย type
    """
    root_num = int(start_id[1:])
    params = {
        "root": root_num,
        "distance": distance,
        "k": k,             # K สำหรับฝั่ง flow (BK)
        "k_mst": k_mst,     # K สำหรับฝั่ง MST
        "mode": mode,       # penalize | exclude
        "penalty": penalty, # ตัวคูณราคาเมื่อเป็น cut
        "n_top": n_top,     # ให้ฝั่งเซิร์ฟเวอร์ใช้ top-N รอบ root
    }
    if zoneA_csv:
        params["zoneA"] = zoneA_csv
    if zoneB_csv:
        params["zoneB"] = zoneB_csv

    # preferences (รองรับไทย)
    if prefer:
        params["prefer"] = prefer
        params["w1"] = w1
    if prefer2:
        params["prefer2"] = prefer2
        params["w2"] = w2
    if prefer3:
        params["prefer3"] = prefer3
        params["w3"] = w3

    try:
        resp = requests.get("http://localhost:8080/mst/byflow", params=params, timeout=40)
        resp.raise_for_status()
        return resp.json()  # {"mst":[...], "applied_cut_edges":[[s,t],...], ...}
    except Exception as e:
        print(f"[ERROR] Failed to fetch /mst/byflow: {e}", file=sys.stderr)
        return {"mst": [], "applied_cut_edges": []}


def build_mst_adj_from_api(mst_rows):
    """
    สร้าง adjacency list ของ MST จากผล pgr_primDD
    - รองรับคีย์ทั้ง snake_case และ CamelCase
    - ถ้าไม่มี 'pred'/'Pred' ให้กู้ parent จากลำดับ DFS
    """
    adj = defaultdict(list)

    def get_key(row, *names, default=None):
        for n in names:
            if n in row:
                return row[n]
        return default

    rows = sorted(mst_rows, key=lambda r: get_key(r, 'seq', 'Seq', default=0))
    stack = []  # (depth, node)

    for row in rows:
        depth = get_key(row, 'depth', 'Depth', default=0)
        node_id = get_key(row, 'node', 'Node')
        edge_id = get_key(row, 'edge_id', 'edge', 'EdgeID', 'Edge', default=-1)
        pred_id = get_key(row, 'pred', 'Pred', default=None)

        if node_id is None:
            continue

        try:
            d = int(depth)
            n = int(node_id)
            e = int(edge_id)
        except Exception:
            continue

        # root
        if e == -1:
            stack = [(d, n)]
            continue

        # หา parent ถ้า pred ไม่มา
        if pred_id is None:
            while stack and stack[-1][0] >= d:
                stack.pop()
            if stack and stack[-1][0] == d - 1:
                pred_id = stack[-1][1]
            else:
                stack.append((d, n))
                continue
        else:
            try:
                pred_id = int(pred_id)
            except Exception:
                stack.append((d, n))
                continue

        u = f"P{pred_id}"
        v = f"P{n}"
        if v not in adj[u]:
            adj[u].append(v)
        if u not in adj[v]:
            adj[v].append(u)

        stack.append((d, n))

    return adj


def ensure_seed_points(start_id, mst_adj, graph, need_p=4):
    """
    ถ้า MST ไม่มีเพื่อนบ้านเลย ให้เติม P ที่ใกล้สุดจากกราฟระยะ (/distances)
    """
    if mst_adj.get(start_id):
        return
    knn = sorted(graph.get(start_id, []), key=lambda x: x[1])
    added = 0
    for nid, _d in knn:
        if nid.startswith("P"):
            if nid not in mst_adj[start_id]:
                mst_adj[start_id].append(nid)
            if start_id not in mst_adj[nid]:
                mst_adj[nid].append(start_id)
            added += 1
            if added >= need_p:
                break


def backfill_knn_edges(mst_adj, graph, min_degree=2, per_node=3, max_new_edges=500):
    """
    เติมเส้น P–P เพิ่มจากกราฟระยะ เพื่อให้ traversal ไปต่อได้:
    - ถ้าโหนด P ไหนมีเพื่อน < min_degree → เติมได้สูงสุด per_node จาก KNN
    - จำกัดจำนวนเส้นใหม่ทั้งหมดไม่เกิน max_new_edges
    """
    new_edges = 0

    def has_edge(u, v):
        return v in mst_adj.get(u, [])

    p_nodes = [n for n in mst_adj.keys() if n.startswith("P")]
    p_nodes = list(set(p_nodes) | {n for n in graph.keys() if n.startswith("P")})

    for u in p_nodes:
        deg = len(mst_adj.get(u, []))
        if deg >= min_degree:
            continue

        neighbors = sorted(graph.get(u, []), key=lambda x: x[1])
        added_here = 0
        for v, _d in neighbors:
            if not v.startswith("P"):
                continue
            if u == v or has_edge(u, v):
                continue
            mst_adj[u].append(v)
            mst_adj[v].append(u)
            added_here += 1
            new_edges += 1
            if added_here >= per_node or new_edges >= max_new_edges:
                break

        if new_edges >= max_new_edges:
            break


# ---------------------------
# Budget helpers
# ---------------------------

def _get_num(v, *keys, default=0):
    for k in keys:
        if isinstance(v, dict) and k in v and v[k] is not None:
            try:
                return int(v[k])
            except Exception:
                try:
                    return float(v[k])
                except Exception:
                    pass
    return default

def price_min(item):
    return int(_get_num(item, "price_min", "PriceMin", default=0))

def price_max(item):
    return int(_get_num(item, "price_max", "PriceMax", default=0))

def split_daily_budget(total_budget, days):
    if days <= 0: days = 1
    per_day = total_budget // days
    hotel = int(per_day * 0.55)      # ~55%
    meal_each = int(per_day * 0.12)  # 2 มื้อ
    attractions = per_day - hotel - (2 * meal_each)
    if attractions < 0: attractions = 0
    return {"per_day": per_day, "hotel": hotel, "meal_each": meal_each, "attractions": attractions}

def relax(amount, pct=10):
    return int(round(amount * (1.0 + pct/100.0)))


# ---------------------------
# Budget-aware selectors
# ---------------------------

def find_nearest_accommodation_under_budget(accommodations, centroid_lat, centroid_lon, hotel_budget):
    if centroid_lat is None or centroid_lon is None or not accommodations:
        return None

    def distance(lat1, lon1, lat2, lon2):
        dx = float(lat1) - float(lat2)
        dy = float(lon1) - float(lon2)
        return (dx * dx + dy * dy) ** 0.5

    pool = [a for a in accommodations if price_min(a) <= hotel_budget]
    step = 0
    while not pool and step < 5:  # ผ่อนงบทีละ 10% สูงสุด 50%
        step += 1
        hotel_budget = relax(hotel_budget, 10)
        pool = [a for a in accommodations if price_min(a) <= hotel_budget]

    if not pool:
        return None

    nearest, min_dist = None, float('inf')
    for acc in pool:
        lat = acc.get("lat") or acc.get("Lat")
        lon = acc.get("lon") or acc.get("Lon")
        if lat is None or lon is None:
            continue
        dist = distance(centroid_lat, centroid_lon, lat, lon)
        if dist < min_dist:
            min_dist, nearest = dist, acc
    return nearest


def pick_nearest_restaurant_under_budget(current_p, remaining_r_ids, restaurants, graph, meal_budget):
    def _edge(frm, to):
        return edge_dist(graph, frm, to, default=float('inf'))

    rmap = {r['id']: r for r in restaurants}
    affordable = [rid for rid in remaining_r_ids if price_min(rmap.get(rid, {})) <= meal_budget]
    candidates = affordable if affordable else list(remaining_r_ids)

    if not candidates:
        return None
    return min(candidates, key=lambda rid: _edge(current_p, rid))


# ---------------------------
# Spend helpers
# ---------------------------

def compute_spend_for_day(day_nodes, place_lookup, hotel_price_per_day):
    """คำนวณค่าใช้จ่ายจริงของวันจาก nodes ที่เลือกแล้ว"""
    meals_sum = 0
    attractions_sum = 0
    for nid in day_nodes:
        p = place_lookup.get(nid)
        if not p:
            continue
        if nid.startswith("R"):
            meals_sum += max(0, price_min(p))
        elif nid.startswith("P"):
            attractions_sum += max(0, price_min(p))
    hotel = max(0, int(hotel_price_per_day))
    total = hotel + meals_sum + attractions_sum
    return {"hotel": hotel, "meals": meals_sum, "attractions": attractions_sum, "total": total}


# ---------------------------
# Trip planning (budget-aware)
# ---------------------------

def plan_trip(start_id, landmarks, restaurants, graph, accommodations,
              days=1, distance=4000, k=20, k_mst=20, use_boykov=True,
              mode="penalize", penalty=1.3, total_budget=0,
              prefer="", prefer2="", prefer3="",
              w1=0.75, w2=0.85, w3=0.95,
              n_top=40):
    """
    เพิ่มคุมงบต่อวัน + คำนวณค่าใช้จ่ายจริง:
    - ที่พัก: เลือกที่ราคาไม่เกิน budget ต่อวัน
    - ร้าน: เลือก 2 ร้าน/วัน ราคาไม่เกิน budget ต่อมื้อ (fallback เป็นใกล้สุด)
    - แลนด์มาร์ก: ฟรีก่อน แล้วค่อยเสียเงิน แต่จำกัดรวมไม่เกิน budget attractions/วัน
    - ส่ง prefer/prefer2/prefer3 + w1/w2/w3 ไปยัง /mst/byflow เพื่อ bias เส้นทาง
    """
    all_places = landmarks + restaurants + accommodations
    place_lookup = {p['id']: p for p in all_places}
    _lookup = place_lookup  # ชื่อสั้นใช้ใน inner functions

    # แบ่งงบต่อวัน
    budget = split_daily_budget(total_budget, days)

    # 1) โซน
    zoneA_csv, zoneB_csv = ("", "")
    if use_boykov:
        zoneA_csv, zoneB_csv = pick_zones_from_coords(landmarks, start_id, take_near=4, take_far=4)

    # 2) /mst/byflow → MST (พร้อม preferences)
    byflow = fetch_mst_from_api_byflow(
        start_id=start_id,
        distance=distance,
        k=k,
        k_mst=k_mst,
        mode=mode,
        penalty=penalty,
        zoneA_csv=zoneA_csv,
        zoneB_csv=zoneB_csv,
        prefer=prefer,
        prefer2=prefer2,
        prefer3=prefer3,
        w1=w1,
        w2=w2,
        w3=w3,
        n_top=n_top,
    )
    mst_rows = byflow.get("mst", [])
    mst_adj = build_mst_adj_from_api(mst_rows)

    ensure_seed_points(start_id, mst_adj, graph, need_p=4)
    backfill_knn_edges(mst_adj, graph, min_degree=2, per_node=3, max_new_edges=800)

    # 3) เตรียม R
    r_list = [r['id'] for r in restaurants]
    remaining_r = set(r_list)

    trip_plan_days = []
    current_day_plan = []
    p_count = 0
    day_count = 0
    visited = set()

    attractions_spent = 0  # งบค่าเข้า P ต่อวัน

    def insert_restaurant_under_budget(current_p):
        nonlocal remaining_r
        if not remaining_r:
            return None
        rid = pick_nearest_restaurant_under_budget(
            current_p=current_p,
            remaining_r_ids=remaining_r,
            restaurants=restaurants,
            graph=graph,
            meal_budget=budget["meal_each"]
        )
        if rid:
            remaining_r.remove(rid)
        return rid

    def flush_day():
        nonlocal current_day_plan, p_count, day_count, attractions_spent
        if current_day_plan:
            trip_plan_days.append(current_day_plan)
            current_day_plan = []
            p_count = 0
            day_count += 1
            attractions_spent = 0

    def can_take_landmark(node_id):
        nonlocal attractions_spent
        if not node_id.startswith("P"):
            return True
        p = _lookup.get(node_id)
        if not p:
            return True
        fee = price_min(p)
        if fee <= 0:
            return True
        return (attractions_spent + fee) <= budget["attractions"]

    def after_take_landmark(node_id):
        nonlocal attractions_spent
        if node_id.startswith("P"):
            p = _lookup.get(node_id)
            if p:
                fee = price_min(p)
                if fee > 0:
                    attractions_spent += fee

    def dfs(node):
        nonlocal p_count, current_day_plan, day_count
        if day_count >= days:
            return
        visited.add(node)

        if node.startswith("P") and not can_take_landmark(node):
            for nxt in mst_adj.get(node, []):
                if nxt not in visited and day_count < days:
                    dfs(nxt)
            return

        current_day_plan.append(node)
        if node.startswith("P"):
            p_count += 1
            after_take_landmark(node)

        # ใส่ร้านเมื่อครบจังหวะ (2 และ 4 สถานที่)
        if p_count in (2, 4):
            r = insert_restaurant_under_budget(node)
            if r:
                current_day_plan.append(r)

        # จำกัดกิจกรรม/วันให้พอเหมาะ
        if len(current_day_plan) >= 6:
            flush_day()
            if day_count >= days:
                return

        # ไปต่อ DFS
        for nxt in mst_adj.get(node, []):
            if nxt not in visited and day_count < days:
                dfs(nxt)

    # เริ่มจาก start
    dfs(start_id)

    # ถ้ายังไม่ครบวัน ลองเริ่มจาก P อื่น ๆ (degree มากก่อน)
    if day_count < days:
        all_ps = sorted(
            [n for n in mst_adj.keys() if n.startswith("P") and n not in visited],
            key=lambda x: len(mst_adj.get(x, [])),
            reverse=True
        )
        for p in all_ps:
            if day_count >= days:
                break
            if p not in visited:
                dfs(p)

    if current_day_plan and day_count < days:
        flush_day()

    while day_count < days:
        trip_plan_days.append([])
        day_count += 1

    # 4) สรุปรายวัน + ที่พัก
    detailed_plan_by_day = []
    all_places_for_accommodation = []

    for day_idx, day_plan in enumerate(trip_plan_days, start=1):
        day_detail = []
        for node in day_plan:
            p = _lookup.get(node)
            if not p:
                continue
            lat = p.get("lat") or p.get("Lat")
            lon = p.get("lon") or p.get("Lon")
            name = p.get("Name") or p.get("name") or node
            day_detail.append({
                "id": node,
                "name": name,
                "lat": float(lat) if lat is not None else None,
                "lon": float(lon) if lon is not None else None,
            })
            if lat is not None and lon is not None:
                all_places_for_accommodation.append({"lat": float(lat), "lon": float(lon)})
        detailed_plan_by_day.append({
            "day": day_idx,
            "plan": day_detail,
            "budget": {
                "per_day": int(budget["per_day"]),
                "hotel": int(budget["hotel"]),
                "meal_each": int(budget["meal_each"]),
                "attractions": int(budget["attractions"]),
            }
        })

    # --- หาโรงแรมตามงบ + ทำให้เป็นอ็อบเจกต์แบบ clean ---
    centroid_lat, centroid_lon = calculate_centroid(all_places_for_accommodation)
    nearest_acc_raw = None
    if centroid_lat is not None:
        nearest_acc_raw = find_nearest_accommodation_under_budget(
            accommodations, centroid_lat, centroid_lon, hotel_budget=budget["hotel"]
        )

    accom_out = None
    if nearest_acc_raw:
        acc_id_str = str(nearest_acc_raw.get("id") or f"A{nearest_acc_raw.get('ID')}")
        name = nearest_acc_raw.get("Name") or nearest_acc_raw.get("name") or acc_id_str
        lat = nearest_acc_raw.get("lat") or nearest_acc_raw.get("Lat")
        lon = nearest_acc_raw.get("lon") or nearest_acc_raw.get("Lon")
        accom_out = {
            "id": acc_id_str,
            "name": name,
            "lat": float(lat) if lat is not None else None,
            "lon": float(lon) if lon is not None else None,
        }

    # 5) เส้นทางรวม (A → … → A)
    detailed_routes = []
    total_distance = 0.0
    if accom_out:
        acc_id = accom_out["id"]
        full_trip_plan = []
        for day_plan in trip_plan_days:
            if not day_plan:
                # ว่างทั้งวัน → ข้าม แต่ยังคงที่พักไว้วันถัดไป
                continue
            full_trip_plan.append(acc_id)
            full_trip_plan.extend(day_plan)
            full_trip_plan.append(acc_id)

        for i in range(len(full_trip_plan) - 1):
            frm = full_trip_plan[i]
            to = full_trip_plan[i + 1]
            dist = edge_dist(graph, frm, to, default=0.0)
            total_distance += dist
            frm_p = _lookup.get(frm, {})
            to_p = _lookup.get(to, {})
            detailed_routes.append({
                "from": frm,
                "from_name": frm_p.get("Name") or frm_p.get("name") or frm,
                "from_lat": frm_p.get("lat") or frm_p.get("Lat"),
                "from_lon": frm_p.get("lon") or frm_p.get("Lon"),
                "to": to,
                "to_name": to_p.get("Name") or to_p.get("name") or to,
                "to_lat": to_p.get("lat") or to_p.get("Lat"),
                "to_lon": to_p.get("lon") or to_p.get("Lon"),
                "distance_km": round(float(dist), 2),
            })

    # ---- Spend summary (จริงตามที่เลือก) ----
    hotel_price_per_day = price_min(nearest_acc_raw) if nearest_acc_raw else 0
    spend_per_day = []
    spend_total = {"hotel": 0, "meals": 0, "attractions": 0, "total": 0}
    for idx, day_nodes in enumerate(trip_plan_days, start=1):
        s = compute_spend_for_day(day_nodes, _lookup, hotel_price_per_day)
        spend_per_day.append({"day": idx, **s})
        spend_total["hotel"] += s["hotel"]
        spend_total["meals"] += s["meals"]
        spend_total["attractions"] += s["attractions"]
        spend_total["total"] += s["total"]

    start_name = _lookup.get(start_id, {}).get("Name") or _lookup.get(start_id, {}).get("name") or start_id

    return {
        "start": start_id,
        "start_name": start_name,
        "trip_plan_by_day": detailed_plan_by_day,
        "paths": detailed_routes,
        "total_distance_km": round(total_distance, 2),
        "accommodation": accom_out,   # ส่งแบบ clean: {id:str, name, lat, lon}
        "message": "สร้างเส้นทางสำเร็จ",
        # fields ด้านล่างเป็นข้อมูลเพิ่มเติม (Go จะเพิกเฉยได้ถ้า struct ไม่มี)
        "applied_cut_edges": byflow.get("applied_cut_edges", []),
        "mst_raw_rows": byflow.get("mst", []),
        "total_budget": int(total_budget),
        "budget_per_day": int(budget["per_day"]),
        "spend": {
            "per_day": spend_per_day,          # [{day, hotel, meals, attractions, total}, ...]
            "total": spend_total["total"],     # ยอดรวมทั้งทริป
            "breakdown": {                     # แยกย่อยทั้งทริป
                "hotel": spend_total["hotel"],
                "meals": spend_total["meals"],
                "attractions": spend_total["attractions"],
            }
        }
    }


# ---------------------------
# Main
# ---------------------------

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "กรุณาระบุ start_id เช่น P151"}))
        return

    start_id = sys.argv[1]                    # e.g. "P163"
    days = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    distance = int(sys.argv[3]) if len(sys.argv) > 3 else 4000
    k = int(sys.argv[4]) if len(sys.argv) > 4 else 20
    k_mst = int(sys.argv[5]) if len(sys.argv) > 5 else 20
    mode = sys.argv[6] if len(sys.argv) > 6 else "penalize"
    try:
        penalty = float(sys.argv[7]) if len(sys.argv) > 7 else 1.3
    except Exception:
        penalty = 1.3
    use_boykov = True
    if len(sys.argv) > 8:
        try:
            use_boykov = bool(int(sys.argv[8]))
        except Exception:
            use_boykov = True

    total_budget = 0
    if len(sys.argv) > 9:
        try:
            total_budget = int(sys.argv[9])
            if total_budget < 0: total_budget = 0
        except Exception:
            total_budget = 0

    # --- preferences + weights (ออปชัน) ---
    prefer  = sys.argv[10] if len(sys.argv) > 10 else ""     # ตัวอย่าง: "สายบุญ,วัฒนธรรม"
    prefer2 = sys.argv[11] if len(sys.argv) > 11 else ""
    prefer3 = sys.argv[12] if len(sys.argv) > 12 else ""
    try:
        w1 = float(sys.argv[13]) if len(sys.argv) > 13 else 0.75
    except Exception:
        w1 = 0.75
    try:
        w2 = float(sys.argv[14]) if len(sys.argv) > 14 else 0.85
    except Exception:
        w2 = 0.85
    try:
        w3 = float(sys.argv[15]) if len(sys.argv) > 15 else 0.95
    except Exception:
        w3 = 0.95

    # สามารถเพิ่ม argv[16] เป็น n_top ได้ ถ้าต้องการกำหนดจากภายนอก
    try:
        n_top = int(sys.argv[16]) if len(sys.argv) > 16 else 40
    except Exception:
        n_top = 40

    # โหลดข้อมูลพื้นฐาน
    landmarks = load_data("http://localhost:8080/landmarks", "P")
    restaurants = load_data("http://localhost:8080/restaurants", "R")
    accommodations = load_data("http://localhost:8080/accommodations", "A")

    # รวม id ทั้งหมดไปขอกราฟระยะ
    all_ids = set([start_id])
    for p in landmarks: all_ids.add(p['id'])
    for r in restaurants: all_ids.add(r['id'])
    for a in accommodations: all_ids.add(a['id'])

    distance_data = load_distances_for_ids(list(all_ids))
    graph = build_graph(distance_data)

    result = plan_trip(
        start_id,
        landmarks,
        restaurants,
        graph,
        accommodations,
        days=days,
        distance=distance,
        k=k,
        k_mst=k_mst,
        use_boykov=use_boykov,
        mode=mode,
        penalty=penalty,
        total_budget=total_budget,
        prefer=prefer,
        prefer2=prefer2,
        prefer3=prefer3,
        w1=w1,
        w2=w2,
        w3=w3,
        n_top=n_top,
    )
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
