package Distance

import (
	"net/http"
	"strings"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type DistanceController struct {
	MysqlDB   *gorm.DB
	PostgisDB *gorm.DB
}

func NewDistanceController(mysqlDB, postgisDB *gorm.DB) *DistanceController {
	return &DistanceController{
		MysqlDB:   mysqlDB,
		PostgisDB: postgisDB,
	}
}

type DistanceNeighbor struct {
	To       string  `json:"to"`
	Distance float64 `json:"distance"` // km
}

func (ctrl *DistanceController) GetDistances(c *gin.Context) {
	type DistanceResult struct {
		FromType string
		FromID   int
		ToType   string
		ToID     int
		Distance float64
	}

	// ดึง query param "ids" เช่น "P1,R2,A3"
	idsParam := c.Query("ids")
	if idsParam == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ต้องระบุ query parameter 'ids'"})
		return
	}

	// แยก ids เป็น slice
	idList := strings.Split(idsParam, ",")

	// แยกประเภทและ id ออกเพื่อใช้ใน SQL
	pIDs := []int{}
	rIDs := []int{}
	aIDs := []int{}

	for _, id := range idList {
		if len(id) < 2 {
			continue
		}
		prefix := id[:1]
		numStr := id[1:]
		num, err := strconv.Atoi(numStr)
		if err != nil {
			continue
		}
		switch prefix {
		case "P":
			pIDs = append(pIDs, num)
		case "R":
			rIDs = append(rIDs, num)
		case "A":
			aIDs = append(aIDs, num)
		}
	}

	// ถ้าไม่มี id อะไรเลย ก็ส่งกลับ empty
	if len(pIDs) == 0 && len(rIDs) == 0 && len(aIDs) == 0 {
		c.JSON(http.StatusOK, gin.H{})
		return
	}

	var distances []DistanceResult

	// สร้าง SQL แบบ dynamic สำหรับ WHERE IN แต่ละประเภท
	// ฟังก์ชันช่วยสร้าง placeholder: (?, ?, ?)
	makePlaceholders := func(n int) string {
		if n == 0 {
			return ""
		}
		s := strings.Repeat("?,", n)
		return s[:len(s)-1]
	}

	// สร้าง query
	query := `
		WITH filtered_points AS (
			SELECT 'P' AS type, landmark_id AS id, location FROM landmark_gis
			WHERE landmark_id IN (` + makePlaceholders(len(pIDs)) + `)
			UNION ALL
			SELECT 'A' AS type, acc_id AS id, location FROM accommodation_gis
			WHERE acc_id IN (` + makePlaceholders(len(aIDs)) + `)
			UNION ALL
			SELECT 'R' AS type, restaurant_id AS id, location FROM restaurant_gis
			WHERE restaurant_id IN (` + makePlaceholders(len(rIDs)) + `)
		)
		SELECT
			a.type AS from_type, a.id AS from_id,
			b.type AS to_type, b.id AS to_id,
			ST_DistanceSphere(a.location, b.location) AS distance
		FROM filtered_points a
		JOIN filtered_points b ON (a.type != b.type OR a.id != b.id)
	`

	// รวม params ทั้งหมดสำหรับ placeholders ตามลำดับ
	params := []interface{}{}
	for _, v := range pIDs {
		params = append(params, v)
	}
	for _, v := range aIDs {
		params = append(params, v)
	}
	for _, v := range rIDs {
		params = append(params, v)
	}

	err := ctrl.PostgisDB.Raw(query, params...).Scan(&distances).Error
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to calculate distances"})
		return
	}

	// สร้าง graph map[string][]DistanceNeighbor
	graph := make(map[string][]DistanceNeighbor)
	for _, d := range distances {
		fromKey := d.FromType + strconv.Itoa(d.FromID)
		toKey := d.ToType + strconv.Itoa(d.ToID)

		distKm := d.Distance / 1000 // แปลงเป็นกิโลเมตร

		graph[fromKey] = append(graph[fromKey], DistanceNeighbor{
			To:       toKey,
			Distance: distKm,
		})
	}

	c.JSON(http.StatusOK, graph)
}
