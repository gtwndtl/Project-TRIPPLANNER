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
	MST             []MSTRow  `json:"mst"`
	AppliedCutEdges [][2]int  `json:"applied_cut_edges"` // (source,target) จาก min-cut
	Mode            string    `json:"mode"`              // penalize | exclude
	PenaltyFactor   float64   `json:"penalty"`           // ถ้า penalize
}

// ------------------------------------------------------------
// helpers
// ------------------------------------------------------------

// หา zoneA/zoneB อัตโนมัติจากกราฟ KNN (ไม่ใส่เพดานระยะ) โดยยึด component ของ root เป็น zoneA
// และ zone อื่น ๆ เป็น zoneB (รวมกันทั้งหมด) — คืนค่าเป็น CSV string
func (ctrl *DistanceController) findZones(root int, k int) (string, string, error) {
	sql := fmt.Sprintf(`
WITH cc AS (
  SELECT * FROM pgr_connectedComponents($$
    WITH base AS (
      SELECT ROW_NUMBER() OVER ()::int AS id,
             a.landmark_id::int AS source,
             b.landmark_id::int AS target,
             1.0::float8 AS cost, 1.0::float8 AS reverse_cost
      FROM landmark_gis a
      JOIN LATERAL (
        SELECT landmark_id, location
        FROM landmark_gis b
        WHERE b.landmark_id <> a.landmark_id
        ORDER BY b.location <-> a.location
        LIMIT %d
      ) b ON TRUE
    )
    SELECT id, source, target, cost, reverse_cost FROM base
  $$)
),
root_comp AS (
  SELECT component FROM cc WHERE node = $1 LIMIT 1
)
SELECT
  (SELECT STRING_AGG(node::text, ',') FROM cc WHERE component = (SELECT component FROM root_comp)) AS za,
  (SELECT STRING_AGG(node::text, ',') FROM cc WHERE component <> (SELECT component FROM root_comp)) AS zb;
`, k)

	type zones struct {
		Za *string `gorm:"column:za"`
		Zb *string `gorm:"column:zb"`
	}
	var z zones
	if err := ctrl.PostgisDB.Raw(sql, root).Scan(&z).Error; err != nil {
		return "", "", err
	}
	// กัน null
	za := ""
	zb := ""
	if z.Za != nil {
		za = *z.Za
	}
	if z.Zb != nil {
		zb = *z.Zb
	}
	return za, zb, nil
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
// /flow/mincut
// ------------------------------------------------------------
//
// GET /flow/mincut?zoneA=163,58&zoneB=9,119&k=20
// - ไม่ใช้เพดานระยะ ใช้ KNN อย่างเดียว
// - ถ้าไม่ส่ง zoneA/zoneB ระบบจะหาให้จาก root (ต้องส่ง root ด้วยในกรณี auto-zone)
//
func (ctrl *DistanceController) GetFlowMinCut(c *gin.Context) {
	zoneA := strings.TrimSpace(c.Query("zoneA"))
	zoneB := strings.TrimSpace(c.Query("zoneB"))
	kStr := c.DefaultQuery("k", "20")
	k, _ := strconv.Atoi(kStr)
	if k < 1 {
		k = 20
	}

	// ถ้าไม่ส่ง zoneA/zoneB ให้ลองหาเองจาก root
	if zoneA == "" || zoneB == "" {
		rootStr := c.Query("root")
		root, err := strconv.Atoi(rootStr)
		if err != nil || root <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "ต้องระบุ root เป็นจำนวนเต็มบวก เมื่อไม่ส่ง zoneA/zoneB"})
			return
		}
		a, b, err := ctrl.findZones(root, k)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "หา zoneA/zoneB อัตโนมัติไม่สำเร็จ", "detail": err.Error()})
			return
		}
		zoneA, zoneB = a, b
		// ถ้า b ว่าง แปลว่ากราฟทั้งก้อนเดียว ไม่มีอีกโซน → min-cut จะว่าง
	}

	sqlCut := fmt.Sprintf(`
WITH RECURSIVE
bk AS (
  SELECT * FROM %s(
    $$
WITH lm AS (
  SELECT landmark_id::int AS id, location AS geom FROM landmark_gis
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
  SELECT landmark_id::int AS id, location AS geom FROM landmark_gis
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
  SELECT landmark_id::int AS id, location AS geom FROM landmark_gis
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
// /mst/byflow
// ------------------------------------------------------------
//
// GET /mst/byflow?root=29&k=20&k_mst=20&mode=penalize&penalty=1.3
// [ออปชัน] zoneA, zoneB (ถ้าไม่ส่ง จะหาให้อัตโนมัติจาก root)
//
// - ไม่มีเพดานระยะทั้งฝั่ง flow และฝั่ง MST (KNN only)
// - หา min-cut ด้วย BK แล้ว penalize/exclude ในกราฟ MST
//
func (ctrl *DistanceController) GetMSTByFlow(c *gin.Context) {
	rootStr := c.Query("root")
	root, err := strconv.Atoi(rootStr)
	if err != nil || root <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ต้องระบุ root เป็น landmark_id จำนวนเต็มบวก"})
		return
	}

	zoneA := strings.TrimSpace(c.Query("zoneA"))
	zoneB := strings.TrimSpace(c.Query("zoneB"))
	kStr := c.DefaultQuery("k", "20")        // K ฝั่ง flow
	kMstStr := c.DefaultQuery("k_mst", "20") // K ฝั่ง MST
	mode := strings.ToLower(strings.TrimSpace(c.DefaultQuery("mode", "penalize"))) // penalize|exclude
	if mode != "penalize" && mode != "exclude" {
		mode = "penalize"
	}
	penaltyStr := c.DefaultQuery("penalty", "1.3")

	k, _ := strconv.Atoi(kStr)
	if k < 1 {
		k = 20
	}
	kMst, _ := strconv.Atoi(kMstStr)
	if kMst < 1 {
		kMst = 20
	}
	penalty, err := strconv.ParseFloat(penaltyStr, 64)
	if err != nil || penalty <= 0 {
		penalty = 1.3
	}

	// auto-zone ถ้าไม่ส่ง
	if zoneA == "" || zoneB == "" {
		autoA, autoB, err := ctrl.findZones(root, k)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถหาโซนอัตโนมัติ", "detail": err.Error()})
			return
		}
		zoneA, zoneB = autoA, autoB
	}

	// 1) หา cut edges (source,target)
	sqlCut := fmt.Sprintf(`
WITH RECURSIVE
bk AS (
  SELECT * FROM %s(
    $$
WITH lm AS (
  SELECT landmark_id::int AS id, location AS geom FROM landmark_gis
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
  SELECT landmark_id::int AS id, location AS geom FROM landmark_gis
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
  SELECT landmark_id::int AS id, location AS geom FROM landmark_gis
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
	if zoneA != "" && zoneB != "" { // ถ้า zoneB ว่าง แปลว่าไม่มีอีกฝั่ง → ไม่มี cut
		if err := ctrl.PostgisDB.Raw(sqlCut, zoneA, zoneB).Scan(&cuts).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "คำนวณ min-cut ล้มเหลว", "detail": err.Error()})
			return
		}
	}

	// 2) สร้างกราฟ MST KNN only + ปรับ cost ตาม mode แล้วเรียก pgr_primDD
	cutValues := valsPairs(func() []struct{ S, T int } {
		v := make([]struct{ S, T int }, 0, len(cuts))
		for _, e := range cuts {
			v = append(v, struct{ S, T int }{e.S, e.T})
		}
		return v
	}())

	sqlMST := fmt.Sprintf(`
WITH mst AS (
  SELECT *
  FROM pgr_primDD(
    $$
SELECT
  base.id,
  base.source,
  base.target,
  CASE WHEN cut.source IS NOT NULL THEN base.dist * (%.6f)::float8 ELSE base.dist END AS cost,
  CASE WHEN cut.source IS NOT NULL THEN base.dist * (%.6f)::float8 ELSE base.dist END AS reverse_cost
FROM (
  SELECT
    ROW_NUMBER() OVER ()::int AS id,
    a.landmark_id::int AS source,
    b.landmark_id::int AS target,
    ST_DistanceSphere(a.location, b.location) AS dist
  FROM landmark_gis a
  JOIN LATERAL (
    SELECT landmark_id, location
    FROM landmark_gis b
    WHERE b.landmark_id <> a.landmark_id
    ORDER BY b.location <-> a.location
    LIMIT %d
  ) b ON TRUE
) AS base
LEFT JOIN (
  %s
) AS cut(source, target)
  ON (cut.source = base.source AND cut.target = base.target)
WHERE (CASE
         WHEN cut.source IS NOT NULL AND '%s' = 'exclude' THEN NULL
         WHEN cut.source IS NOT NULL AND '%s' = 'penalize' THEN base.dist * (%.6f)::float8
         ELSE base.dist
       END) IS NOT NULL
$$::text,
    %d::int,
    $1::float8
  )
),
edges_for_pred AS (
  SELECT
    base_all.id,
    base_all.source,
    base_all.target
  FROM (
    SELECT
      ROW_NUMBER() OVER ()::int AS id,
      a.landmark_id::int AS source,
      b.landmark_id::int AS target,
      ST_DistanceSphere(a.location, b.location) AS dist
    FROM landmark_gis a
    JOIN LATERAL (
      SELECT landmark_id, location
      FROM landmark_gis b
      WHERE b.landmark_id <> a.landmark_id
      ORDER BY b.location <-> a.location
      LIMIT %d
    ) b ON TRUE
  ) AS base_all
),
preds AS (
  SELECT m.seq, m.depth, m.start_vid, m.node, m.edge, m.cost, m.agg_cost,
         CASE
           WHEN m.edge = -1 THEN NULL
           ELSE CASE WHEN e.source = m.node THEN e.target ELSE e.source END
         END AS pred
  FROM mst m
  LEFT JOIN (SELECT id, source, target FROM edges_for_pred) e ON e.id = m.edge
)
SELECT * FROM preds ORDER BY seq;
`,
		penalty, penalty,
		kMst,
		cutValues,
		mode, mode, penalty,
		root,
		kMst,
	)

	// ระยะรวมสูงสุดของ Prim (distance) ตั้งจาก query param distance (ดีฟอลต์ 100000)
	distStr := c.DefaultQuery("distance", "100000")
	maxDist, _ := strconv.ParseFloat(distStr, 64)

	var rows []MSTRow
	if err := ctrl.PostgisDB.Raw(sqlMST, maxDist).Scan(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":  "คำนวณ MST โดยใช้ flow ไม่สำเร็จ",
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
