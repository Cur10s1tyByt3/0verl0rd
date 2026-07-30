package tlsconfig

import (
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func pinForCertificate(certificate *tls.Certificate) string {
	sum := sha256.Sum256(certificate.Leaf.RawSubjectPublicKeyInfo)
	return base64.StdEncoding.EncodeToString(sum[:])
}

func clientForConfig(config *tls.Config) *http.Client {
	return &http.Client{
		Transport: &http.Transport{TLSClientConfig: config},
	}
}

func TestPinnedServerIdentity(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "ok")
	}))
	defer server.Close()

	correctPin := pinForCertificate(&server.TLS.Certificates[0])
	config, err := Build(Options{SPKIPins: []string{correctPin}})
	if err != nil {
		t.Fatalf("Build failed: %v", err)
	}

	response, err := clientForConfig(config).Get(server.URL)
	if err != nil {
		t.Fatalf("pinned request failed: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("unexpected status: %d", response.StatusCode)
	}
}

func TestPinnedServerRejectsRogueKey(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()

	roguePin := base64.StdEncoding.EncodeToString(bytesOf(sha256.Size, 0x42))
	config, err := Build(Options{SPKIPins: []string{roguePin}})
	if err != nil {
		t.Fatalf("Build failed: %v", err)
	}

	_, err = clientForConfig(config).Get(server.URL)
	if err == nil || !strings.Contains(err.Error(), "identity pin mismatch") {
		t.Fatalf("expected pin mismatch, got %v", err)
	}
}

func TestInvalidPinFailsClosed(t *testing.T) {
	if _, err := Build(Options{SPKIPins: []string{"not-a-pin"}}); err == nil {
		t.Fatal("expected invalid pin to be rejected")
	}
}

func TestExplicitInsecureModeRemainsOptIn(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	secureConfig, err := Build(Options{})
	if err != nil {
		t.Fatalf("Build secure config failed: %v", err)
	}
	if _, err := clientForConfig(secureConfig).Get(server.URL); err == nil {
		t.Fatal("untrusted self-signed certificate unexpectedly succeeded")
	}

	insecureConfig, err := Build(Options{InsecureSkipVerify: true})
	if err != nil {
		t.Fatalf("Build insecure config failed: %v", err)
	}
	response, err := clientForConfig(insecureConfig).Get(server.URL)
	if err != nil {
		t.Fatalf("explicit insecure request failed: %v", err)
	}
	response.Body.Close()
}

func bytesOf(count int, value byte) []byte {
	result := make([]byte, count)
	for i := range result {
		result[i] = value
	}
	return result
}
