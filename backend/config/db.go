package config

import (
	"fmt"
	"log"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	gormLogger "gorm.io/gorm/logger"

	"github.com/gtwndtl/trip-spark-builder/entity"
)

var (
	dbSqlite   *gorm.DB
	dbPostgres *gorm.DB
)

func DB() *gorm.DB   { return dbSqlite }
func PGDB() *gorm.DB { return dbPostgres }

// ------------------------------
// GORM logger: ตัด record-not-found logs
// ------------------------------
func newGormLogger() gormLogger.Interface {
	return gormLogger.New(
		log.New(os.Stdout, "\r\n", log.LstdFlags),
		gormLogger.Config{
			SlowThreshold:             time.Second,
			LogLevel:                  gormLogger.Warn, // เปลี่ยนเป็น Info ได้ถ้าต้องการดูละเอียด
			IgnoreRecordNotFoundError: true,            // << ตัด log record not found
			Colorful:                  true,
		},
	)
}

func ConnectionDB() {
	var err error
	lg := newGormLogger()

	// SQLite
	dbSqlite, err = gorm.Open(sqlite.Open("final.db?cache=shared"), &gorm.Config{Logger: lg})
	if err != nil {
		panic("❌ Failed to connect SQLite")
	}
	fmt.Println("✅ Connected to SQLite")

	// PostgreSQL
	dsn := "host=localhost user=postgres password=1 dbname=postgres port=5432 sslmode=disable TimeZone=Asia/Bangkok"
	dbPostgres, err = gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: lg})
	if err != nil {
		panic("❌ Failed to connect PostgreSQL")
	}
	fmt.Println("✅ Connected to PostgreSQL")
}

func SetupDatabase() {
	// -------- SQLite: migrate non-GIS --------
	if err := dbSqlite.AutoMigrate(
		&entity.Accommodation{},
		&entity.Condition{},
		&entity.Landmark{},
		&entity.Restaurant{},
		&entity.Shortestpath{},
		&entity.Trips{},
		&entity.User{},
		&entity.Review{},
		&entity.Recommend{},
		&entity.TravelType{},
		&entity.LandmarkType{},
		&entity.RestaurantType{},
		&entity.AccommodationType{},
	); err != nil {
		panic(err)
	}

	// -------- Postgres: migrate GIS + types/pivots --------
	if err := dbPostgres.AutoMigrate(
		&entity.AccommodationGis{},
		&entity.LandmarkGis{},
		&entity.RestaurantGis{},
		&entity.TravelType{},
		&entity.LandmarkType{},
		&entity.RestaurantType{},
		&entity.AccommodationType{},
	); err != nil {
		panic(err)
	}

	// ---- สร้าง composite-unique (kind, code) แบบไม่ก่อ error ----
	// ปล่อยให้ AutoMigrate จาก tag สร้างก็พอ แต่เสริม IF NOT EXISTS เพื่อความชัวร์/เงียบ
	dbSqlite.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_kind_code ON travel_types(code, kind)`)
	dbPostgres.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_kind_code ON public.travel_types (code, kind)`)

	// Index อื่นๆ (SQLite)
	dbSqlite.Exec(`CREATE INDEX IF NOT EXISTS idx_landmarks_category ON landmarks(category)`)
	dbSqlite.Exec(`CREATE INDEX IF NOT EXISTS idx_landmarks_price_min ON landmarks(price_min)`)
	dbSqlite.Exec(`CREATE INDEX IF NOT EXISTS idx_landmarks_price_max ON landmarks(price_max)`)
	dbSqlite.Exec(`CREATE INDEX IF NOT EXISTS idx_landmark_types_landmark ON landmark_types(landmark_id)`)
	dbSqlite.Exec(`CREATE INDEX IF NOT EXISTS idx_landmark_types_type ON landmark_types(type_id)`)

	// Geometry indexes (PostGIS)
	dbPostgres.Exec(`CREATE INDEX IF NOT EXISTS idx_landmark_gis_geom ON landmark_gis USING GIST (location)`)
	dbPostgres.Exec(`CREATE INDEX IF NOT EXISTS idx_accommodation_gis_geom ON accommodation_gis USING GIST (location)`)
	dbPostgres.Exec(`CREATE INDEX IF NOT EXISTS idx_restaurant_gis_geom ON restaurant_gis USING GIST (location)`)

	// Demo user
	hashedPassword, _ := HashPassword("123456")
	user := entity.User{
		Password:  hashedPassword,
		Firstname: "John",
		Lastname:  "Doe",
		Age:       30,
		Birthday:  time.Date(1993, 1, 1, 0, 0, 0, 0, time.UTC),
		Type:      "user",
	}
	dbSqlite.FirstOrCreate(&user, entity.User{Email: "a@gmail.com"})

	fmt.Println("✅ All tables migrated successfully")
}

