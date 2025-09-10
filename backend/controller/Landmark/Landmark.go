package Landmark

import (
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"github.com/gtwndtl/trip-spark-builder/entity"
)

type LandmarkController struct {
	MysqlDB   *gorm.DB
	PostgisDB *gorm.DB
}

func NewLandmarkController(db *gorm.DB, gisDB *gorm.DB) *LandmarkController {
	return &LandmarkController{
		MysqlDB:  db,
		PostgisDB: gisDB,
	}
}

// ------------------------ helpers ------------------------

var reDigits = regexp.MustCompile(`\d[\d,]*`)

func parsePriceRange(s string) (int, int) {
	if s == "" { return 0, 0 }
	t := strings.ToLower(strings.TrimSpace(s))
	t = strings.NewReplacer("–", "-", "—", "-", "−", "-").Replace(t)

	nums := reDigits.FindAllString(t, -1)
	toInt := func(x string) int {
		x = strings.ReplaceAll(x, ",", "")
		n, _ := strconv.Atoi(x)
		return n
	}
	hasFree := strings.Contains(t, "ฟรี") || strings.Contains(t, "free")

	if len(nums) == 0 {
		if hasFree { return 0, 0 }
		return 0, 0
	}

	minV := int(^uint(0) >> 1)
	maxV := 0
	for _, ns := range nums {
		v := toInt(ns)
		if v < minV { minV = v }
		if v > maxV { maxV = v }
	}
	if minV == int(^uint(0)>>1) { minV = 0 }

	if hasFree {
		if maxV == 0 { return 0, 0 }
		return 0, maxV
	}
	if len(nums) == 1 {
		return maxV, maxV
	}
	if minV > maxV { minV, maxV = maxV, minV }
	return minV, maxV
}

// ------------------------ handlers ------------------------

