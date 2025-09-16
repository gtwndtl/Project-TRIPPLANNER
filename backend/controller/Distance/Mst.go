// backend/controller/Distance/Mst.go
package Distance

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// ------------------------------------------------------------
// config
// ------------------------------------------------------------

// ใช้ BK ของ pgRouting โดยไม่ใส่ schema prefix (ต้องอยู่ใน search_path)
const flowFn = "pgr_boykovkolmogorov"

// ------------------------------------------------------------
// types
// ------------------------------------------------------------

type MinCutResp struct {
	CutEdgeIDs [][2]int `json:"cut_edge_ids"` // (source,target) ที่เป็นคอขวด
}

type MSTRow struct {
	Seq      int     `json:"seq"        gorm:"column:seq"`
	Depth    int     `json:"depth"      gorm:"column:depth"`
	StartVID int     `json:"start_vid"  gorm:"column:start_vid"`
	Node     int     `json:"node"       gorm:"column:node"`
	EdgeID   int     `json:"edge_id"    gorm:"column:edge"`
	Cost     float64 `json:"cost"       gorm:"column:cost"`
	AggCost  float64 `json:"agg_cost"   gorm:"column:agg_cost"`
	Pred     *int    `json:"pred,omitempty" gorm:"column:pred"`
}

type ByFlowResp struct {
	MST             []MSTRow `json:"mst"`
	AppliedCutEdges [][2]int `json:"applied_cut_edges"` // (source,target) จาก min-cut
	Mode            string   `json:"mode"`              // penalize | exclude
	PenaltyFactor   float64  `json:"penalty"`           // ถ้า penalize
}

// ------------------------------------------------------------
// helpers
// ------------------------------------------------------------

func sqlLit(s string) string {
	// escape single quote สำหรับฝังเป็น string literal ใน SQL
	return strings.ReplaceAll(s, "'", "''")
}

// ทำ VALUES ของคู่ (s,t) สำหรับ join ตัด/ปรับโทษ ถ้าไม่มีให้คืน VALUES (NULL,NULL) เพื่อไม่แมตช์
func valsPairs(pairs []struct{ S, T int }) string {
	if len(pairs) == 0 {
		return "VALUES (NULL::int, NULL::int)"
	}
	var b strings.Builder
	b.WriteString("VALUES\n")
	for i, e := range pairs {
		if i > 0 {
			b.WriteString(",\n")
		}
		b.WriteString(fmt.Sprintf("  (%d,%d)", e.S, e.T))
	}
	return b.String()
}

// ------------------------------------------------------------
// Auto-zone (Top-N ใกล้ root) — ไม่เช็ค component
// ------------------------------------------------------------
//
// zoneA = N จุดที่ใกล้ root มากที่สุด (รวม root เองด้วยถ้ามี)
// zoneB = โหนดที่เหลือทั้งหมด
// บังคับให้ zoneB ไม่ว่าง (ถ้าจำนวนโหนด > 1) ด้วย n_eff = LEAST(nTop, cnt-1)
func (ctrl *DistanceController) findZonesTopN(root, nTop int) (string, string, error) {
	if nTop < 1 {
		nTop = 1
	}

	sql := `
WITH nodes AS (
  SELECT landmark_id::int AS id, location AS geom
  FROM public.landmark_gis
),
sizes AS (
  SELECT COUNT(*)::int AS cnt FROM nodes
),
n_eff AS (
  SELECT CASE WHEN cnt <= 1 THEN cnt ELSE LEAST($2::int, cnt-1) END AS n
  FROM sizes
),
root_pt AS (
  SELECT location AS geom FROM public.landmark_gis WHERE landmark_id = $1
),
ordered AS (
  SELECT n.id, ST_DistanceSphere(n.geom, r.geom) AS d
  FROM nodes n, root_pt r
  ORDER BY d
),
za AS (
  SELECT COALESCE(STRING_AGG(id::text, ','), '') AS csv
  FROM (SELECT id FROM ordered LIMIT (SELECT n FROM n_eff)) s
),
zb AS (
  SELECT COALESCE(STRING_AGG(id::text, ','), '') AS csv
  FROM (SELECT id FROM ordered OFFSET (SELECT n FROM n_eff)) s
)
SELECT (SELECT csv FROM za) AS za, (SELECT csv FROM zb) AS zb;
`
	type zones struct {
		Za *string `gorm:"column:za"`
		Zb *string `gorm:"column:zb"`
	}
	var z zones
	if err := ctrl.PostgisDB.Raw(sql, root, nTop).Scan(&z).Error; err != nil {
		return "", "", err
	}
	za, zb := "", ""
	if z.Za != nil {
		za = *z.Za
	}
	if z.Zb != nil {
		zb = *z.Zb
	}
	return za, zb, nil
}