// ------------------------------
// Price parser
// ------------------------------
var reDigits = regexp.MustCompile(`\d[\d,]*`)

func ParsePriceRange(s string) (int, int) {
	if s == "" {
		return 0, 0
	}
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
		if hasFree {
			return 0, 0
		}
		return 0, 0
	}

	minV, maxV := int(^uint(0)>>1), 0
	for _, ns := range nums {
		v := toInt(ns)
		if v < minV {
			minV = v
		}
		if v > maxV {
			maxV = v
		}
	}
	if minV == int(^uint(0)>>1) {
		minV = 0
	}
	if hasFree {
		if maxV == 0 {
			return 0, 0
		}
		return 0, maxV
	}
	if len(nums) == 1 {
		return maxV, maxV
	}
	if minV > maxV {
		minV, maxV = maxV, minV
	}
	return minV, maxV
}

// ------------------------------
// Excel -> Types helpers
// ------------------------------
func headerIndex(headers []string, candidates ...string) int {
	for i, h := range headers {
		hl := strings.ToLower(strings.TrimSpace(h))
		for _, c := range candidates {
			if hl == strings.ToLower(c) {
				return i
			}
		}
	}
	return -1
}

func splitTypes(s string) []string {
	if s == "" {
		return nil
	}
	repl := strings.NewReplacer("|", ",", "/", ",", "\\", ",", "、", ",", "，", ",", "；", ",", ";", ",", "\n", ",", " ", ",")
	s = repl.Replace(s)
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	seen := map[string]struct{}{}
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		lp := strings.ToLower(p)
		if _, ok := seen[lp]; ok {
			continue
		}
		seen[lp] = struct{}{}
		out = append(out, p)
	}
	return out
}

// Thai-friendly slug: ตัดช่องว่างหัวท้ายพอ
func slug(s string) string { return strings.TrimSpace(s) }

// ------------------------------
// Type upsert helpers
// ------------------------------
var typeCache = map[string]uint{} // key = kind + "|" + lower(code)

func upsertType(kind, name string) uint {
	code := slug(name)
	cacheKey := kind + "|" + strings.ToLower(code)
	if id, ok := typeCache[cacheKey]; ok {
		return id
	}

	var tt entity.TravelType
	// หาโดย (kind, code) ตาม composite-unique
	if err := dbSqlite.Where("kind = ? AND code = ?", kind, code).First(&tt).Error; err == nil {
		typeCache[cacheKey] = tt.ID
		return tt.ID
	}

	tt = entity.TravelType{Code: code, Name: name, Kind: kind}
	if err := dbSqlite.Create(&tt).Error; err != nil {
		// กัน race: ถ้าซ้ำเพราะ unique ให้ไป select ซ้ำ
		l := strings.ToLower(err.Error())
		if strings.Contains(l, "unique") || strings.Contains(l, "constraint") {
			if err2 := dbSqlite.Where("kind = ? AND code = ?", kind, code).First(&tt).Error; err2 == nil {
				typeCache[cacheKey] = tt.ID
				return tt.ID
			}
		}
		panic(err)
	}
	typeCache[cacheKey] = tt.ID
	return tt.ID
}

func linkLandmarkType(landmarkID uint, typeName string) {
	typeID := upsertType("landmark", typeName)
	dbSqlite.Create(&entity.LandmarkType{LandmarkID: landmarkID, TypeID: typeID})
}
func linkRestaurantType(rid uint, typeName string) {
	typeID := upsertType("restaurant", typeName)
	dbSqlite.Create(&entity.RestaurantType{RestaurantID: rid, TypeID: typeID})
}
func linkAccommodationType(aid uint, typeName string) {
	typeID := upsertType("accommodation", typeName)
	dbSqlite.Create(&entity.AccommodationType{AccommodationID: aid, TypeID: typeID})
}

