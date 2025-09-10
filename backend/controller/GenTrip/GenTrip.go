package GenTrip

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"strconv"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type RouteController struct {
	DB *gorm.DB
}

type PythonResult struct {
	Start           string          `json:"start"`
	StartName       string          `json:"start_name"`
	TripPlanByDay   []DayPlan       `json:"trip_plan_by_day"`
	Paths           []PathInfo      `json:"paths"`
	TotalDistanceKm float64         `json:"total_distance_km"`
	Accommodation   *Accommodation  `json:"accommodation,omitempty"`
	Message         string          `json:"message"`
	Error           string          `json:"error,omitempty"`

	TotalBudget  int `json:"total_budget"`
	BudgetPerDay int `json:"budget_per_day"`

	// ค่าใช้จ่ายจริงจาก Python
	Spend Spend `json:"spend"`
}

type Spend struct {
	PerDay    []DaySpend `json:"per_day"`
	Total     int        `json:"total"`
	Breakdown Breakdown  `json:"breakdown"`
}

type DaySpend struct {
	Day         int `json:"day"`
	Hotel       int `json:"hotel"`
	Meals       int `json:"meals"`
	Attractions int `json:"attractions"`
	Total       int `json:"total"`
}

type Breakdown struct {
	Hotel       int `json:"hotel"`
	Meals       int `json:"meals"`
	Attractions int `json:"attractions"`
}

type DayPlan struct {
	Day    int         `json:"day"`
	Plan   []PlaceInfo `json:"plan"`
	Budget struct {
		PerDay      int `json:"per_day"`
		Hotel       int `json:"hotel"`
		MealEach    int `json:"meal_each"`
		Attractions int `json:"attractions"`
	} `json:"budget"`
}

type PlaceInfo struct {
	ID   string  `json:"id"`
	Name string  `json:"name"`
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
}

type PathInfo struct {
	From       string  `json:"from"`
	FromName   string  `json:"from_name"`
	FromLat    float64 `json:"from_lat"`
	FromLon    float64 `json:"from_lon"`
	To         string  `json:"to"`
	ToName     string  `json:"to_name"`
	ToLat      float64 `json:"to_lat"`
	ToLon      float64 `json:"to_lon"`
	DistanceKm float64 `json:"distance_km"`
	Day        int     `json:"day,omitempty"`
}

type Accommodation struct {
	ID   string  `json:"id"`
	Name string  `json:"name"`
	Lat  float64 `json:"lat"`
	Lon  float64 `json:"lon"`
}

func (rc *RouteController) GenerateRoute(c *gin.Context) {
	startNode := c.Query("start")
	if startNode == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "กรุณาระบุ start ผ่าน query parameters"})
		return
	}

	daysStr := c.DefaultQuery("days", "1")
	days, err := strconv.Atoi(daysStr)
	if err != nil || days < 1 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "days ต้องเป็นจำนวนเต็มบวก"})
		return
	}

	// รับงบทั้งทริป (บาท) จากผู้ใช้
	budgetStr := c.DefaultQuery("budget", "0")
	if _, err := strconv.Atoi(budgetStr); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "budget ต้องเป็นจำนวนเต็มไม่ติดลบ"})
		return
	}

	// ตัวเลือกขั้นสูง (optional)
	distance := c.DefaultQuery("distance", "4000")
	k := c.DefaultQuery("k", "20")
	kMst := c.DefaultQuery("k_mst", "20")
	mode := c.DefaultQuery("mode", "penalize")     // penalize|exclude
	penalty := c.DefaultQuery("penalty", "1.3")    // float
	useBoykov := c.DefaultQuery("use_boykov", "1") // 1=true, 0=false

	// ส่ง args ให้ Code.py
	args := []string{
		"Code.py",
		startNode,
		daysStr,
		distance,
		k,
		kMst,
		mode,
		penalty,
		useBoykov,
		budgetStr, // งบรวม
	}

	cmd := exec.Command("python", args...)

	var outBuf, errBuf bytes.Buffer
	cmd.Stdout = &outBuf
	cmd.Stderr = &errBuf

	if err := cmd.Run(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": fmt.Sprintf("เรียก Python ล้มเหลว: %s, stderr: %s", err.Error(), errBuf.String()),
		})
		return
	}

	output := outBuf.Bytes()
	if len(output) == 0 {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": fmt.Sprintf("ไม่ได้รับผลลัพธ์จาก Python เลย\nstderr: %s", errBuf.String()),
		})
		return
	}

	var pyResult PythonResult
	if err := json.Unmarshal(output, &pyResult); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": fmt.Sprintf("แปลงผลลัพธ์จาก Python ไม่ได้: %s\nstdout: %s\nstderr: %s",
				err.Error(), string(output), errBuf.String()),
		})
		return
	}

	if pyResult.Error != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": pyResult.Error})
		return
	}

	c.JSON(http.StatusOK, pyResult)
}
