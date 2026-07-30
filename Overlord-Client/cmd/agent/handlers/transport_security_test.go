package handlers

import (
	"strings"
	"testing"

	"overlord-client/cmd/agent/config"
	agentRuntime "overlord-client/cmd/agent/runtime"
)

func TestSensitiveTransfersRejectPlaintextByDefault(t *testing.T) {
	env := &agentRuntime.Env{Cfg: config.Config{
		ServerURLs: []string{"ws://server.example.test:5173"},
	}}

	if _, err := resolveUploadPullURL(env, "/api/file/upload/pull/id"); err == nil ||
		!strings.Contains(err.Error(), "plaintext") {
		t.Fatalf("expected plaintext file transfer rejection, got %v", err)
	}
	if _, err := resolvePluginPullURL(env, "/api/plugins/pull/id"); err == nil ||
		!strings.Contains(err.Error(), "plaintext") {
		t.Fatalf("expected plaintext plugin transfer rejection, got %v", err)
	}
	if _, err := buildWhipURL(env, "/api/webrtc/whip"); err == nil ||
		!strings.Contains(err.Error(), "plaintext") {
		t.Fatalf("expected plaintext WebRTC signaling rejection, got %v", err)
	}
}

func TestSensitiveTransfersAllowExplicitDevelopmentOptOut(t *testing.T) {
	env := &agentRuntime.Env{Cfg: config.Config{
		ServerURLs:            []string{"ws://127.0.0.1:5173"},
		TLSInsecureSkipVerify: true,
	}}

	if resolved, err := resolveUploadPullURL(env, "/api/file/upload/pull/id"); err != nil ||
		!strings.HasPrefix(resolved, "http://") {
		t.Fatalf("expected explicit plaintext file transfer, got %q, %v", resolved, err)
	}
	if resolved, err := resolvePluginPullURL(env, "/api/plugins/pull/id"); err != nil ||
		!strings.HasPrefix(resolved, "http://") {
		t.Fatalf("expected explicit plaintext plugin transfer, got %q, %v", resolved, err)
	}
	if resolved, err := buildWhipURL(env, "/api/webrtc/whip"); err != nil ||
		!strings.HasPrefix(resolved, "http://") {
		t.Fatalf("expected explicit plaintext signaling, got %q, %v", resolved, err)
	}
}
