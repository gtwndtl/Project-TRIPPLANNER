package entity

import (
	"time"

	"gorm.io/gorm"
)

// entity/landmark.go
type Landmark struct {
	gorm.Model

	PlaceID      int       `binding:"required"`
	Name         string    `binding:"required,min=2,max=100"`
	Category     string    `json:"category" binding:"required"`
	Lat          float32   `binding:"required"`
	Lon          float32   `binding:"required"`
	Address      string    `binding:"required"`
	Province     string    `binding:"required"`
	District     string    `binding:"required"`
	SubDistrict  string    `binding:"required"`
	Postcode     string    `binding:"required,len=5"`
	ThumbnailURL string    `binding:"omitempty,url"`
	Time_open    time.Time `binding:"required"`
	Time_close   time.Time `binding:"required"`

	Total_people string `binding:"required"`
	Price        string `binding:"required"`
	Review       int    `binding:"omitempty,gte=0"`

	PriceMin int `gorm:"index"`
	PriceMax int `gorm:"index"`

	Types []TravelType `gorm:"many2many:landmark_types;constraint:OnDelete:CASCADE;" json:"types,omitempty"`
}
