package config

import (
	"fmt"
	"strconv"
	"time"

	"github.com/xuri/excelize/v2"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/gtwndtl/trip-spark-builder/entity"
)

var (
	dbSqlite   *gorm.DB
	dbPostgres *gorm.DB
)

func DB() *gorm.DB {
	return dbSqlite
}

func PGDB() *gorm.DB {
	return dbPostgres
}

func ConnectionDB() {
	var err error

	// SQLite connection
	dbSqlite, err = gorm.Open(sqlite.Open("final.db?cache=shared"), &gorm.Config{})
	if err != nil {
		panic("❌ Failed to connect SQLite")
	}
	fmt.Println("✅ Connected to SQLite")

	// PostgreSQL connection
	dsn := "host=localhost user=postgres password=1 dbname=postgres port=5432 sslmode=disable TimeZone=Asia/Bangkok"
	dbPostgres, err = gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		panic("❌ Failed to connect PostgreSQL")
	}
	fmt.Println("✅ Connected to PostgreSQL")
}

func SetupDatabase() {
	// Migrate only non-GIS tables in SQLite
	err := dbSqlite.AutoMigrate(
		&entity.Accommodation{},
		&entity.Condition{},
		&entity.Landmark{},
		&entity.Restaurant{},
		&entity.Shortestpath{},
		&entity.Trips{},
		&entity.User{},
	)
	if err != nil {
		panic(err)
	}

	// Migrate only GIS tables in PostgreSQL
	err = dbPostgres.AutoMigrate(
		&entity.AccommodationGis{},
		&entity.LandmarkGis{},
		&entity.RestaurantGis{},
	)
	if err != nil {
		panic(err)
	}

	// Create demo user
	hashedPassword, _ := HashPassword("123456")
	user := entity.User{
		Password:  hashedPassword,
		Firstname: "John",
		Lastname:  "Doe",
		Age:       30,
		Birthday:  time.Date(1993, 1, 1, 0, 0, 0, 0, time.UTC),
		Type:	  "user", // กำหนดเป็น 'user' หรือ 'Google' ตามต้องการ
	}
	dbSqlite.FirstOrCreate(&user, entity.User{Email: "a@gmail.com"})

	fmt.Println("✅ All tables migrated successfully")
}

func LoadExcelData(db *gorm.DB) {
	loadAccommodations(db)
	loadLandmarks(db)
	loadRestaurants(db)
	loadAccommodationGIS()
	loadLandmarkGIS()
	loadRestaurantGIS()
	
}

func loadAccommodations(db *gorm.DB) {
	f, err := excelize.OpenFile("config/places_data_3.xlsx")
	if err != nil {
		panic(err)
	}
	rows, err := f.GetRows("Sheet1")
	if err != nil {
		panic(err)
	}
	for i, row := range rows {
		if i == 0 || len(row) < 11 {
			continue
		}
		lat, _ := strconv.ParseFloat(row[3], 32)
		lon, _ := strconv.ParseFloat(row[4], 32)
		place, _ := strconv.Atoi(row[0])
		data := entity.Accommodation{
			PlaceID:      place,
			Name:         row[1],
			Category:     row[2],
			Lat:          float32(lat),
			Lon:          float32(lon),
			Province:     row[6],
			District:     row[7],
			SubDistrict:  row[8],
			Postcode:     row[9],
			ThumbnailURL: row[10],
			Time_open:    time.Now(),
			Time_close:   time.Now(),
			Total_people: 0,
			Price:        0.00,
			Review:       0,
		}
		db.Create(&data)
	}
}

