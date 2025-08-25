package Shortestpath

import (
	"database/sql"
	"fmt"
	"net/http"

	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gtwndtl/trip-spark-builder/entity"
	"gorm.io/gorm"
)

type ShortestPathController struct {
	DB        *gorm.DB // MySQL
	PostgisDB *gorm.DB // PostGIS
}

func NewShortestPathController(db *gorm.DB, postgisDB *gorm.DB) *ShortestPathController {
	return &ShortestPathController{
		DB:        db,
		PostgisDB: postgisDB,
	}
}


// POST /shortest-paths
func (ctrl *ShortestPathController) CreateShortestPath(c *gin.Context) {
	var path entity.Shortestpath
	if err := c.ShouldBindJSON(&path); err != nil {
		fmt.Printf("JSON Bind error: %v\n", err)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fmt.Printf("Received CreateShortestPath: %+v\n", path)

	if err := ctrl.DB.Create(&path).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถสร้างข้อมูลได้"})
		return
	}
	c.JSON(http.StatusOK, path)
}

// GET /shortest-paths
func (ctrl *ShortestPathController) GetAllShortestPaths(c *gin.Context) {
	var paths []entity.Shortestpath
	if err := ctrl.DB.Find(&paths).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถดึงข้อมูลได้"})
		return
	}
	c.JSON(http.StatusOK, paths)
}

// GET /shortest-paths/:id
func (ctrl *ShortestPathController) GetShortestPathByID(c *gin.Context) {
	id := c.Param("id")
	var path entity.Shortestpath
	if err := ctrl.DB.First(&path, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบข้อมูลเส้นทาง"})
		return
	}
	c.JSON(http.StatusOK, path)
}

// PUT /shortest-paths/:id
func (ctrl *ShortestPathController) UpdateShortestPath(c *gin.Context) {
	id := c.Param("id")

	var path entity.Shortestpath
	if err := ctrl.DB.First(&path, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "ไม่พบข้อมูล"})
		return
	}

	var input entity.Shortestpath
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fmt.Printf("Old ToCode: %s, New ToCode: %s\n", path.ToCode, input.ToCode)
	toCodeChanged := path.ToCode != input.ToCode
	fmt.Printf("toCodeChanged = %v\n", toCodeChanged)

	// อัปเดตฟิลด์ทั่วไป (รวม ToCode ด้วย)
	path.TripID = input.TripID
	path.Day = input.Day
	path.PathIndex = input.PathIndex
	path.FromCode = input.FromCode
	path.ToCode = input.ToCode
	path.Type = input.Type
	path.StartTime = input.StartTime
	path.EndTime = input.EndTime

	distance, err := ctrl.updateDistance(path.FromCode, path.ToCode)
	if err == nil {
		path.Distance = distance
	} else {
		fmt.Printf("Error updating distance: %v\n", err)
	}

	// ถ้า ToCode เปลี่ยน ให้อัปเดต ActivityDescription ใหม่จาก ToCode ใหม่
	if toCodeChanged {
		path.ActivityDescription = getDescriptionFromCode(ctrl.DB, input.ToCode)
	}

	if err := ctrl.DB.Save(&path).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถอัพเดตข้อมูลได้"})
		return
	}

	// ถ้า ToCode เปลี่ยน → เปลี่ยน FromCode ของ Path ถัดไป และคำนวณระยะทาง path ถัดไปใหม่ด้วย
	if toCodeChanged {
		var next entity.Shortestpath
		err := ctrl.DB.Where("trip_id = ? AND day = ? AND path_index = ?", path.TripID, path.Day, path.PathIndex+1).First(&next).Error
		if err == nil {
			fmt.Printf("Before update next FromCode: %s\n", next.FromCode)
			next.FromCode = path.ToCode // ใช้ ToCode ใหม่ของ path ปัจจุบัน

			// คำนวณระยะทางใหม่ path ถัดไป
			distance, err := ctrl.updateDistance(next.FromCode, next.ToCode)
			if err == nil {
				next.Distance = distance
			} else {
				fmt.Printf("Error updating distance for next path: %v\n", err)
			}

			if err := ctrl.DB.Save(&next).Error; err != nil {
				fmt.Printf("อัปเดต FromCode และระยะทางของ path ถัดไปไม่สำเร็จ: %v\n", err)
			} else {
				fmt.Printf("อัปเดต FromCode และระยะทางของ path ถัดไปสำเร็จ: %+v\n", next)
			}
		} else {
			fmt.Printf("ไม่พบ path ถัดไป หรือเกิดข้อผิดพลาด: %v\n", err)
		}
	}

	c.JSON(http.StatusOK, path)
}

