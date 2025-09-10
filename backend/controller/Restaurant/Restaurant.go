package Restaurant

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

type RestaurantController struct {
	MysqlDB   *gorm.DB
	PostgisDB *gorm.DB
}

func NewRestaurantController(db *gorm.DB, gisDB *gorm.DB) *RestaurantController {
	return &RestaurantController{
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

// Create Restaurant + GIS
func (ctl *RestaurantController) Create(c *gin.Context) {
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

	res := entity.Restaurant{
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

	if err := ctl.MysqlDB.Create(&res).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create restaurant"})
		return
	}

	wkt := fmt.Sprintf("POINT(%f %f)", input.Lon, input.Lat)
	if err := ctl.PostgisDB.Exec(
		"INSERT INTO restaurant_gis (restaurant_id, location, created_at, updated_at) VALUES (?, ST_GeomFromText(?, 4326), NOW(), NOW())",
		res.ID, wkt).Error; err != nil {
		ctl.MysqlDB.Delete(&res)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create restaurant GIS"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Restaurant created", "id": res.ID})
}

// Get all restaurants + location
func (ctl *RestaurantController) GetAll(c *gin.Context) {
	var ress []entity.Restaurant
	if err := ctl.MysqlDB.Find(&ress).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get restaurants"})
		return
	}

	type ResWithLocation struct {
		entity.Restaurant
		Location string `json:"location"`
	}

	results := make([]ResWithLocation, 0, len(ress))
	for _, res := range ress {
		var location string
		err := ctl.PostgisDB.Raw(
			"SELECT ST_AsText(location) FROM restaurant_gis WHERE restaurant_id = ?", res.ID).Scan(&location).Error
		if err != nil {
			location = ""
		}
		results = append(results, ResWithLocation{
			Restaurant: res,
			Location:   location,
		})
	}

	c.JSON(http.StatusOK, results)
}

// Get restaurant by ID
func (ctl *RestaurantController) GetByID(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid restaurant ID"})
		return
	}

	var res entity.Restaurant
	if err := ctl.MysqlDB.First(&res, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Restaurant not found"})
		return
	}

	var location string
	if err := ctl.PostgisDB.Raw(
		"SELECT ST_AsText(location) FROM restaurant_gis WHERE restaurant_id = ?", id).Scan(&location).Error; err != nil {
		location = ""
	}

	c.JSON(http.StatusOK, gin.H{"restaurant": res, "location": location})
}

// Update restaurant + GIS
func (ctl *RestaurantController) Update(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid restaurant ID"})
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

	var res entity.Restaurant
	if err := ctl.MysqlDB.First(&res, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Restaurant not found"})
		return
	}

	pmin, pmax := parsePriceRange(input.Price)

	res.PlaceID = input.PlaceID
	res.Name = input.Name
	res.Category = input.Category
	res.Lat = float32(input.Lat)
	res.Lon = float32(input.Lon)
	res.Address = input.Address
	res.Province = input.Province
	res.District = input.District
	res.SubDistrict = input.SubDistrict
	res.Postcode = input.Postcode
	res.ThumbnailURL = input.ThumbnailURL
	res.Time_open = input.TimeOpen
	res.Time_close = input.TimeClose
	res.Total_people = input.TotalPeople
	res.Price = input.Price
	res.Review = input.Review
	res.PriceMin = pmin
	res.PriceMax = pmax

	if err := ctl.MysqlDB.Save(&res).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update restaurant"})
		return
	}

	wkt := fmt.Sprintf("POINT(%f %f)", input.Lon, input.Lat)
	if err := ctl.PostgisDB.Exec(
		"UPDATE restaurant_gis SET location = ST_GeomFromText(?, 4326), updated_at = NOW() WHERE restaurant_id = ?",
		wkt, res.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update restaurant GIS"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Restaurant updated"})
}

// Delete restaurant + GIS
func (ctl *RestaurantController) Delete(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid restaurant ID"})
		return
	}

	if err := ctl.PostgisDB.Exec("DELETE FROM restaurant_gis WHERE restaurant_id = ?", id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete restaurant GIS"})
		return
	}

	if err := ctl.MysqlDB.Delete(&entity.Restaurant{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete restaurant"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Restaurant deleted"})
}
