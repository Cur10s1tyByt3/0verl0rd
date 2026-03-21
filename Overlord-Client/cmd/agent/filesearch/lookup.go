package filesearch

import (
	"os"
	"path/filepath"
	"strings"
	"sync"
)

var SkipDirs = map[string]bool{
	"$recycle.bin":              true,
	"windows":                   true,
	"system volume information": true,
}

type ResultFunc func(path string)

func LookupExe(exeName string, workers int, onResult ResultFunc) {
	if workers <= 0 {
		workers = 8
	}
	lowerExe := strings.ToLower(exeName)
	roots := driveRoots()

	dirs := make(chan string, 256)

	var inflight sync.WaitGroup

	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for dir := range dirs {
				walkDir(dir, lowerExe, dirs, &inflight, onResult)
				inflight.Done()
			}
		}()
	}

	for _, root := range roots {
		entries, err := os.ReadDir(root)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() {
				if SkipDirs[strings.ToLower(e.Name())] {
					continue
				}
				inflight.Add(1)
				dirs <- filepath.Join(root, e.Name())
			} else if strings.ToLower(e.Name()) == lowerExe {
				onResult(filepath.Join(root, e.Name()))
			}
		}
	}

	go func() {
		inflight.Wait()
		close(dirs)
	}()

	wg.Wait()
}

func walkDir(root, lowerExe string, dirs chan<- string, inflight *sync.WaitGroup, onResult ResultFunc) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	for _, e := range entries {
		full := filepath.Join(root, e.Name())
		if e.IsDir() {
			if SkipDirs[strings.ToLower(e.Name())] {
				continue
			}
			inflight.Add(1)
			select {
			case dirs <- full:
			default:
				inflight.Done()
				walkDir(full, lowerExe, dirs, inflight, onResult)
			}
		} else if strings.ToLower(e.Name()) == lowerExe {
			onResult(full)
		}
	}
}

func driveRoots() []string {
	if os.PathSeparator == '\\' {
		var roots []string
		for c := 'A'; c <= 'Z'; c++ {
			root := string(c) + ":\\"
			if info, err := os.Stat(root); err == nil && info.IsDir() {
				roots = append(roots, root)
			}
		}
		if len(roots) == 0 {
			roots = append(roots, "C:\\")
		}
		return roots
	}
	return []string{"/"}
}
