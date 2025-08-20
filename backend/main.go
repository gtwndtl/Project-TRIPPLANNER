package main

import (
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"

	"github.com/gtwndtl/trip-spark-builder/config"
	"github.com/gtwndtl/trip-spark-builder/controller/Accommodation"
	"github.com/gtwndtl/trip-spark-builder/controller/Condition"
	"github.com/gtwndtl/trip-spark-builder/controller/Distance"
	"github.com/gtwndtl/trip-spark-builder/controller/Forgetpassword"
	"github.com/gtwndtl/trip-spark-builder/controller/GenTrip"
	"github.com/gtwndtl/trip-spark-builder/controller/GroqApi"
	"github.com/gtwndtl/trip-spark-builder/controller/Landmark"
	"github.com/gtwndtl/trip-spark-builder/controller/Restaurant"
	"github.com/gtwndtl/trip-spark-builder/controller/Shortestpath"
	"github.com/gtwndtl/trip-spark-builder/controller/Trips"
	"github.com/gtwndtl/trip-spark-builder/controller/User"
	"github.com/gtwndtl/trip-spark-builder/controller/Review"
	"github.com/gtwndtl/trip-spark-builder/controller/Recommend"

	"github.com/gtwndtl/trip-spark-builder/middlewares"
)

func main() {
	// Database setup
	config.ConnectionDB()
	config.SetupDatabase()
	config.LoadExcelData(config.DB())
	
	db := config.DB()
	postgresDB := config.PGDB()
	r := gin.Default()

	// (ถ้าต้องการเปิด CORS ให้เปิด comment ตามที่ตั้งใจไว้)
	r.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:5173"}, // เปลี่ยนให้ตรงกับ origin frontend
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	// Controller instances
	accommodationCtrl := Accommodation.NewAccommodationController(db, postgresDB)
	conditionCtrl := Condition.NewConditionController(db)
	landmarkCtrl := Landmark.NewLandmarkController(db, postgresDB)
	restaurantCtrl := Restaurant.NewRestaurantController(db, postgresDB)
	userCtrl := User.NewUserController(db)
	distanceCtrl := &Distance.DistanceController{MysqlDB: db, PostgisDB: postgresDB,}
	tripsCtrl := Trips.NewTripsController(db)
	shortestpathCtrl := Shortestpath.NewShortestPathController(db, postgresDB)
	routeCtrl := &GenTrip.RouteController{}
	reviewCtrl := Review.ReviewController{DB: db}
	recommendCtrl := Recommend.RecommendController{DB: db}
	
	// Public routes (ไม่ต้องตรวจสอบ token)
	r.POST("/signinuser", userCtrl.SignInUser)

	// 👉 ForgetPassword routes (เขียนตรงๆ)
	r.POST("/send-otp", Forgetpassword.SendOTPHandler)
	r.POST("/verify-otp", Forgetpassword.VerifyOTPHandler)

	// สร้าง group สำหรับ route ที่ต้องตรวจสอบ token (AuthMiddleware)
	authorized := r.Group("/")
	authorized.Use(middlewares.AuthMiddleware())

	// Accommodation routes (ต้องล็อกอิน)
	authorized.POST("/accommodations", accommodationCtrl.Create)
	r.GET("/accommodations", accommodationCtrl.GetAll)
	authorized.GET("/accommodations/:id", accommodationCtrl.GetByID)
	authorized.PUT("/accommodations/:id", accommodationCtrl.Update)
	authorized.DELETE("/accommodations/:id", accommodationCtrl.Delete)

	// Condition routes
	r.POST("/conditions", conditionCtrl.Create)
	r.GET("/conditions", conditionCtrl.GetAll)
	r.GET("/conditions/:id", conditionCtrl.GetByID)
	r.PUT("/conditions/:id", conditionCtrl.Update)
	r.DELETE("/conditions/:id", conditionCtrl.Delete)

	// Landmark routes
	authorized.POST("/landmarks", landmarkCtrl.Create)
	r.GET("/landmarks", landmarkCtrl.GetAll)
	authorized.GET("/landmarks/:id", landmarkCtrl.GetByID)
	authorized.PUT("/landmarks/:id", landmarkCtrl.Update)
	authorized.DELETE("/landmarks/:id", landmarkCtrl.Delete)

	// Restaurant routes
	authorized.POST("/restaurants", restaurantCtrl.Create)
	r.GET("/restaurants", restaurantCtrl.GetAll)
	authorized.GET("/restaurants/:id", restaurantCtrl.GetByID)
	authorized.PUT("/restaurants/:id", restaurantCtrl.Update)
	authorized.DELETE("/restaurants/:id", restaurantCtrl.Delete)

	// User routes (ยกเว้นสร้าง user และ login ที่ public)
	r.GET("/users", userCtrl.GetAllUsers)
	authorized.GET("/users/:id", userCtrl.GetUserByID)
	authorized.PUT("/users/:id", userCtrl.UpdateUser)
	authorized.DELETE("/users/:id", userCtrl.DeleteUser)
	r.POST("/users", userCtrl.CreateUser) // ถ้าต้องการให้สร้าง user ต้องล็อกอินก่อน ถ้าไม่ก็เอาไว้ public ก็ได้
	authorized.PUT("/users/me/password", userCtrl.ChangePassword)


	// Trips routes
	r.POST("/trips", tripsCtrl.CreateTrip)
	authorized.GET("/trips", tripsCtrl.GetAllTrips)
	r.GET("/trips/:id", tripsCtrl.GetTripByID)
	authorized.PUT("/trips/:id", tripsCtrl.UpdateTrip)
	authorized.DELETE("/trips/:id", tripsCtrl.DeleteTrip)
	r.POST("/trips/:id/export", tripsCtrl.ExportTripToTemplate)

	// Shortest Path routes
	r.POST("/shortest-paths", shortestpathCtrl.CreateShortestPath)
	r.GET("/shortest-paths", shortestpathCtrl.GetAllShortestPaths)
	r.GET("/shortest-paths/:id", shortestpathCtrl.GetShortestPathByID)
	r.PUT("/shortest-paths/:id", shortestpathCtrl.UpdateShortestPath)
	r.DELETE("/shortest-paths/:id", shortestpathCtrl.DeleteShortestPath)
	r.PUT("/shortest-paths/accommodation/bulk", shortestpathCtrl.BulkUpdateAccommodation)

	r.GET("/distances", distanceCtrl.GetDistances)
	r.GET("/mst", distanceCtrl.GetMST)
    r.GET("/gen-route", routeCtrl.GenerateRoute)
	r.POST("/api/groq", GroqApi.PostGroq)
	r.GET("/suggest", distanceCtrl.SuggestPlaces)
	r.GET("/suggest/accommodations", distanceCtrl.SuggestAccommodations)

	// 👉 Review routes
	r.POST("/reviews", reviewCtrl.Create)
	r.GET("/reviews", reviewCtrl.GetAll)
	r.GET("/reviews/:id", reviewCtrl.GetByID)
	r.PUT("/reviews/:id", reviewCtrl.Update)
	r.DELETE("/reviews/:id", reviewCtrl.Delete)

	// 👉 Recommend routes
	r.POST("/recommends", recommendCtrl.Create)
	r.GET("/recommends", recommendCtrl.GetAll)
	r.GET("/recommends/:id", recommendCtrl.GetByID)
	r.PUT("/recommends/:id", recommendCtrl.Update)
	r.DELETE("/recommends/:id", recommendCtrl.Delete)
	
	// Run server
	r.Run(":8080")
}

// r.Use(cors.New(cors.Config{
	// 	AllowOrigins:     []string{"http://localhost:5173"}, // เปลี่ยนให้ตรงกับ origin frontend
	// 	AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
	// 	AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
	// 	ExposeHeaders:    []string{"Content-Length"},
	// 	AllowCredentials: true,
	// 	MaxAge:           12 * time.Hour,
	// }))

