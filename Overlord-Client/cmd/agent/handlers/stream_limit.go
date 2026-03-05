package handlers

import (
	"log"
	"os"
	"strconv"
	"strings"
	"time"
)

func streamInterval(envVar string, defFPS int) (time.Duration, int) {
	fps := defFPS
	raw := strings.TrimSpace(os.Getenv(envVar))
	if raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			fps = v
		} else {
			log.Printf("stream: invalid %s=%q, using %d", envVar, raw, defFPS)
		}
	}
	if fps < 1 {
		fps = 1
	}
	if fps > 120 {
		fps = 120
	}
	return time.Second / time.Duration(fps), fps
}