// Create Landmark + LandmarkGis
func (ctl *LandmarkController) Create(c *gin.Context) {
	var input struct {
		PlaceID      int       `json:"place_id"`
		Name         string    `json:"name"`
		Category     string    `json:"category"`
		Lat          float64   `json:"lat"`
		Lon          float64   `json:"lon"`
		Address      string    `json:"address"`
		Province     string    `json:"province"`
		District     string    `json:"district"`
		SubDistrict  string    `json:"sub_district"`
		Postcode     string    `json:"postcode"`
		ThumbnailURL string    `json:"thumbnail_url"`
		TimeOpen     time.Time `json:"time_open"`
		TimeClose    time.Time `json:"time_close"`
		TotalPeople  string    `json:"total_people"`
		Price        string    `json:"price"`
		Review       int       `json:"review"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	pmin, pmax := parsePriceRange(input.Price)

	landmark := entity.Landmark{
		PlaceID:      input.PlaceID,
		Name:         input.Name,
		Category:     input.Category,
		Lat:          float32(input.Lat),
		Lon:          float32(input.Lon),
		Address:      input.Address,
		Province:     input.Province,
		District:     input.District,
		SubDistrict:  input.SubDistrict,
		Postcode:     input.Postcode,
		ThumbnailURL: input.ThumbnailURL,
		Time_open:    input.TimeOpen,
		Time_close:   input.TimeClose,
		Total_people: input.TotalPeople,
		Price:        input.Price,
		Review:       input.Review,
		PriceMin:     pmin,
		PriceMax:     pmax,
	}

	// Save to MySQL
	if err := ctl.MysqlDB.Create(&landmark).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create landmark"})
		return
	}

	// Save to PostGIS
	wkt := fmt.Sprintf("POINT(%f %f)", input.Lon, input.Lat)
	if err := ctl.PostgisDB.Exec(
		"INSERT INTO landmark_gis (landmark_id, location, created_at, updated_at) VALUES (?, ST_GeomFromText(?, 4326), NOW(), NOW())",
		landmark.ID, wkt).Error; err != nil {
		ctl.MysqlDB.Delete(&landmark)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create landmark GIS"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Landmark created", "id": landmark.ID})
}

// Get all landmarks with location WKT
func (ctl *LandmarkController) GetAll(c *gin.Context) {
	var landmarks []entity.Landmark
	if err := ctl.MysqlDB.Find(&landmarks).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get landmarks"})
		return
	}

	type LandmarkWithLocation struct {
		entity.Landmark
		Location string `json:"location"`
	}

	results := make([]LandmarkWithLocation, 0, len(landmarks))
	for _, lm := range landmarks {
		var location string
		err := ctl.PostgisDB.Raw(
			"SELECT ST_AsText(location) FROM landmark_gis WHERE landmark_id = ?",
			lm.ID).Scan(&location).Error
		if err != nil {
			location = ""
		}
		results = append(results, LandmarkWithLocation{
			Landmark: lm,
			Location: location,
		})
	}

	c.JSON(http.StatusOK, results)
}

// Get landmark by ID with location WKT
func (ctl *LandmarkController) GetByID(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid landmark ID"})
		return
	}

	var landmark entity.Landmark
	if err := ctl.MysqlDB.First(&landmark, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Landmark not found"})
		return
	}

	var location string
	if err := ctl.PostgisDB.Raw(
		"SELECT ST_AsText(location) FROM landmark_gis WHERE landmark_id = ?",
		id).Scan(&location).Error; err != nil {
		location = ""
	}

	c.JSON(http.StatusOK, gin.H{"landmark": landmark, "location": location})
}

// Update landmark + GIS location
func (ctl *LandmarkController) Update(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid landmark ID"})
		return
	}

	var input struct {
		PlaceID      int       `json:"place_id"`
		Name         string    `json:"name"`
		Category     string    `json:"category"`
		Lat          float64   `json:"lat"`
		Lon          float64   `json:"lon"`
		Address      string    `json:"address"`
		Province     string    `json:"province"`
		District     string    `json:"district"`
		SubDistrict  string    `json:"sub_district"`
		Postcode     string    `json:"postcode"`
		ThumbnailURL string    `json:"thumbnail_url"`
		TimeOpen     time.Time `json:"time_open"`
		TimeClose    time.Time `json:"time_close"`
		TotalPeople  string    `json:"total_people"`
		Price        string    `json:"price"`
		Review       int       `json:"review"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var landmark entity.Landmark
	if err := ctl.MysqlDB.First(&landmark, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Landmark not found"})
		return
	}

	pmin, pmax := parsePriceRange(input.Price)

	landmark.PlaceID = input.PlaceID
	landmark.Name = input.Name
	landmark.Category = input.Category
	landmark.Lat = float32(input.Lat)
	landmark.Lon = float32(input.Lon)
	landmark.Address = input.Address
	landmark.Province = input.Province
	landmark.District = input.District
	landmark.SubDistrict = input.SubDistrict
	landmark.Postcode = input.Postcode
	landmark.ThumbnailURL = input.ThumbnailURL
	landmark.Time_open = input.TimeOpen
	landmark.Time_close = input.TimeClose
	landmark.Total_people = input.TotalPeople
	landmark.Price = input.Price
	landmark.Review = input.Review
	landmark.PriceMin = pmin
	landmark.PriceMax = pmax

	if err := ctl.MysqlDB.Save(&landmark).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update landmark"})
		return
	}

	wkt := fmt.Sprintf("POINT(%f %f)", input.Lon, input.Lat)
	if err := ctl.PostgisDB.Exec(
		"UPDATE landmark_gis SET location = ST_GeomFromText(?, 4326), updated_at = NOW() WHERE landmark_id = ?",
		wkt, landmark.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update landmark GIS"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Landmark updated"})
}

// Delete landmark + GIS
func (ctl *LandmarkController) Delete(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid landmark ID"})
		return
	}

	if err := ctl.PostgisDB.Exec("DELETE FROM landmark_gis WHERE landmark_id = ?", id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete landmark GIS"})
		return
	}

	if err := ctl.MysqlDB.Delete(&entity.Landmark{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete landmark"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Landmark deleted"})
}
