package Distance

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)


/* ===== Utils ===== */
func listTablesGeneric(db *gorm.DB) ([]string, error) {
	switch strings.ToLower(db.Dialector.Name()) {
	case "mysql":
		var names []string
		err := db.Raw(`SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()`).Scan(&names).Error
		return names, err
	case "postgres":
		var names []string
		err := db.Raw(`SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = current_schema()`).Scan(&names).Error
		return names, err
	case "sqlite", "sqlite3":
		var names []string
		err := db.Raw(`SELECT name FROM sqlite_master WHERE type='table'`).Scan(&names).Error
		return names, err
	default:
		return []string{}, fmt.Errorf("unsupported dialector: %s", db.Dialector.Name())
	}
}

func ensureNonEmptyInt(xs []int) []int {
	if len(xs) == 0 {
		return []int{-1}
	}
	return xs
}

/* ===== /suggest (landmark | restaurant) ===== */

type SuggestItem struct {
	ID            int64    `json:"id"`
	Name          *string  `json:"name,omitempty"`
	Category      *string  `json:"category,omitempty"`
	DistFromPrevM float64  `json:"dist_from_prev_m"`
	DistToNextM   float64  `json:"dist_to_next_m"`
	TotalM        float64  `json:"total_m"`
}
type spatialRow struct {
	ID            int64   `json:"id"`
	DistFromPrevM float64 `json:"dist_from_prev_m"`
	DistToNextM   float64 `json:"dist_to_next_m"`
	TotalM        float64 `json:"total_m"`
}

// GET /suggest?type=landmark|restaurant&prev=R54&next=P47&radius_m=2000&limit=10&exclude=P69
func (ctl *DistanceController) SuggestPlaces(c *gin.Context) {
	tp := strings.ToLower(c.DefaultQuery("type", "landmark"))
	prev := strings.ToUpper(strings.TrimSpace(c.Query("prev")))
	next := strings.ToUpper(strings.TrimSpace(c.Query("next")))
	if prev == "" || next == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "prev และ next จำเป็น"})
		return
	}

	radiusM, err := strconv.ParseFloat(c.DefaultQuery("radius_m", "2000"), 64)
	if err != nil || radiusM <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "radius_m ไม่ถูกต้อง"})
		return
	}
	limit, err := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if err != nil || limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	exclude := strings.ToUpper(strings.TrimSpace(c.Query("exclude")))

	var table, idCol, alias string
	switch tp {
	case "restaurant":
		table, idCol, alias = "restaurant_gis r", "r.restaurant_id", "r"
	default:
		table, idCol, alias = "landmark_gis p", "p.landmark_id", "p"
	}

	spatialSQL := `
WITH prev AS (
  SELECT location::geography AS g FROM (
    SELECT location FROM landmark_gis     WHERE ? ILIKE 'P%' AND landmark_id   = CAST(regexp_replace(?, '\D', '', 'g') AS int)
    UNION ALL
    SELECT location FROM restaurant_gis    WHERE ? ILIKE 'R%' AND restaurant_id = CAST(regexp_replace(?, '\D', '', 'g') AS int)
    UNION ALL
    SELECT location FROM accommodation_gis WHERE ? ILIKE 'A%' AND acc_id       = CAST(regexp_replace(?, '\D', '', 'g') AS int)
  ) s LIMIT 1
),
nxt AS (
  SELECT location::geography AS g FROM (
    SELECT location FROM landmark_gis     WHERE ? ILIKE 'P%' AND landmark_id   = CAST(regexp_replace(?, '\D', '', 'g') AS int)
    UNION ALL
    SELECT location FROM restaurant_gis    WHERE ? ILIKE 'R%' AND restaurant_id = CAST(regexp_replace(?, '\D', '', 'g') AS int)
    UNION ALL
    SELECT location FROM accommodation_gis WHERE ? ILIKE 'A%' AND acc_id       = CAST(regexp_replace(?, '\D', '', 'g') AS int)
  ) s LIMIT 1
)
SELECT 
  ` + idCol + ` AS id,
  ST_Distance(` + alias + `.location::geography, (SELECT g FROM prev)) AS dist_from_prev_m,
  ST_Distance(` + alias + `.location::geography, (SELECT g FROM nxt )) AS dist_to_next_m,
  ( ST_Distance(` + alias + `.location::geography, (SELECT g FROM prev))
  + ST_Distance(` + alias + `.location::geography, (SELECT g FROM nxt )) ) AS total_m
FROM ` + table + `
WHERE
  ST_DWithin(` + alias + `.location::geography, (SELECT g FROM prev), ?)
  AND ST_DWithin(` + alias + `.location::geography, (SELECT g FROM nxt ), ?)
  AND ( ? = '' OR ` + idCol + ` <> CAST(regexp_replace(?, '\D', '', 'g') AS int) )
ORDER BY total_m
LIMIT ?;`

	var rows []spatialRow
	if err := ctl.PostgisDB.Raw(
		spatialSQL,
		// prev
		prev, prev, prev, prev, prev, prev,
		// next
		next, next, next, next, next, next,
		// filters
		radiusM, radiusM,
		exclude, exclude,
		limit,
	).Scan(&rows).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "spatial query failed", "detail": err.Error()})
		return
	}
	if len(rows) == 0 {
		c.JSON(http.StatusOK, gin.H{"type": tp, "count": 0, "data": []any{}})
		return
	}

	// เติมชื่อจาก MySQL (SQL ปกติ)
	ids := make([]int64, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}

	nameMap := map[int64]struct {
		Name     *string
		Category *string
	}{}

	switch tp {
	case "restaurant":
		type rRow struct {
			ID       int64   `json:"id"`
			Name     *string `json:"name"`
			Category *string `json:"category"`
		}
		var info []rRow
		if err := ctl.MysqlDB.
			Table("restaurants").
			Select("id, name, category").
			Where("id IN ?", ids).
			Scan(&info).Error; err == nil {
			for _, v := range info {
				nameMap[v.ID] = struct {
					Name     *string
					Category *string
				}{v.Name, v.Category}
			}
		}
	default:
		type pRow struct {
			ID   int64   `json:"id"`
			Name *string `json:"name"`
		}
		var info []pRow
		if err := ctl.MysqlDB.
			Table("landmarks").
			Select("id, name").
			Where("id IN ?", ids).
			Scan(&info).Error; err == nil {
			for _, v := range info {
				nameMap[v.ID] = struct {
					Name     *string
					Category *string
				}{v.Name, nil}
			}
		}
	}

	out := make([]SuggestItem, 0, len(rows))
	for _, r := range rows {
		item := SuggestItem{
			ID:            r.ID,
			DistFromPrevM: r.DistFromPrevM,
			DistToNextM:   r.DistToNextM,
			TotalM:        r.TotalM,
		}
		if v, ok := nameMap[r.ID]; ok {
			item.Name = v.Name
			item.Category = v.Category
		}
		out = append(out, item)
	}

	c.JSON(http.StatusOK, gin.H{
		"type":     tp,
		"prev":     prev,
		"next":     next,
		"radius_m": radiusM,
		"count":    len(out),
		"data":     out,
	})
}

