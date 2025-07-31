package Shortestpath

import (
	"net/http"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/gtwndtl/trip-spark-builder/entity"
	"gorm.io/gorm"
	"strconv"
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
			return "เที่ยวชม **" + name + "**"
		}
	case "R": // restaurants
		if err := db.Table("restaurants").Where("id = ?", id).Pluck("name", &name).Error; err == nil && name != "" {
			return "รับประทานอาหารที่ **" + name + "**"
		}
	case "A": // accommodations
		if err := db.Table("accommodations").Where("id = ?", id).Pluck("name", &name).Error; err == nil && name != "" {
			return "พักผ่อนที่ **" + name + "**"
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
