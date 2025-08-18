package entity

import (


	"gorm.io/gorm"
)

type Condition struct {
	gorm.Model

	Day           string `binding:"required"`                     // วันที่เริ่มทริป
	Price         float32   `binding:"required,gte=0"`             // งบประมาณ (>= 0)
	Accommodation string    `binding:"required"`          // ที่พัก เช่น "โรงแรม", "โฮมสเตย์"
	Landmark      string    `binding:"required"`               // สถานที่ เช่น "ธรรมชาติ", "วัด"
	Style         string    `binding:"required"`                  // สไตล์ เช่น "ชิวๆ", "ผจญภัย"

	User_id uint   `binding:"required"`                          // ID ผู้ใช้
	User   *User  `gorm:"foreignKey:User_id"` // foreign key อ้างอิง User
}