/* ===== /suggest/accommodations ===== */

type accRow struct {
	ID          int64   `json:"id"`
	DistCenterM float64 `json:"dist_center_m"`
	AvgM        float64 `json:"avg_m"`
	MaxM        float64 `json:"max_m"`
	TotalM      float64 `json:"total_m"`
	NPoints     int64   `json:"n_points"`
}
type accOut struct {
	ID          int64    `json:"id"`
	Code        string   `json:"code"`
	Name        *string  `json:"name,omitempty"`
	Category    *string  `json:"category,omitempty"`
	DistCenterM float64  `json:"dist_center_m"`
	AvgM        float64  `json:"avg_m"`
	MaxM        float64  `json:"max_m"`
	TotalM      float64  `json:"total_m"`
	NPoints     int64    `json:"n_points"`
}

// GET /suggest/accommodations?trip_id=1&day=1&strategy=sum&radius_m=3000&limit=12&exclude=A12&sp_table=shortestpaths
func (ctl *DistanceController) SuggestAccommodations(c *gin.Context) {
	tripIDStr := strings.TrimSpace(c.Query("trip_id"))
	if tripIDStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "trip_id จำเป็น"})
		return
	}
	tripID, err := strconv.Atoi(tripIDStr)
	if err != nil || tripID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "trip_id ไม่ถูกต้อง"})
		return
	}
	dayStr := strings.TrimSpace(c.Query("day"))
	var day *int
	if dayStr != "" {
		if d, e := strconv.Atoi(dayStr); e == nil && d > 0 {
			day = &d
		}
	}
	radiusM, err := strconv.ParseFloat(c.DefaultQuery("radius_m", "3000"), 64)
	if err != nil || radiusM <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "radius_m ไม่ถูกต้อง"})
		return
	}
	limit, err := strconv.Atoi(c.DefaultQuery("limit", "20"))
	if err != nil || limit <= 0 {
		limit = 20
	}
	if limit > 200 {
		limit = 200
	}
	strategy := strings.ToLower(strings.TrimSpace(c.DefaultQuery("strategy", "center")))
	if strategy != "center" && strategy != "sum" {
		strategy = "center"
	}
	exclude := strings.ToUpper(strings.TrimSpace(c.Query("exclude")))
	spTable := strings.TrimSpace(c.Query("sp_table")) // <<— frontend ส่งมา (เช่น shortestpaths)

	if spTable == "" {
		spTable = "shortestpaths" // ค่า default ให้ตรง GORM ของโมเดล Shortestpath
	}

	fmt.Printf("[SuggestAccommodations] dialector=%s, sp_table=%s\n", ctl.MysqlDB.Dialector.Name(), spTable)

	// เปิด log GORM ช่วย debug ชั่วคราว
	oldLogger := ctl.MysqlDB.Config.Logger
	ctl.MysqlDB.Config.Logger = logger.Default.LogMode(logger.Info)
	defer func() { ctl.MysqlDB.Config.Logger = oldLogger }()

	if !ctl.MysqlDB.Migrator().HasTable(spTable) {
		names, _ := listTablesGeneric(ctl.MysqlDB)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":   "shortest paths table not found",
			"detail":  fmt.Sprintf("no such table: %s (dialector=%s)", spTable, ctl.MysqlDB.Dialector.Name()),
			"tables":  names,
			"hint":    "ส่ง ?sp_table=<ชื่อตารางจริง> หรือสร้าง VIEW shortest_paths ครอบตารางจริง",
		})
		return
	}

	// mapping ชื่อคอลัมน์ให้ตรง schema ของคุณ
	const colTrip = "trip_id"
	const colDay = "day"
	const colFrom = "from_code"
	const colTo = "to_code"

	type codeRow struct{ Code string }

	var froms []codeRow
	q := ctl.MysqlDB.Table(spTable).
		Select("DISTINCT " + colFrom + " AS code").
		Where(colTrip+" = ? AND "+colFrom+" <> ''", tripID)
	if day != nil {
		q = q.Where(colDay+" = ?", *day)
	}
	if err := q.Scan(&froms).Error; err != nil {
		names, _ := listTablesGeneric(ctl.MysqlDB)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":     "load from-codes failed",
			"detail":    err.Error(),
			"sp_table":  spTable,
			"dialector": ctl.MysqlDB.Dialector.Name(),
			"tables":    names,
			"hint":      "ตรวจชื่อคอลัมน์ (" + colFrom + "/" + colTrip + "/" + colDay + ")",
		})
		return
	}

	var tos []codeRow
	q2 := ctl.MysqlDB.Table(spTable).
		Select("DISTINCT " + colTo + " AS code").
		Where(colTrip+" = ? AND "+colTo+" <> ''", tripID)
	if day != nil {
		q2 = q2.Where(colDay+" = ?", *day)
	}
	_ = q2.Scan(&tos)

	codeSet := make(map[string]struct{})
	for _, r := range froms {
		codeSet[strings.ToUpper(strings.TrimSpace(r.Code))] = struct{}{}
	}
	for _, r := range tos {
		codeSet[strings.ToUpper(strings.TrimSpace(r.Code))] = struct{}{}
	}
	if len(codeSet) == 0 {
		c.JSON(http.StatusOK, gin.H{"trip_id": tripID, "day": day, "strategy": strategy, "count": 0, "data": []any{}})
		return
	}

	var pIDs, rIDs, aIDs []int
	for code := range codeSet {
		if code == "" {
			continue
		}
		switch code[0] {
		case 'P', 'p':
			if id, e := strconv.Atoi(strings.TrimLeft(code, "Pp")); e == nil {
				pIDs = append(pIDs, id)
			}
		case 'R', 'r':
			if id, e := strconv.Atoi(strings.TrimLeft(code, "Rr")); e == nil {
				rIDs = append(rIDs, id)
			}
		case 'A', 'a':
			if id, e := strconv.Atoi(strings.TrimLeft(code, "Aa")); e == nil {
				aIDs = append(aIDs, id)
			}
		}
	}
	pIDs = ensureNonEmptyInt(pIDs)
	rIDs = ensureNonEmptyInt(rIDs)
	aIDs = ensureNonEmptyInt(aIDs)

	var rows []accRow

	sqlCenter := `
WITH pts AS (
  SELECT location::geography AS g FROM landmark_gis   WHERE landmark_id   IN ?
  UNION ALL
  SELECT location::geography AS g FROM restaurant_gis WHERE restaurant_id IN ?
  UNION ALL
  SELECT location::geography AS g FROM accommodation_gis WHERE acc_id     IN ?
), cent AS (
  SELECT ST_Centroid(ST_Collect(g::geometry))::geography AS g FROM pts
)
SELECT
  a.acc_id AS id,
  ST_Distance(a.location::geography, (SELECT g FROM cent)) AS dist_center_m,
  0 AS avg_m, 0 AS max_m, 0 AS total_m, (SELECT COUNT(*) FROM pts) AS n_points
FROM accommodation_gis a
WHERE
  ST_DWithin(a.location::geography, (SELECT g FROM cent), ?)
  AND (? = '' OR a.acc_id <> CAST(regexp_replace(?, '\D', '', 'g') AS int))
ORDER BY dist_center_m
LIMIT ?;`

	sqlSum := `
WITH pts AS (
  SELECT location::geography AS g FROM landmark_gis   WHERE landmark_id   IN ?
  UNION ALL
  SELECT location::geography AS g FROM restaurant_gis WHERE restaurant_id IN ?
  UNION ALL
  SELECT location::geography AS g FROM accommodation_gis WHERE acc_id     IN ?
), cent AS (
  SELECT ST_Centroid(ST_Collect(g::geometry))::geography AS g FROM pts
), cand AS (
  SELECT a.acc_id, a.location::geography AS g
  FROM accommodation_gis a
  WHERE ST_DWithin(a.location::geography, (SELECT g FROM cent), ?)
    AND (? = '' OR a.acc_id <> CAST(regexp_replace(?, '\D', '', 'g') AS int))
), agg AS (
  SELECT
    cand.acc_id AS id,
    AVG(ST_Distance(cand.g, pts.g))  AS avg_m,
    MAX(ST_Distance(cand.g, pts.g))  AS max_m,
    SUM(ST_Distance(cand.g, pts.g))  AS total_m,
    COUNT(*)                         AS n_points
  FROM cand, pts
  GROUP BY cand.acc_id
)
SELECT
  a.id,
  ST_Distance((SELECT g FROM cand WHERE cand.acc_id=a.id LIMIT 1), (SELECT g FROM cent)) AS dist_center_m,
  a.avg_m, a.max_m, a.total_m, a.n_points
FROM agg a
ORDER BY a.avg_m
LIMIT ?;`

	switch strategy {
	case "sum":
		if err := ctl.PostgisDB.Raw(sqlSum, pIDs, rIDs, aIDs, radiusM, exclude, exclude, limit).
			Scan(&rows).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "spatial(sum) failed", "detail": err.Error()})
			return
		}
	default:
		if err := ctl.PostgisDB.Raw(sqlCenter, pIDs, rIDs, aIDs, radiusM, exclude, exclude, limit).
			Scan(&rows).Error; err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "spatial(center) failed", "detail": err.Error()})
			return
		}
	}

	if len(rows) == 0 {
		c.JSON(http.StatusOK, gin.H{"trip_id": tripID, "day": day, "strategy": strategy, "count": 0, "data": []any{}})
		return
	}

	// เติมชื่อจาก SQL ปกติ
	ids := make([]int64, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	type accInfo struct {
		ID       int64   `json:"id"`
		Name     *string `json:"name"`
		Category *string `json:"category"`
	}
	var info []accInfo
	_ = ctl.MysqlDB.
		Table("accommodations").
		Select("id, name, category").
		Where("id IN ?", ids).
		Scan(&info).Error

	nameMap := map[int64]accInfo{}
	for _, v := range info {
		nameMap[v.ID] = v
	}

	out := make([]accOut, 0, len(rows))
	for _, r := range rows {
		o := accOut{
			ID:          r.ID,
			Code:        fmt.Sprintf("A%d", r.ID),
			DistCenterM: r.DistCenterM,
			AvgM:        r.AvgM,
			MaxM:        r.MaxM,
			TotalM:      r.TotalM,
			NPoints:     r.NPoints,
		}
		if v, ok := nameMap[r.ID]; ok {
			o.Name = v.Name
			o.Category = v.Category
		}
		out = append(out, o)
	}

	c.JSON(http.StatusOK, gin.H{
		"trip_id":  tripID,
		"day":      day,
		"strategy": strategy,
		"radius_m": radiusM,
		"count":    len(out),
		"data":     out,
	})
}
