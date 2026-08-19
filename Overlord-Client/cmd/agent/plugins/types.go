package plugins

import (
	"errors"
	"strings"
)

type PluginAssets struct {
	HTML string `msgpack:"html" json:"html"`
	CSS  string `msgpack:"css" json:"css"`
	JS   string `msgpack:"js" json:"js"`
}

type PluginManifest struct {
	ID                string            `msgpack:"id" json:"id"`
	Name              string            `msgpack:"name" json:"name"`
	APIVersion        int               `msgpack:"apiVersion,omitempty" json:"apiVersion,omitempty"`
	RuntimeKind       string            `msgpack:"runtime,omitempty" json:"runtime,omitempty"`
	NativeLoader      string            `msgpack:"nativeLoader,omitempty" json:"nativeLoader,omitempty"`
	NativeEntrypoints NativeEntrypoints `msgpack:"nativeEntrypoints,omitempty" json:"nativeEntrypoints,omitempty"`
	Version           string            `msgpack:"version,omitempty" json:"version,omitempty"`
	Description       string            `msgpack:"description,omitempty" json:"description,omitempty"`
	Binary            string            `msgpack:"binary,omitempty" json:"binary,omitempty"`
	Binaries          map[string]string `msgpack:"binaries,omitempty" json:"binaries,omitempty"`
	Entry             string            `msgpack:"entry,omitempty" json:"entry,omitempty"`
	Assets            PluginAssets      `msgpack:"assets,omitempty" json:"assets,omitempty"`
}

type NativeEntrypoints struct {
	OnLoad      string `msgpack:"onLoad,omitempty" json:"onLoad,omitempty"`
	OnEvent     string `msgpack:"onEvent,omitempty" json:"onEvent,omitempty"`
	OnUnload    string `msgpack:"onUnload,omitempty" json:"onUnload,omitempty"`
	SetCallback string `msgpack:"setCallback,omitempty" json:"setCallback,omitempty"`
	GetRuntime  string `msgpack:"getRuntime,omitempty" json:"getRuntime,omitempty"`
}

type PluginMessage struct {
	Type    string      `msgpack:"type"`
	Event   string      `msgpack:"event,omitempty"`
	Payload interface{} `msgpack:"payload,omitempty"`
	Error   string      `msgpack:"error,omitempty"`
}

type HostInfo struct {
	ClientID string `msgpack:"clientId" json:"clientId"`
	OS       string `msgpack:"os" json:"os"`
	Arch     string `msgpack:"arch" json:"arch"`
	Version  string `msgpack:"version" json:"version"`
}

type PluginRuntime interface {
	Load(send func(event string, payload []byte), hostInfo []byte) error

	Event(event string, payload []byte) error

	Unload()

	Close() error

	Runtime() string
}

type NativePlugin = PluginRuntime

func ManifestFromMap(m map[string]interface{}) (PluginManifest, error) {
	if runtime := stringVal(m["runtime"]); strings.EqualFold(strings.TrimSpace(runtime), "wasm") || strings.TrimSpace(stringVal(m["wasm"])) != "" {
		return PluginManifest{}, errors.New("WASM plugins are not supported")
	}

	manifest := PluginManifest{}
	manifest.ID = stringVal(m["id"])
	manifest.Name = stringVal(m["name"])
	manifest.APIVersion = intVal(m["apiVersion"])
	manifest.RuntimeKind = stringVal(m["runtime"])
	manifest.NativeLoader = stringVal(m["nativeLoader"])
	manifest.Version = stringVal(m["version"])
	manifest.Description = stringVal(m["description"])
	manifest.Binary = stringVal(m["binary"])
	manifest.Entry = stringVal(m["entry"])
	if entryRaw, ok := m["nativeEntrypoints"].(map[string]interface{}); ok {
		manifest.NativeEntrypoints = NativeEntrypoints{
			OnLoad:      stringVal(entryRaw["onLoad"]),
			OnEvent:     stringVal(entryRaw["onEvent"]),
			OnUnload:    stringVal(entryRaw["onUnload"]),
			SetCallback: stringVal(entryRaw["setCallback"]),
			GetRuntime:  stringVal(entryRaw["getRuntime"]),
		}
	}

	if binariesRaw, ok := m["binaries"].(map[string]interface{}); ok {
		manifest.Binaries = make(map[string]string, len(binariesRaw))
		for k, v := range binariesRaw {
			if s, ok := v.(string); ok {
				manifest.Binaries[k] = s
			}
		}
	}

	if assetsRaw, ok := m["assets"].(map[string]interface{}); ok {
		manifest.Assets = PluginAssets{
			HTML: stringVal(assetsRaw["html"]),
			CSS:  stringVal(assetsRaw["css"]),
			JS:   stringVal(assetsRaw["js"]),
		}
	}
	if manifest.ID == "" {
		return PluginManifest{}, errors.New("missing plugin id")
	}
	if manifest.Name == "" {
		manifest.Name = manifest.ID
	}
	return manifest, nil
}

func stringVal(v interface{}) string {
	s, _ := v.(string)
	return s
}

func intVal(v interface{}) int {
	switch n := v.(type) {
	case int:
		return n
	case int8:
		return int(n)
	case int16:
		return int(n)
	case int32:
		return int(n)
	case int64:
		return int(n)
	case uint:
		return int(n)
	case uint8:
		return int(n)
	case uint16:
		return int(n)
	case uint32:
		return int(n)
	case uint64:
		return int(n)
	case float32:
		return int(n)
	case float64:
		return int(n)
	default:
		return 0
	}
}
