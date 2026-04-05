package plugins

import "errors"

type PluginAssets struct {
	HTML string `msgpack:"html" json:"html"`
	CSS  string `msgpack:"css" json:"css"`
	JS   string `msgpack:"js" json:"js"`
}

type PluginManifest struct {
	ID          string            `msgpack:"id" json:"id"`
	Name        string            `msgpack:"name" json:"name"`
	Version     string            `msgpack:"version,omitempty" json:"version,omitempty"`
	Description string            `msgpack:"description,omitempty" json:"description,omitempty"`
	Binary      string            `msgpack:"binary,omitempty" json:"binary,omitempty"`
	Binaries    map[string]string `msgpack:"binaries,omitempty" json:"binaries,omitempty"`
	Entry       string            `msgpack:"entry,omitempty" json:"entry,omitempty"`
	Assets      PluginAssets      `msgpack:"assets,omitempty" json:"assets,omitempty"`
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

type NativePlugin interface {
	Load(send func(event string, payload []byte), hostInfo []byte) error

	Event(event string, payload []byte) error

	Unload()

	Close() error

	Runtime() string
}

func ManifestFromMap(m map[string]interface{}) (PluginManifest, error) {
	manifest := PluginManifest{}
	manifest.ID = stringVal(m["id"])
	manifest.Name = stringVal(m["name"])
	manifest.Version = stringVal(m["version"])
	manifest.Description = stringVal(m["description"])
	manifest.Binary = stringVal(m["binary"])
	manifest.Entry = stringVal(m["entry"])

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