// ฟังก์ชันคำนวณระยะทางระหว่าง 2 จุด โดย query จากฐานข้อมูล GIS
func (ctrl *ShortestPathController) updateDistance(fromCode, toCode string) (float32, error) {
	if len(fromCode) < 2 || len(toCode) < 2 {
		return 0, fmt.Errorf("invalid code format")
	}

	// แยก prefix กับ id
	fromPrefix := fromCode[:1]
	toPrefix := toCode[:1]
	fromID, err1 := strconv.Atoi(fromCode[1:])
	toID, err2 := strconv.Atoi(toCode[1:])
	if err1 != nil || err2 != nil {
		return 0, fmt.Errorf("invalid numeric ID in code")
	}

	getTableAndColumn := func(prefix string) (string, string) {
		switch prefix {
		case "P":
			return "landmark_gis", "landmark_id"
		case "R":
			return "restaurant_gis", "restaurant_id"
		case "A":
			return "accommodation_gis", "acc_id"
		default:
			return "", ""
		}
	}

	fromTable, fromCol := getTableAndColumn(fromPrefix)
	toTable, toCol := getTableAndColumn(toPrefix)
	if fromTable == "" || toTable == "" {
		return 0, fmt.Errorf("unknown prefix")
	}

	var distance float64
	query := fmt.Sprintf(`
		SELECT ST_DistanceSphere(a.location, b.location)
		FROM %s a, %s b
		WHERE a.%s = ? AND b.%s = ?
		LIMIT 1
	`, fromTable, toTable, fromCol, toCol)

	err := ctrl.PostgisDB.Raw(query, fromID, toID).Scan(&distance).Error
	if err != nil {
		return 0, err
	}

	 return float32(distance / 1000), nil // แปลงเป็น float32 ตามตาราง
}

func getDescriptionFromCode(db *gorm.DB, code string) string {
	if len(code) < 2 {
		return "ทำกิจกรรม"
	}
	prefix := code[:1]    // ตัวอักษรแรก เช่น R, P, A
	idStr := code[1:]     // ตัวเลขหลัง เช่น 469
	id, err := strconv.Atoi(idStr)
	if err != nil {
		return "ทำกิจกรรม"
	}

	var name string
	switch prefix {
	case "P": // landmarks
		if err := db.Table("landmarks").Where("id = ?", id).Pluck("name", &name).Error; err == nil && name != "" {
			return "เที่ยวชม " + name 
		}
	case "R": // restaurants
		if err := db.Table("restaurants").Where("id = ?", id).Pluck("name", &name).Error; err == nil && name != "" {
			return "รับประทานอาหารที่ " + name 
		}
	case "A": // accommodations
		if err := db.Table("accommodations").Where("id = ?", id).Pluck("name", &name).Error; err == nil && name != "" {
			return "พักผ่อนที่ " + name 
		}
	default:
		return "ทำกิจกรรม"
	}

	return "ทำกิจกรรม"
}

// DELETE /shortest-paths/:id
func (ctrl *ShortestPathController) DeleteShortestPath(c *gin.Context) {
	id := c.Param("id")
	if err := ctrl.DB.Delete(&entity.Shortestpath{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "ไม่สามารถลบข้อมูลได้"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "ลบข้อมูลสำเร็จ"})
}



func looksLikeCheckout(text string) bool {
	txt := strings.ToLower(text)
	return strings.Contains(txt, "เช็คเอาท์") || strings.Contains(txt, "เช็คเอ้าท์") || strings.Contains(txt, "check-out")
}

// มาตรฐานคำอธิบายสำหรับที่พัก
// - เข้าพัก:   "พักผ่อนที่ **<ชื่อโรงแรม>**"
// - เช็คเอาท์: "เช็คเอาท์จาก **<ชื่อโรงแรม>** และเดินทางกลับ"
func normalizeAccDesc(oldText, hotelName string, isCheckout bool) string {
	hotelName = strings.TrimSpace(hotelName)
	if isCheckout {
		if hotelName != "" {
			return "เช็คเอาท์จาก **" + hotelName + "** และเดินทางกลับ"
		}
		// ไม่รู้ชื่อก็ใช้ทั่วไป
		return "เช็คเอาท์และเดินทางกลับ"
	}
	if hotelName != "" {
		return "พักผ่อนที่ **" + hotelName + "**"
	}
	return "พักผ่อนที่ **ที่พัก**"
}

// ถ้าต้องการ “คงข้อความ checkout เดิม” ให้ใช้ตัวนี้แทน normalizeAccDesc
// func rebuildAccDesc(oldText, hotelName string, isCheckout bool) string {
// 	if isCheckout {
// 		return oldText // คงข้อความเดิม
// 	}
// 	return normalizeAccDesc(oldText, hotelName, false)
// }