func loadLandmarks(db *gorm.DB) {
	f, err := excelize.OpenFile("config/Attraction_data_4.xlsx")
	if err != nil {
		panic(err)
	}
	rows, err := f.GetRows("Sheet1")
	if err != nil {
		panic(err)
	}
	for i, row := range rows {
		if i == 0 || len(row) < 11 {
			continue
		}
		lat, _ := strconv.ParseFloat(row[3], 32)
		lon, _ := strconv.ParseFloat(row[4], 32)
		place, _ := strconv.Atoi(row[0])
		data := entity.Landmark{
			PlaceID:      place,
			Name:         row[1],
			Category:     row[2],
			Lat:          float32(lat),
			Lon:          float32(lon),
			Province:     row[6],
			District:     row[7],
			SubDistrict:  row[8],
			Postcode:     row[9],
			ThumbnailURL: row[10],
			Time_open:    time.Now(),
			Time_close:   time.Now(),
			Total_people: 0,
			Price:        0.00,
			Review:       0,
		}
		db.Create(&data)
	}
}

func loadRestaurants(db *gorm.DB) {
	f, err := excelize.OpenFile("config/rharn.xlsx")
	if err != nil {
		panic(err)
	}
	rows, err := f.GetRows("Sheet1")
	if err != nil {
		panic(err)
	}
	for i, row := range rows {
		if i == 0 || len(row) < 11 {
			continue
		}
		lat, _ := strconv.ParseFloat(row[3], 32)
		lon, _ := strconv.ParseFloat(row[4], 32)
		place, _ := strconv.Atoi(row[0])
		data := entity.Restaurant{
			PlaceID:      place,
			Name:         row[1],
			Category:     row[2],
			Lat:          float32(lat),
			Lon:          float32(lon),
			Province:     row[6],
			District:     row[7],
			SubDistrict:  row[8],
			Postcode:     row[9],
			ThumbnailURL: row[10],
			Time_open:    time.Now(),
			Time_close:   time.Now(),
			Total_people: 0,
			Price:        0.00,
			Review:       0,
		}
		db.Create(&data)
	}
}
// ฟังก์ชันช่วย: เช็คว่ามี table อยู่ใน Postgres ไหม
func tableExists(tableName string) bool {
	var exists bool
	query := `
		SELECT EXISTS (
			SELECT FROM information_schema.tables 
			WHERE table_schema = 'public' 
			AND table_name = ?
		);`
	dbPostgres.Raw(query, tableName).Scan(&exists)
	return exists
}

func loadAccommodationGIS() {
	// เช็คว่ามี table ไหม ถ้ามีให้ลบข้อมูลเก่าออก
	if tableExists("accommodation_gis") {
		dbPostgres.Exec("TRUNCATE TABLE accommodation_gis RESTART IDENTITY CASCADE")
	}

	var accommodations []entity.Accommodation
	dbSqlite.Find(&accommodations)
	for _, acc := range accommodations {
		location := fmt.Sprintf("SRID=4326;POINT(%f %f)", acc.Lon, acc.Lat)
		gis := entity.AccommodationGis{
			Acc_ID:   acc.ID,
			Location: location,
		}
		dbPostgres.Create(&gis)
	}
	fmt.Println("✅ Accommodation GIS data reloaded")
}

func loadLandmarkGIS() {
	if tableExists("landmark_gis") {
		dbPostgres.Exec("TRUNCATE TABLE landmark_gis RESTART IDENTITY CASCADE")
	}

	var landmarks []entity.Landmark
	dbSqlite.Find(&landmarks)
	for _, lm := range landmarks {
		location := fmt.Sprintf("SRID=4326;POINT(%f %f)", lm.Lon, lm.Lat)
		gis := entity.LandmarkGis{
			LandmarkID: lm.ID,
			Location:   location,
		}
		dbPostgres.Create(&gis)
	}
	fmt.Println("✅ Landmark GIS data reloaded")
}

func loadRestaurantGIS() {
	if tableExists("restaurant_gis") {
		dbPostgres.Exec("TRUNCATE TABLE restaurant_gis RESTART IDENTITY CASCADE")
	}

	var restaurants []entity.Restaurant
	dbSqlite.Find(&restaurants)
	for _, r := range restaurants {
		location := fmt.Sprintf("SRID=4326;POINT(%f %f)", r.Lon, r.Lat)
		gis := entity.RestaurantGis{
			RestaurantID: r.ID,
			Location:     location,
		}
		dbPostgres.Create(&gis)
	}
	fmt.Println("✅ Restaurant GIS data reloaded")
}