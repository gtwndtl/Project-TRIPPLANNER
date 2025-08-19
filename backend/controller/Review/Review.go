package Review

import (
	"net/http"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/gtwndtl/trip-spark-builder/entity"
)

type ReviewController struct {
	DB *gorm.DB
}

// ✅ Create Review
func (rc *ReviewController) Create(c *gin.Context) {
	var review entity.Review
	if err := c.ShouldBindJSON(&review); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := rc.DB.Create(&review).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, review)
}

// ✅ GetAll Reviews
func (rc *ReviewController) GetAll(c *gin.Context) {
	var reviews []entity.Review
	if err := rc.DB.Preload("Trip").Preload("User").Find(&reviews).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, reviews)
}

// ✅ Get Review by ID
func (rc *ReviewController) GetByID(c *gin.Context) {
	id := c.Param("id")
	var review entity.Review

	if err := rc.DB.Preload("Trip").Preload("User").First(&review, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Review not found"})
		return
	}
	c.JSON(http.StatusOK, review)
}

// ✅ Update Review
func (rc *ReviewController) Update(c *gin.Context) {
	id := c.Param("id")
	var review entity.Review

	if err := rc.DB.First(&review, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Review not found"})
		return
	}

	var input entity.Review
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	review.Day = input.Day
	review.Rate = input.Rate
	review.TripID = input.TripID
	review.Comment = input.Comment
	review.User_id = input.User_id

	if err := rc.DB.Save(&review).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, review)
}

// ✅ Delete Review
func (rc *ReviewController) Delete(c *gin.Context) {
	id := c.Param("id")
	if err := rc.DB.Delete(&entity.Review{}, id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Deleted successfully"})
}
