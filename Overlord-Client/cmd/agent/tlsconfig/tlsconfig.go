package tlsconfig

import (
	"bytes"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"
)

type Options struct {
	InsecureSkipVerify bool
	CAPath             string
	SPKIPins           []string
	ClientCertPath     string
	ClientKeyPath      string
}

func Build(options Options) (*tls.Config, error) {
	pins, err := decodePins(options.SPKIPins)
	if err != nil {
		return nil, err
	}

	tlsConfig := &tls.Config{
		MinVersion: tls.VersionTLS12,
	}

	if strings.TrimSpace(options.CAPath) != "" {
		caCert, err := os.ReadFile(options.CAPath)
		if err != nil {
			return nil, fmt.Errorf("read TLS CA: %w", err)
		}
		caCertPool := x509.NewCertPool()
		if !caCertPool.AppendCertsFromPEM(caCert) {
			return nil, errors.New("parse TLS CA: no certificates found")
		}
		tlsConfig.RootCAs = caCertPool
	}

	if strings.TrimSpace(options.ClientCertPath) != "" || strings.TrimSpace(options.ClientKeyPath) != "" {
		if strings.TrimSpace(options.ClientCertPath) == "" || strings.TrimSpace(options.ClientKeyPath) == "" {
			return nil, errors.New("both TLS client certificate and key are required")
		}
		certificate, err := tls.LoadX509KeyPair(options.ClientCertPath, options.ClientKeyPath)
		if err != nil {
			return nil, fmt.Errorf("load TLS client certificate: %w", err)
		}
		tlsConfig.Certificates = []tls.Certificate{certificate}
	}

	if len(pins) > 0 {
		// Verification is performed below against an embedded application pin.
		// This intentionally supports self-signed certificates without trusting
		// arbitrary certificates from the network or host trust store.
		tlsConfig.InsecureSkipVerify = true //nolint:gosec
		tlsConfig.VerifyConnection = func(state tls.ConnectionState) error {
			return verifyPinnedConnection(state, pins, time.Now())
		}
		return tlsConfig, nil
	}

	tlsConfig.InsecureSkipVerify = options.InsecureSkipVerify //nolint:gosec
	return tlsConfig, nil
}

func decodePins(values []string) ([][]byte, error) {
	result := make([][]byte, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(strings.TrimPrefix(value, "sha256/"))
		if value == "" {
			continue
		}
		decoded, err := base64.StdEncoding.DecodeString(value)
		if err != nil || len(decoded) != sha256.Size {
			return nil, fmt.Errorf("invalid TLS SPKI pin %q", value)
		}
		result = append(result, decoded)
	}
	return result, nil
}

func verifyPinnedConnection(state tls.ConnectionState, pins [][]byte, now time.Time) error {
	if len(state.PeerCertificates) == 0 {
		return errors.New("TLS peer did not provide a certificate")
	}
	leaf := state.PeerCertificates[0]
	if now.Before(leaf.NotBefore) || now.After(leaf.NotAfter) {
		return fmt.Errorf("TLS peer certificate is not valid at %s", now.UTC().Format(time.RFC3339))
	}
	sum := sha256.Sum256(leaf.RawSubjectPublicKeyInfo)
	for _, pin := range pins {
		if bytes.Equal(sum[:], pin) {
			return nil
		}
	}
	return fmt.Errorf(
		"TLS server identity pin mismatch (received sha256/%s)",
		base64.StdEncoding.EncodeToString(sum[:]),
	)
}