// ------------------------------------------------------------
// /flow/mincut
// ------------------------------------------------------------
//
// GET /flow/mincut?root=29&k=20&n_top=40
// หรือส่ง zoneA/zoneB เองก็ได้
//
func (ctrl *DistanceController) GetFlowMinCut(c *gin.Context) {
	zoneA := strings.TrimSpace(c.Query("zoneA"))
	zoneB := strings.TrimSpace(c.Query("zoneB"))

	k, _ := strconv.Atoi(c.DefaultQuery("k", "20"))
	if k < 1 {
		k = 20
	}
	nTop, _ := strconv.Atoi(c.DefaultQuery("n_top", "40"))
	if nTop < 1 {
		nTop = 1
	}

	// auto-zone (Top-N) ถ้าไม่ส่ง zoneA/zoneB
	if zoneA == "" || zoneB == "" {
		rootStr := c.Query("root")
		root, err := strconv.Atoi(rootStr)
		if err != nil || root <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "ต้องระบุ root เป็นจำนวนเต็มบวก เมื่อไม่ส่ง zoneA/zoneB"})
			return
		}
		a, b, err := ctrl.findZonesTopN(root, nTop)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "หา zoneA/zoneB อัตโนมัติ (Top-N) ไม่สำเร็จ", "detail": err.Error()})
			return
		}
		zoneA, zoneB = a, b
	}

	sqlCut := fmt.Sprintf(`
WITH RECURSIVE
bk AS (
  SELECT * FROM %s(
    $$
WITH lm AS (
  SELECT landmark_id::int AS id, location AS geom FROM public.landmark_gis
),
edges_base AS (
  SELECT ROW_NUMBER() OVER ()::int AS id,
         a.id::int AS source, b.id::int AS target,
         ST_DistanceSphere(a.geom,b.geom) AS dist
  FROM lm a
  JOIN LATERAL (
    SELECT id, geom
    FROM lm b
    WHERE b.id<>a.id
    ORDER BY b.geom <-> a.geom
    LIMIT %d
  ) b ON TRUE
),
edges_cap AS (
  SELECT
    id, source, target,
    CEIL(GREATEST(1.0, 10000.0/NULLIF(dist,0)))::int AS capacity,
    CEIL(GREATEST(1.0, 10000.0/NULLIF(dist,0)))::int AS reverse_capacity
  FROM edges_base
)
SELECT id, source, target, capacity, reverse_capacity
FROM edges_cap
ORDER BY id
$$::text,
    STRING_TO_ARRAY($1, ',')::int[],
    STRING_TO_ARRAY($2, ',')::int[]
  )
),
residual_fwd AS (
  SELECT e.source, e.target
  FROM bk
  JOIN (
WITH lm AS (
  SELECT landmark_id::int AS id, location AS geom FROM public.landmark_gis
),
edges_base AS (
  SELECT ROW_NUMBER() OVER ()::int AS id,
         a.id::int AS source, b.id::int AS target,
         ST_DistanceSphere(a.geom,b.geom) AS dist
  FROM lm a
  JOIN LATERAL (
    SELECT id, geom
    FROM lm b
    WHERE b.id<>a.id
    ORDER BY b.geom <-> a.geom
    LIMIT %d
  ) b ON TRUE
)
SELECT id, source, target FROM edges_base
  ) e ON e.id = bk.edge
  WHERE bk.residual_capacity > 0
),
reach(node) AS (
  SELECT unnest(STRING_TO_ARRAY($1, ',')::int[])::int
  UNION ALL
  SELECT r.target
  FROM reach r0
  JOIN residual_fwd r ON r0.node = r.source
),
cut_edges AS (
  SELECT e.source, e.target
  FROM (
WITH lm AS (
  SELECT landmark_id::int AS id, location AS geom FROM public.landmark_gis
),
edges_base AS (
  SELECT ROW_NUMBER() OVER ()::int AS id,
         a.id::int AS source, b.id::int AS target,
         ST_DistanceSphere(a.geom,b.geom) AS dist
  FROM lm a
  JOIN LATERAL (
    SELECT id, geom
    FROM lm b
    WHERE b.id<>a.id
    ORDER BY b.geom <-> a.geom
    LIMIT %d
  ) b ON TRUE
)
SELECT source, target FROM edges_base
  ) e
  WHERE e.source IN (SELECT node FROM reach)
    AND e.target NOT IN (SELECT node FROM reach)
)
SELECT source, target
FROM cut_edges
ORDER BY source, target;
`, flowFn, k, k, k)

	type pair struct {
		S int `gorm:"column:source"`
		T int `gorm:"column:target"`
	}
	var rows []pair
	if err := ctrl.PostgisDB.Raw(sqlCut, zoneA, zoneB).Scan(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "คำนวณ min-cut ล้มเหลว", "detail": err.Error()})
		return
	}
	out := make([][2]int, 0, len(rows))
	for _, r := range rows {
		out = append(out, [2]int{r.S, r.T})
	}
	c.JSON(http.StatusOK, MinCutResp{CutEdgeIDs: out})
}

