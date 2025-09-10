package entity

import (
	"gorm.io/gorm"
	"time"
)

// entity/restaurant.go
type Restaurant struct {
	gorm.Model

	PlaceID      int       `binding:"required"`
	Name         string    `binding:"required,min=2,max=100"`
	Category     string    `binding:"required"`
	Lat          float32   `binding:"required"`
	Lon          float32   `binding:"required"`
	Address      string    `binding:"required"`
	Province     string    `binding:"required"`
	District     string    `binding:"required"`
	SubDistrict  string    `binding:"required"`
	Postcode     string    `binding:"required,len=5"`
	ThumbnailURL string    `binding:"omitempty,url"`
	Time_open    time.Time
	Time_close   time.Time

	Total_people string `binding:"required"`
	Price        string `binding:"required"` // เช่น "฿60-150/คน"
	Review       int    `binding:"omitempty,gte=0"`

	PriceMin int `gorm:"index"`
	PriceMax int `gorm:"index"`
}
