package plugins

import (
	"strings"
	"testing"
)

func TestManifestFromMapRejectsWASM(t *testing.T) {
	for _, manifest := range []map[string]interface{}{
		{"id": "demo", "runtime": "wasm"},
		{"id": "demo", "wasm": "demo.wasm"},
	} {
		_, err := ManifestFromMap(manifest)
		if err == nil || !strings.Contains(err.Error(), "not supported") {
			t.Fatalf("expected unsupported runtime error, got %v", err)
		}
	}
}

func TestManifestFromMapAcceptsNative(t *testing.T) {
	manifest, err := ManifestFromMap(map[string]interface{}{
		"id":      "demo",
		"name":    "Demo",
		"runtime": "native",
	})
	if err != nil {
		t.Fatalf("expected native manifest to be accepted: %v", err)
	}
	if manifest.RuntimeKind != "native" {
		t.Fatalf("expected native runtime, got %q", manifest.RuntimeKind)
	}
}
