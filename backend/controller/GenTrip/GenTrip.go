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
	Start           string         `json:"start"`
	StartName       string         `json:"start_name"`
	TripPlanByDay   []DayPlan      `json:"trip_plan_by_day"`
	Paths           []PathInfo     `json:"paths"`
	TotalDistanceKm float64        `json:"total_distance_km"`
	Accommodation   *Accommodation `json:"accommodation,omitempty"`
	Message         string         `json:"message"`
	Error           string         `json:"error,omitempty"`

	TotalBudget  int `json:"total_budget"`
	BudgetPerDay int `json:"budget_per_day"`

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

    budgetStr := c.DefaultQuery("budget", "0")
    if _, err := strconv.Atoi(budgetStr); err != nil {
        c.JSON(http.StatusBadRequest, gin.H{"error": "budget ต้องเป็นจำนวนเต็มไม่ติดลบ"})
        return
    }

    // ตัวเลือกขั้นสูง
    distance := c.DefaultQuery("distance", "4000")
    k := c.DefaultQuery("k", "20")
    kMst := c.DefaultQuery("k_mst", "20")
    mode := c.DefaultQuery("mode", "penalize")
    penalty := c.DefaultQuery("penalty", "1.3")
    useBoykov := c.DefaultQuery("use_boykov", "1")

    // ใหม่: preferences (รองรับไทย) + weights (optional)
    prefer := c.DefaultQuery("prefer", "")
    prefer2 := c.DefaultQuery("prefer2", "")
    prefer3 := c.DefaultQuery("prefer3", "")
    w1 := c.DefaultQuery("w1", "")
    w2 := c.DefaultQuery("w2", "")
    w3 := c.DefaultQuery("w3", "")

    // ✅ ใหม่: n_top สำหรับ auto-zone Top-N ที่ฝั่ง /mst/byflow
    nTop := c.DefaultQuery("n_top", "40")

    // ส่งอาร์กิวเมนต์ไป Python (เพิ่ม n_top เป็น argv[16])
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
        budgetStr, // argv[9]
        prefer,    // argv[10]
        prefer2,   // argv[11]
        prefer3,   // argv[12]
        w1,        // argv[13]
        w2,        // argv[14]
        w3,        // argv[15]
        nTop,      // argv[16]  <<== เพิ่มตัวนี้
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
