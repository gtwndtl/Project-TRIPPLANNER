package entity

import (
	"time"

	"gorm.io/gorm"
)

// entity/accommodation.go
type Accommodation struct {
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
	Time_open    time.Time `binding:"required"`
	Time_close   time.Time `binding:"required"`

	Total_people string `binding:"required"` // เก็บดิบตามไฟล์
	Price        string `binding:"required"` // เก็บดิบ เช่น "1,000 - 1,400"
	Review       int    `binding:"omitempty,gte=0"`

	// ใช้คิวรี/คำนวณ
	PriceMin int `gorm:"index"`
	PriceMax int `gorm:"index"`

	Types []TravelType `gorm:"many2many:accommodation_types;constraint:OnDelete:CASCADE;" json:"types,omitempty"`
}
