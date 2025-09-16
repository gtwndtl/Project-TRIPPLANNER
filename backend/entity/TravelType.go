package entity

import "gorm.io/gorm"

// ชนิดการท่องเที่ยว (ใช้ร่วมกันทั้ง landmark/restaurant/accommodation)
type TravelType struct {
    gorm.Model
    Code string `gorm:"size:191;index:uniq_kind_code,unique"` // <= composite unique
    Name string
    Kind string `gorm:"size:64;index:uniq_kind_code,unique"`  // <= composite unique
}

// ----- Pivot tables -----

type LandmarkType struct {
	ID         uint `gorm:"primaryKey"`
	LandmarkID uint `gorm:"index"`
	TypeID     uint `gorm:"index"`
}
func (LandmarkType) TableName() string { return "landmark_types" }

type RestaurantType struct {
	ID          uint `gorm:"primaryKey"`
	RestaurantID uint `gorm:"index"`
	TypeID      uint `gorm:"index"`
}
func (RestaurantType) TableName() string { return "restaurant_types" }

type AccommodationType struct {
	ID            uint `gorm:"primaryKey"`
	AccommodationID uint `gorm:"index"`
	TypeID        uint `gorm:"index"`
}
func (AccommodationType) TableName() string { return "accommodation_types" }
