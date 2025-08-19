package Recommend

import (
	"net/http"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/gtwndtl/trip-spark-builder/entity"
)

type RecommendController struct {
	DB *gorm.DB
}

// ✅ Create Recommend
func (rc *RecommendController) Create(c *gin.Context) {
	var recommend entity.Recommend
	if err := c.ShouldBindJSON(&recommend); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := rc.DB.Create(&recommend).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, recommend)
}

// ✅ GetAll Recommend
func (rc *RecommendController) GetAll(c *gin.Context) {
	var recommends []entity.Recommend
	if err := rc.DB.Preload("Trip").Preload("Review").Find(&recommends).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, recommends)
}

// ✅ Get Recommend by ID
func (rc *RecommendController) GetByID(c *gin.Context) {
	id := c.Param("id")
	var recommend entity.Recommend

	if err := rc.DB.Preload("Trip").Preload("Review").First(&recommend, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Recommend not found"})
		return
	}
	c.JSON(http.StatusOK, recommend)
}

// ✅ Update Recommend
func (rc *RecommendController) Update(c *gin.Context) {
	id := c.Param("id")
	var recommend entity.Recommend

	if err := rc.DB.First(&recommend, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Recommend not found"})
		return
	}

	var input entity.Recommend
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	recommend.Condition = input.Condition
	recommend.TripID = input.TripID
	recommend.ReviewID = input.ReviewID

	if err := rc.DB.Save(&recommend).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, recommend)
}

// ✅ Delete Recommend
func (rc *RecommendController) Delete(c *gin.Context) {
	id := c.Param("id")
	if err := rc.DB.Delete(&entity.Recommend{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Deleted successfully"})
}
