package Accommodation

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"github.com/gtwndtl/trip-spark-builder/entity" 
)

type AccommodationController struct {
	MysqlDB   *gorm.DB
	PostgisDB *gorm.DB
}

func NewAccommodationController(db *gorm.DB, gisDB *gorm.DB) *AccommodationController {
	return &AccommodationController{
		MysqlDB:    db,
		PostgisDB: gisDB,
	}
}

// Create Accommodation + GIS
func (ctl *AccommodationController) Create(c *gin.Context) {
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
		TotalPeople  int       `json:"total_people"`
		Price        float32   `json:"price"`
		Review       int       `json:"review"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	acc := entity.Accommodation{
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
	}

	if err := ctl.MysqlDB.Create(&acc).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create accommodation"})
		return
	}

	wkt := fmt.Sprintf("POINT(%f %f)", input.Lon, input.Lat)
	if err := ctl.PostgisDB.Exec(
		"INSERT INTO accommodation_gis (acc_id, location, created_at, updated_at) VALUES (?, ST_GeomFromText(?, 4326), NOW(), NOW())",
		acc.ID, wkt).Error; err != nil {
		ctl.MysqlDB.Delete(&acc)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create accommodation GIS"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Accommodation created", "id": acc.ID})
}

// Get all accommodations + location
func (ctl *AccommodationController) GetAll(c *gin.Context) {
	var accs []entity.Accommodation
	if err := ctl.MysqlDB.Find(&accs).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get accommodations"})
		return
	}

	type AccWithLocation struct {
		entity.Accommodation
		Location string `json:"location"`
	}

	var results []AccWithLocation
	for _, acc := range accs {
		var location string
		err := ctl.PostgisDB.Raw(
			"SELECT ST_AsText(location) FROM accommodation_gis WHERE acc_id = ?", acc.ID).Scan(&location).Error
		if err != nil {
			location = ""
		}
		results = append(results, AccWithLocation{
			Accommodation: acc,
			Location:      location,
		})
	}

	c.JSON(http.StatusOK, results)
}

// Get accommodation by ID
func (ctl *AccommodationController) GetByID(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid accommodation ID"})
		return
	}

	var acc entity.Accommodation
	if err := ctl.MysqlDB.First(&acc, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Accommodation not found"})
		return
	}

	var location string
	if err := ctl.PostgisDB.Raw(
		"SELECT ST_AsText(location) FROM accommodation_gis WHERE acc_id = ?", id).Scan(&location).Error; err != nil {
		location = ""
	}

	c.JSON(http.StatusOK, gin.H{
		"accommodation": acc,
		"location":      location,
	})
}

// Update accommodation + GIS
func (ctl *AccommodationController) Update(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid accommodation ID"})
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
		TotalPeople  int       `json:"total_people"`
		Price        float32   `json:"price"`
		Review       int       `json:"review"`
	}

	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var acc entity.Accommodation
	if err := ctl.MysqlDB.First(&acc, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Accommodation not found"})
		return
	}

	acc.PlaceID = input.PlaceID
	acc.Name = input.Name
	acc.Category = input.Category
	acc.Lat = float32(input.Lat)
	acc.Lon = float32(input.Lon)
	acc.Address = input.Address
	acc.Province = input.Province
	acc.District = input.District
	acc.SubDistrict = input.SubDistrict
	acc.Postcode = input.Postcode
	acc.ThumbnailURL = input.ThumbnailURL
	acc.Time_open = input.TimeOpen
	acc.Time_close = input.TimeClose
	acc.Total_people = input.TotalPeople
	acc.Price = input.Price
	acc.Review = input.Review

	if err := ctl.MysqlDB.Save(&acc).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update accommodation"})
		return
	}

	wkt := fmt.Sprintf("POINT(%f %f)", input.Lon, input.Lat)
	if err := ctl.PostgisDB.Exec(
		"UPDATE accommodation_gis SET location = ST_GeomFromText(?, 4326), updated_at = NOW() WHERE acc_id = ?",
		wkt, acc.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update accommodation GIS"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Accommodation updated"})
}

// Delete accommodation + GIS
func (ctl *AccommodationController) Delete(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid accommodation ID"})
		return
	}

	if err := ctl.PostgisDB.Exec("DELETE FROM accommodation_gis WHERE acc_id = ?", id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete accommodation GIS"})
		return
	}

	if err := ctl.MysqlDB.Delete(&entity.Accommodation{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete accommodation"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Accommodation deleted"})
}
