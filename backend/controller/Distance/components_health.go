package Distance

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type ComponentsHealth struct {
	Components int `gorm:"column:components" json:"components"`
}

// GET /health/components?maxedge=2000&k=10
func (ctrl *DistanceController) GetComponentsHealth(c *gin.Context) {
	maxEdgeStr := c.DefaultQuery("maxedge", "2000")
	kStr := c.DefaultQuery("k", "10")

	sql := `
WITH params AS (
  SELECT $1::float8 AS maxedge, $2::int AS k
),
lm AS (
  SELECT landmark_id::bigint AS id, location AS geom
  FROM landmark_gis
),
edges AS (
  SELECT
    ROW_NUMBER() OVER ()::bigint AS id,
    a.id AS source,
    b.id AS target,
    ST_DistanceSphere(a.geom, b.geom) AS cost,
    ST_DistanceSphere(a.geom, b.geom) AS reverse_cost
  FROM lm a
  JOIN LATERAL (
    SELECT id, geom
    FROM lm b
    WHERE b.id <> a.id
      AND ST_DWithin(a.geom, b.geom, (SELECT maxedge FROM params))
    ORDER BY b.geom <-> a.geom
    LIMIT (SELECT k FROM params)
  ) b ON TRUE
),
cc AS (
  SELECT * FROM pgr_connectedComponents(
    'SELECT id, source, target, cost, reverse_cost FROM edges'
  )
)
SELECT COUNT(DISTINCT component) AS components FROM cc;`

	var res ComponentsHealth
	if err := ctrl.PostgisDB.Raw(sql, maxEdgeStr, kStr).Scan(&res).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ตรวจ components ล้มเหลว", "detail": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}
