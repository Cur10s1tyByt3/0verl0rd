package plugins

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"sync"

	"overlord-client/cmd/agent/wire"
)

type Manager struct {
	mu      sync.Mutex
	plugins map[string]*pluginInstance
	pending map[string]*pendingBundle
	writer  wire.Writer
	host    HostInfo
}

type pluginInstance struct {
	id       string
	manifest PluginManifest
	native   NativePlugin
}

type pendingBundle struct {
	manifest    PluginManifest
	totalSize   int
	totalChunks int
	chunks      map[int][]byte
	received    int
	receivedSz  int
}

func NewManager(writer wire.Writer, host HostInfo) *Manager {
	return &Manager{
		plugins: make(map[string]*pluginInstance),
		pending: make(map[string]*pendingBundle),
		writer:  writer,
		host:    host,
	}
}

func (m *Manager) StartBundle(manifest PluginManifest, totalSize int, totalChunks int) error {
	if manifest.ID == "" {
		return errors.New("missing plugin id")
	}
	if totalChunks <= 0 {
		return errors.New("invalid total chunks")
	}
	if totalSize <= 0 {
		return errors.New("invalid total size")
	}
	if totalChunks > 10000 {
		return errors.New("too many chunks")
	}

	m.mu.Lock()
	m.pending[manifest.ID] = &pendingBundle{
		manifest:    manifest,
		totalSize:   totalSize,
		totalChunks: totalChunks,
		chunks:      make(map[int][]byte),
	}
	m.mu.Unlock()
	return nil
}

func (m *Manager) AddChunk(pluginId string, index int, data []byte) error {
	if pluginId == "" {
		return errors.New("missing plugin id")
	}
	if index < 0 {
		return errors.New("invalid chunk index")
	}

	m.mu.Lock()
	b := m.pending[pluginId]
	if b == nil {
		m.mu.Unlock()
		return errors.New("bundle not initialized")
	}
	if _, exists := b.chunks[index]; !exists {
		b.chunks[index] = data
		b.received++
		b.receivedSz += len(data)
	}
	m.mu.Unlock()
	return nil
}

func (m *Manager) FinalizeBundle(ctx context.Context, pluginId string) error {
	m.mu.Lock()
	b := m.pending[pluginId]
	if b == nil {
		m.mu.Unlock()
		return errors.New("bundle not initialized")
	}
	if b.received < b.totalChunks {
		m.mu.Unlock()
		return errors.New("bundle incomplete")
	}

	chunks := make([][]byte, b.totalChunks)
	for i := 0; i < b.totalChunks; i++ {
		chunks[i] = b.chunks[i]
		if chunks[i] == nil {
			m.mu.Unlock()
			return errors.New("missing chunk")
		}
	}
	manifest := b.manifest
	delete(m.pending, pluginId)
	m.mu.Unlock()

	combined := make([]byte, 0, b.totalSize)
	for _, part := range chunks {
		combined = append(combined, part...)
	}
	return m.Load(ctx, manifest, combined)
}

func (m *Manager) Load(ctx context.Context, manifest PluginManifest, binary []byte) error {
	if len(binary) == 0 {
		return errors.New("empty plugin binary")
	}
	pluginID := manifest.ID
	if pluginID == "" {
		return errors.New("missing plugin id")
	}

	m.mu.Lock()
	if existing, ok := m.plugins[pluginID]; ok {
		existing.native.Close()
		delete(m.plugins, pluginID)
	}
	m.mu.Unlock()

	np, err := loadNativePlugin(binary)
	if err != nil {
		return err
	}

	pi := &pluginInstance{
		id:       pluginID,
		manifest: manifest,
		native:   np,
	}

	send := func(event string, payload []byte) {
		var payloadVal interface{}
		if len(payload) > 0 {
			var parsed interface{}
			if json.Unmarshal(payload, &parsed) == nil {
				payloadVal = parsed
			} else {
				payloadVal = string(payload)
			}
		}
		err := wire.WriteMsg(context.Background(), m.writer, wire.PluginEvent{
			Type:     "plugin_event",
			PluginID: pluginID,
			Event:    event,
			Payload:  payloadVal,
		})
		if err != nil {
			log.Printf("[plugin] %s send event error: %v", pluginID, err)
		}
	}

	hostJSON, err := json.Marshal(m.host)
	if err != nil {
		np.Close()
		return err
	}

	if err := np.Load(send, hostJSON); err != nil {
		np.Close()
		return err
	}

	m.mu.Lock()
	m.plugins[pluginID] = pi
	m.mu.Unlock()

	rt := np.Runtime()
	freeable := rt != "go"
	log.Printf("[plugin] loaded %s (native, runtime=%s, freeable=%v)", pluginID, rt, freeable)
	return nil
}

func (m *Manager) Dispatch(ctx context.Context, pluginId, event string, payload interface{}) error {
	m.mu.Lock()
	pi := m.plugins[pluginId]
	m.mu.Unlock()
	if pi == nil {
		return nil
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return pi.native.Event(event, data)
}

func (m *Manager) Close() {
	m.mu.Lock()
	defer m.mu.Unlock()
	for id, pi := range m.plugins {
		rt := pi.native.Runtime()
		pi.native.Close()
		delete(m.plugins, id)
		if rt != "go" {
			log.Printf("[plugin] unloaded %s (runtime=%s, memory freed)", id, rt)
		} else {
			log.Printf("[plugin] unloaded %s (runtime=go, memory leaked — see golang/go#11100)", id)
		}
	}
}

func (m *Manager) Unload(pluginId string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if pi, ok := m.plugins[pluginId]; ok {
		rt := pi.native.Runtime()
		pi.native.Close()
		delete(m.plugins, pluginId)
		if rt != "go" {
			log.Printf("[plugin] unloaded %s (runtime=%s, memory freed)", pluginId, rt)
		} else {
			log.Printf("[plugin] unloaded %s (runtime=go, memory leaked — see golang/go#11100)", pluginId)
		}
	}
}