// ------------------------------------------------------------
// /mst/byflow + type preference (3 ชั้น)
// ------------------------------------------------------------
//
// GET /mst/byflow?root=29&k=20&k_mst=20&n_top=40&mode=penalize&penalty=1.3
//    &prefer=สายบุญ,วัฒนธรรม&w1=0.6
//    &prefer2=ชิวๆ,เดินเล่น&w2=0.8
//    &prefer3=จุดชมวิว&w3=0.9
//
// - ไม่มีเพดานระยะทั้งฝั่ง flow และฝั่ง MST (KNN only)
// - หา min-cut ด้วย BK แล้ว penalize/exclude ในกราฟ MST
// - พาร์ต preference ลด cost ด้วยค่าน้ำหนัก w1/w2/w3 (< 1.0 → สั้นลง → ถูกเลือกก่อน)
//   (ใช้เฉพาะ LANDMARK; Restaurant/Accommodation ไม่แตะใน MST นี้)
func (ctrl *DistanceController) GetMSTByFlow(c *gin.Context) {
	root, _ := strconv.Atoi(c.DefaultQuery("root", "0"))
	if root <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ต้องระบุ root เป็น landmark_id จำนวนเต็มบวก"})
		return
	}

	zoneA := strings.TrimSpace(c.Query("zoneA"))
	zoneB := strings.TrimSpace(c.Query("zoneB"))
	k, _ := strconv.Atoi(c.DefaultQuery("k", "20"))
	kMst, _ := strconv.Atoi(c.DefaultQuery("k_mst", "20"))
	mode := strings.ToLower(strings.TrimSpace(c.DefaultQuery("mode", "penalize")))
	if mode != "penalize" && mode != "exclude" {
		mode = "penalize"
	}
	penalty, _ := strconv.ParseFloat(c.DefaultQuery("penalty", "1.3"), 64)
	if penalty <= 0 {
		penalty = 1.3
	}

	// prefs (ไทยได้) + น้ำหนัก
	pref1 := c.DefaultQuery("prefer", "")
	pref2 := c.DefaultQuery("prefer2", "")
	pref3 := c.DefaultQuery("prefer3", "")
	w1, _ := strconv.ParseFloat(c.DefaultQuery("w1", "0.75"), 64)
	w2, _ := strconv.ParseFloat(c.DefaultQuery("w2", "0.85"), 64)
	w3, _ := strconv.ParseFloat(c.DefaultQuery("w3", "0.95"), 64)
	clamp := func(x float64) float64 { if x <= 0 { return 0.5 }; if x > 1 { return 1 }; return x }
	w1, w2, w3 = clamp(w1), clamp(w2), clamp(w3)

	// auto-zone (Top-N) ถ้าไม่ส่ง
	if zoneA == "" || zoneB == "" {
		nTop, _ := strconv.Atoi(c.DefaultQuery("n_top", "40"))
		if nTop < 1 {
			nTop = 1
		}
		autoA, autoB, err := ctrl.findZonesTopN(root, nTop)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถหาโซนอัตโนมัติ (Top-N)", "detail": err.Error()})
			return
		}
		zoneA, zoneB = autoA, autoB
	}

	// 1) หา min-cut ด้วย BK
	sqlCut := fmt.Sprintf(`
WITH RECURSIVE
bk AS (
  SELECT * FROM %s(
    $$
WITH lm AS (
  SELECT landmark_id::int AS id, location AS geom FROM public.landmark_gis
),
edges_base AS (
  SELECT ROW_NUMBER() OVER ()::int AS id,
         a.id::int AS source, b.id::int AS target,
         ST_DistanceSphere(a.geom,b.geom) AS dist
  FROM lm a
  JOIN LATERAL (
    SELECT id, geom
    FROM lm b
    WHERE b.id<>a.id
    ORDER BY b.geom <-> a.geom
    LIMIT %d
  ) b ON TRUE
),
edges_cap AS (
  SELECT
    id, source, target,
    CEIL(GREATEST(1.0, 10000.0/NULLIF(dist,0)))::int AS capacity,
    CEIL(GREATEST(1.0, 10000.0/NULLIF(dist,0)))::int AS reverse_capacity
  FROM edges_base
)
SELECT id, source, target, capacity, reverse_capacity
FROM edges_cap
ORDER BY id
$$::text,
    STRING_TO_ARRAY($1, ',')::int[],
    STRING_TO_ARRAY($2, ',')::int[]
  )
),
residual_fwd AS (
  SELECT e.source, e.target
  FROM bk
  JOIN (
WITH lm AS (
  SELECT landmark_id::int AS id, location AS geom FROM public.landmark_gis
),
edges_base AS (
  SELECT ROW_NUMBER() OVER ()::int AS id,
         a.id::int AS source, b.id::int AS target,
         ST_DistanceSphere(a.geom,b.geom) AS dist
  FROM lm a
  JOIN LATERAL (
    SELECT id, geom
    FROM lm b
    WHERE b.id<>a.id
    ORDER BY b.geom <-> a.geom
    LIMIT %d
  ) b ON TRUE
)
SELECT id, source, target FROM edges_base
  ) e ON e.id = bk.edge
  WHERE bk.residual_capacity > 0
),
reach(node) AS (
  SELECT unnest(STRING_TO_ARRAY($1, ',')::int[])::int
  UNION ALL
  SELECT r.target FROM reach r0 JOIN residual_fwd r ON r0.node = r.source
),
cut_edges AS (
  SELECT e.source, e.target
  FROM (
WITH lm AS (
  SELECT landmark_id::int AS id, location AS geom FROM public.landmark_gis
),
edges_base AS (
  SELECT ROW_NUMBER() OVER ()::int AS id,
         a.id::int AS source, b.id::int AS target,
         ST_DistanceSphere(a.geom,b.geom) AS dist
  FROM lm a
  JOIN LATERAL (
    SELECT id, geom
    FROM lm b
    WHERE b.id<>a.id
    ORDER BY b.geom <-> a.geom
    LIMIT %d
  ) b ON TRUE
)
SELECT source, target FROM edges_base
  ) e
  WHERE e.source IN (SELECT node FROM reach)
    AND e.target NOT IN (SELECT node FROM reach)
)
SELECT source, target FROM cut_edges ORDER BY source, target;
`, flowFn, k, k, k)

	type pair struct {
		S int `gorm:"column:source"`
		T int `gorm:"column:target"`
	}
	var cuts []pair
	if zoneA != "" && zoneB != "" {
		if err := ctrl.PostgisDB.Raw(sqlCut, zoneA, zoneB).Scan(&cuts).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "คำนวณ min-cut ล้มเหลว", "detail": err.Error()})
			return
		}
	}

	// 2) เตรียม VALUES ของ cut edges
	cutValues := valsPairs(func() []struct{ S, T int } {
		v := make([]struct{ S, T int }, 0, len(cuts))
		for _, e := range cuts {
			v = append(v, struct{ S, T int }{e.S, e.T})
		}
		return v
	}())

	maxDist, _ := strconv.ParseFloat(c.DefaultQuery("distance", "100000"), 64)

	// 3) สร้าง SQL MST (ฝัง preferences และ cutValues)
	p1, p2, p3 := sqlLit(pref1), sqlLit(pref2), sqlLit(pref3)
	sqlMST := fmt.Sprintf(`
WITH mst AS (
  SELECT *
  FROM pgr_primDD(
    $$
WITH
base AS (
  SELECT
    ROW_NUMBER() OVER ()::int AS id,
    a.landmark_id::int AS source,
    b.landmark_id::int AS target,
    ST_DistanceSphere(a.location, b.location) AS dist
  FROM public.landmark_gis a
  JOIN LATERAL (
    SELECT landmark_id, location
    FROM public.landmark_gis b
    WHERE b.landmark_id <> a.landmark_id
    ORDER BY b.location <-> a.location
    LIMIT %d
  ) b ON TRUE
),

-- --- พาร์ต preference: หา type id จากชื่อ แล้ว map เป็นชุด landmark_id
t1 AS (
  SELECT id FROM public.travel_types
  WHERE kind IN ('','landmark')
    AND length(trim('%s')) > 0
    AND lower(name) = ANY (
      SELECT lower(trim(x)) FROM unnest(string_to_array('%s', ',')) AS x
    )
),
t2 AS (
  SELECT id FROM public.travel_types
  WHERE kind IN ('','landmark')
    AND length(trim('%s')) > 0
    AND lower(name) = ANY (
      SELECT lower(trim(x)) FROM unnest(string_to_array('%s', ',')) AS x
    )
),
t3 AS (
  SELECT id FROM public.travel_types
  WHERE kind IN ('','landmark')
    AND length(trim('%s')) > 0
    AND lower(name) = ANY (
      SELECT lower(trim(x)) FROM unnest(string_to_array('%s', ',')) AS x
    )
),
fav1 AS (SELECT DISTINCT landmark_id AS id FROM public.landmark_types WHERE type_id IN (SELECT id FROM t1)),
fav2 AS (SELECT DISTINCT landmark_id AS id FROM public.landmark_types WHERE type_id IN (SELECT id FROM t2)),
fav3 AS (SELECT DISTINCT landmark_id AS id FROM public.landmark_types WHERE type_id IN (SELECT id FROM t3)),

cut(source, target) AS (
  %s
),

costed AS (
  SELECT
    base.id, base.source, base.target,
    CASE
      WHEN (SELECT 1 FROM cut WHERE cut.source=base.source AND cut.target=base.target LIMIT 1) IS NOT NULL
           AND '%s'='exclude'  THEN NULL
      WHEN (SELECT 1 FROM cut WHERE cut.source=base.source AND cut.target=base.target LIMIT 1) IS NOT NULL
           AND '%s'='penalize' THEN base.dist * (%.6f)::float8
      ELSE base.dist
    END AS base_cost
  FROM base
),

weighted AS (
  SELECT
    id, source, target,
    CASE
      WHEN base_cost IS NULL THEN NULL
      WHEN source IN (SELECT id FROM fav1) OR target IN (SELECT id FROM fav1) THEN base_cost * (%.6f)::float8
      WHEN source IN (SELECT id FROM fav2) OR target IN (SELECT id FROM fav2) THEN base_cost * (%.6f)::float8
      WHEN source IN (SELECT id FROM fav3) OR target IN (SELECT id FROM fav3) THEN base_cost * (%.6f)::float8
      ELSE base_cost
    END AS cost,
    CASE
      WHEN base_cost IS NULL THEN NULL
      WHEN source IN (SELECT id FROM fav1) OR target IN (SELECT id FROM fav1) THEN base_cost * (%.6f)::float8
      WHEN source IN (SELECT id FROM fav2) OR target IN (SELECT id FROM fav2) THEN base_cost * (%.6f)::float8
      WHEN source IN (SELECT id FROM fav3) OR target IN (SELECT id FROM fav3) THEN base_cost * (%.6f)::float8
      ELSE base_cost
    END AS reverse_cost
  FROM costed
  WHERE base_cost IS NOT NULL
)
SELECT id, source, target, cost, reverse_cost
FROM weighted
$$::text,
    %d::int,           -- start_vid
    %.6f::float8       -- max_distance
  )
),

edges_for_pred AS (
  SELECT
    ROW_NUMBER() OVER ()::int AS id,
    a.landmark_id::int AS source,
    b.landmark_id::int AS target
  FROM public.landmark_gis a
  JOIN LATERAL (
    SELECT landmark_id, location
    FROM public.landmark_gis b
    WHERE b.landmark_id <> a.landmark_id
    ORDER BY b.location <-> a.location
    LIMIT %d
  ) b ON TRUE
),

preds AS (
  SELECT m.seq, m.depth, m.start_vid, m.node, m.edge, m.cost, m.agg_cost,
         CASE WHEN m.edge=-1 THEN NULL
              ELSE CASE WHEN e.source=m.node THEN e.target ELSE e.source END
         END AS pred
  FROM mst m
  LEFT JOIN (SELECT id, source, target FROM edges_for_pred) e ON e.id = m.edge
)

SELECT * FROM preds ORDER BY seq;
`, kMst,
		p1, p1,
		p2, p2,
		p3, p3,
		cutValues,
		mode, mode, penalty,
		w1, w2, w3,
		w1, w2, w3,
		root, maxDist,
		kMst,
	)

	var rows []MSTRow
	if err := ctrl.PostgisDB.Raw(sqlMST).Scan(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":  "คำนวณ MST โดยใช้ flow + type preference ไม่สำเร็จ",
			"detail": err.Error(),
		})
		return
	}

	applied := make([][2]int, 0, len(cuts))
	for _, e := range cuts {
		applied = append(applied, [2]int{e.S, e.T})
	}

	c.JSON(http.StatusOK, ByFlowResp{
		MST:             rows,
		AppliedCutEdges: applied,
		Mode:            mode,
		PenaltyFactor:   penalty,
	})
}