func (ctrl *ShortestPathController) getAccommodationName(accCode string) (string, error) {
	idStr := strings.TrimLeft(strings.ToUpper(accCode), "A")
	var name sql.NullString
	if err := ctrl.DB.
		Table("accommodations").
		Select("name").
		Where("id = ?", idStr).
		Scan(&name).Error; err != nil {
		return "", err
	}
	if name.Valid {
		return name.String, nil
	}
	return "", nil
}

// updateDistance ควรมีอยู่แล้วใน controller ของคุณ
// func (ctrl *ShortestPathController) updateDistance(fromCode, toCode string) (float32, error) { ... }

// ===== Handler =====

// PUT /shortest-paths/accommodation/bulk
// body:
// {
//   "trip_id": 1,
//   "acc_code": "A171",
//   "days": [1,2],   // optional; ไม่ส่ง = ทั้งทริป
//   "scope": "both"  // "both"|"from"|"to" (default both)
// }
func (ctrl *ShortestPathController) BulkUpdateAccommodation(c *gin.Context) {
	type reqT struct {
		TripID  uint   `json:"trip_id" binding:"required"`
		AccCode string `json:"acc_code" binding:"required"`
		Days    []int  `json:"days"`
		Scope   string `json:"scope"` // both|from|to
	}
	var req reqT
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	scope := strings.ToLower(strings.TrimSpace(req.Scope))
	if scope == "" {
		scope = "both"
	}

	hotelName, err := ctrl.getAccommodationName(req.AccCode)
	if err != nil {
		// ไม่ถึงกับ fail ทั้งงาน แค่ไม่มีชื่อไว้แสดง
		hotelName = ""
	}

	tx := ctrl.DB.Begin()
	if tx.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": tx.Error.Error()})
		return
	}
	defer func() {
		if r := recover(); r != nil {
			tx.Rollback()
		}
	}()

	// ตาราง GORM: "shortestpaths" (ไม่มี underscore)
	q := tx.Where("trip_id = ?", req.TripID)
	if len(req.Days) > 0 {
		q = q.Where("day IN ?", req.Days)
	}

	var rows []entity.Shortestpath
	if err := q.
		// ดึงเฉพาะแถวที่เกี่ยวข้องกับ A
		Where("from_code LIKE 'A%' OR to_code LIKE 'A%'").
		Order("day, path_index").
		Find(&rows).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "query failed", "detail": err.Error()})
		return
	}

	updated := 0

	for i := range rows {
		p := &rows[i]
		changed := false
		toChanged := false

		// FromCode
		if (scope == "both" || scope == "from") && strings.HasPrefix(strings.ToUpper(p.FromCode), "A") {
			if p.FromCode != req.AccCode {
				p.FromCode = req.AccCode
				changed = true
			}
		}

		// ToCode + ActivityDescription
		if (scope == "both" || scope == "to") && strings.HasPrefix(strings.ToUpper(p.ToCode), "A") {
			if p.ToCode != req.AccCode {
				p.ToCode = req.AccCode
				toChanged = true
				changed = true
			}
			// normalize คำอธิบายให้สม่ำเสมอเสมอ (ถ้าไม่อยาก normalize ตอน ToCode ไม่เปลี่ยน ให้เช็ค toChanged ก่อน)
			isCheckout := looksLikeCheckout(p.ActivityDescription)
			p.ActivityDescription = normalizeAccDesc(p.ActivityDescription, hotelName, isCheckout)
		}

		if changed {
			// คำนวณระยะใหม่
			if d, err := ctrl.updateDistance(p.FromCode, p.ToCode); err == nil {
				p.Distance = d
			}
			if err := tx.Save(p).Error; err != nil {
				tx.Rollback()
				c.JSON(http.StatusInternalServerError, gin.H{"error": "save failed", "detail": err.Error()})
				return
			}
			updated++

			// ถ้า ToCode เปลี่ยน → อัปเดต FromCode ของ path ถัดไป + คำนวณระยะ
			if toChanged {
				var next entity.Shortestpath
				if err := tx.
					Where("trip_id = ? AND day = ? AND path_index = ?", p.TripID, p.Day, p.PathIndex+1).
					First(&next).Error; err == nil {
					next.FromCode = p.ToCode
					if d2, e2 := ctrl.updateDistance(next.FromCode, next.ToCode); e2 == nil {
						next.Distance = d2
					}
					if err := tx.Save(&next).Error; err != nil {
						tx.Rollback()
						c.JSON(http.StatusInternalServerError, gin.H{"error": "save next failed", "detail": err.Error()})
						return
					}
				}
			}
		}
	}

	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "commit failed", "detail": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"updated": updated,
	})
}