// ------------------------------
// Sync types/pivots to Postgres (map ด้วย kind|code; ไม่ยิง First() ทีละแถว)
// ------------------------------
func syncTypesToPostgres() error {
	// กัน pivot เสียใน SQLite
	dbSqlite.Exec(`DELETE FROM landmark_types WHERE type_id IS NULL OR type_id = 0`)
	dbSqlite.Exec(`DELETE FROM restaurant_types WHERE type_id IS NULL OR type_id = 0`)
	dbSqlite.Exec(`DELETE FROM accommodation_types WHERE type_id IS NULL OR type_id = 0`)

	// ล้างตารางฝั่ง PG
	if err := dbPostgres.Exec(`TRUNCATE TABLE travel_types RESTART IDENTITY CASCADE`).Error; err != nil { return err }
	if err := dbPostgres.Exec(`TRUNCATE TABLE landmark_types RESTART IDENTITY CASCADE`).Error; err != nil { return err }
	if err := dbPostgres.Exec(`TRUNCATE TABLE restaurant_types RESTART IDENTITY CASCADE`).Error; err != nil { return err }
	if err := dbPostgres.Exec(`TRUNCATE TABLE accommodation_types RESTART IDENTITY CASCADE`).Error; err != nil { return err }

	// อ่าน types จาก SQLite
	var types []entity.TravelType
	if err := dbSqlite.Find(&types).Error; err != nil { return err }

	// map sqliteTypeID -> TravelType
	sqliteTypeByID := make(map[uint]entity.TravelType, len(types))
	for _, t := range types { sqliteTypeByID[t.ID] = t }

	// ใส่ type ลง PG (ให้ PG gen ID ใหม่)
	pgTypes := make([]entity.TravelType, 0, len(types))
	for _, t := range types {
		pgTypes = append(pgTypes, entity.TravelType{Code: t.Code, Name: t.Name, Kind: t.Kind})
	}
	if len(pgTypes) > 0 {
		if err := dbPostgres.CreateInBatches(&pgTypes, 1000).Error; err != nil { return err }
	}

	// map (kind|code) -> pgID
	var allPG []entity.TravelType
	if err := dbPostgres.Find(&allPG).Error; err != nil { return err }
	key := func(k, c string) string {
		return strings.ToLower(strings.TrimSpace(k)) + "|" + strings.ToLower(strings.TrimSpace(c))
	}
	idMap := map[string]uint{}
	for _, t := range allPG {
		idMap[key(t.Kind, t.Code)] = t.ID
	}

	// LandmarkType
	var lmPivot []entity.LandmarkType
	if err := dbSqlite.Find(&lmPivot).Error; err != nil { return err }
	pgLm := make([]entity.LandmarkType, 0, len(lmPivot))
	for _, p := range lmPivot {
		if p.TypeID == 0 { continue }
		if tt, ok := sqliteTypeByID[p.TypeID]; ok {
			if tid, ok2 := idMap[key(tt.Kind, tt.Code)]; ok2 {
				pgLm = append(pgLm, entity.LandmarkType{LandmarkID: p.LandmarkID, TypeID: tid})
			}
		}
	}
	if len(pgLm) > 0 {
		if err := dbPostgres.CreateInBatches(&pgLm, 1000).Error; err != nil { return err }
	}

	// RestaurantType
	var rsPivot []entity.RestaurantType
	if err := dbSqlite.Find(&rsPivot).Error; err != nil { return err }
	pgRs := make([]entity.RestaurantType, 0, len(rsPivot))
	for _, p := range rsPivot {
		if p.TypeID == 0 { continue }
		if tt, ok := sqliteTypeByID[p.TypeID]; ok {
			if tid, ok2 := idMap[key(tt.Kind, tt.Code)]; ok2 {
				pgRs = append(pgRs, entity.RestaurantType{RestaurantID: p.RestaurantID, TypeID: tid})
			}
		}
	}
	if len(pgRs) > 0 {
		if err := dbPostgres.CreateInBatches(&pgRs, 1000).Error; err != nil { return err }
	}

	// AccommodationType
	var accPivot []entity.AccommodationType
	if err := dbSqlite.Find(&accPivot).Error; err != nil { return err }
	pgAcc := make([]entity.AccommodationType, 0, len(accPivot))
	for _, p := range accPivot {
		if p.TypeID == 0 { continue }
		if tt, ok := sqliteTypeByID[p.TypeID]; ok {
			if tid, ok2 := idMap[key(tt.Kind, tt.Code)]; ok2 {
				pgAcc = append(pgAcc, entity.AccommodationType{AccommodationID: p.AccommodationID, TypeID: tid})
			}
		}
	}
	if len(pgAcc) > 0 {
		if err := dbPostgres.CreateInBatches(&pgAcc, 1000).Error; err != nil { return err }
	}

	// indexes ฝั่ง PG (เงียบอยู่แล้วถ้ามี)
	dbPostgres.Exec(`CREATE INDEX IF NOT EXISTS idx_travel_types_kind_name ON public.travel_types(kind, name)`)
	dbPostgres.Exec(`CREATE INDEX IF NOT EXISTS idx_landmark_types_type ON public.landmark_types(type_id)`)
	dbPostgres.Exec(`CREATE INDEX IF NOT EXISTS idx_landmark_types_landmark ON public.landmark_types(landmark_id)`)

	return nil
}

// ------------------------------
// Public entry
// ------------------------------
func LoadExcelData(db *gorm.DB) {
	loadAccommodations(db)
	loadLandmarks(db)
	loadRestaurants(db)
	loadAccommodationGIS()
	loadLandmarkGIS()
	loadRestaurantGIS()

	if err := syncTypesToPostgres(); err != nil {
		panic(fmt.Errorf("sync types to Postgres failed: %w", err))
	}
}

// ------------------------------
// Accommodation loader
// ------------------------------
func loadAccommodations(db *gorm.DB) {
	f, err := excelize.OpenFile("config/places_data_3.xlsx")
	if err != nil { panic(err) }
	rows, err := f.GetRows("Sheet1")
	if err != nil || len(rows) == 0 { panic(err) }

	header := rows[0]
	idxType := headerIndex(header, "type", "Type", "ประเภท")

	for i, row := range rows {
		if i == 0 || len(row) < 19 { continue }
		lat, _ := strconv.ParseFloat(row[3], 32)
		lon, _ := strconv.ParseFloat(row[4], 32)
		place, _ := strconv.Atoi(row[0])

		priceRaw := row[17]
		totalPeopleRaw := row[18]
		pmin, pmax := ParsePriceRange(priceRaw)

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
			Total_people: totalPeopleRaw,
			Price:        priceRaw,
			Review:       0,
			PriceMin:     pmin,
			PriceMax:     pmax,
		}
		db.Create(&data)

		if idxType >= 0 && idxType < len(row) {
			for _, t := range splitTypes(row[idxType]) {
				linkAccommodationType(data.ID, t)
			}
		}
	}
	fmt.Println("Accommodation data loaded successfully ✅")
}

// ------------------------------
// Landmark loader
// ------------------------------
func loadLandmarks(db *gorm.DB) {
	f, err := excelize.OpenFile("config/Attraction_data_4.xlsx")
	if err != nil { panic(err) }
	rows, err := f.GetRows("Sheet1")
	if err != nil || len(rows) == 0 { panic(err) }

	header := rows[0]
	idxType := headerIndex(header, "type", "Type", "ประเภท")

	for i, row := range rows {
		if i == 0 || len(row) < 22 { continue }
		lat, _ := strconv.ParseFloat(row[3], 32)
		lon, _ := strconv.ParseFloat(row[4], 32)
		place, _ := strconv.Atoi(row[0])

		priceRaw := row[20]
		totalPeopleRaw := row[21]
		pmin, pmax := ParsePriceRange(priceRaw)

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
			Total_people: totalPeopleRaw,
			Price:        priceRaw,
			Review:       0,
			PriceMin:     pmin,
			PriceMax:     pmax,
		}
		db.Create(&data)

		if idxType >= 0 && idxType < len(row) {
			for _, t := range splitTypes(row[idxType]) {
				linkLandmarkType(data.ID, t)
			}
		}
	}
	fmt.Println("Landmark data loaded successfully ✅")
}

// ------------------------------
// Restaurant loader
// ------------------------------
func loadRestaurants(db *gorm.DB) {
	f, err := excelize.OpenFile("config/rharn.xlsx")
	if err != nil { panic(err) }
	rows, err := f.GetRows("Sheet1")
	if err != nil || len(rows) == 0 { panic(err) }

	header := rows[0]
	idxType := headerIndex(header, "type", "Type", "ประเภท")

	for i, row := range rows {
		if i == 0 || len(row) < 18 { continue }
		lat, _ := strconv.ParseFloat(row[3], 32)
		lon, _ := strconv.ParseFloat(row[4], 32)
		place, _ := strconv.Atoi(row[0])

		priceRaw := row[17] // "฿60-150/คน"
		totalPeopleRaw := row[16]
		pmin, pmax := ParsePriceRange(priceRaw)

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
			Total_people: totalPeopleRaw,
			Price:        priceRaw,
			Review:       0,
			PriceMin:     pmin,
			PriceMax:     pmax,
		}
		db.Create(&data)

		if idxType >= 0 && idxType < len(row) {
			for _, t := range splitTypes(row[idxType]) {
				linkRestaurantType(data.ID, t)
			}
		}
	}
	fmt.Println("Restaurant data loaded successfully ✅")
}

// ------------------------------
// GIS loaders
// ------------------------------
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
	if tableExists("accommodation_gis") {
		dbPostgres.Exec("TRUNCATE TABLE accommodation_gis RESTART IDENTITY CASCADE")
	}
	var accommodations []entity.Accommodation
	dbSqlite.Find(&accommodations)
	for _, acc := range accommodations {
		location := fmt.Sprintf("SRID=4326;POINT(%f %f)", acc.Lon, acc.Lat)
		gis := entity.AccommodationGis{Acc_ID: acc.ID, Location: location}
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
		gis := entity.LandmarkGis{LandmarkID: lm.ID, Location: location}
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
		gis := entity.RestaurantGis{RestaurantID: r.ID, Location: location}
		dbPostgres.Create(&gis)
	}
	fmt.Println("✅ Restaurant GIS data reloaded")
}
