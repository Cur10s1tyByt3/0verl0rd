package handlers

import (
	"strings"
	"unicode"
)

func parseCommandArgs(input string) []string {
	if strings.TrimSpace(input) == "" {
		return []string{}
	}

	var args []string
	var current []rune
	inSingle := false
	inDouble := false
	escaped := false

	for _, r := range input {
		if escaped {
			current = append(current, r)
			escaped = false
			continue
		}

		if r == '\\' {
			escaped = true
			continue
		}

		if inSingle {
			if r == '\'' {
				inSingle = false
			} else {
				current = append(current, r)
			}
			continue
		}

		if inDouble {
			if r == '"' {
				inDouble = false
			} else {
				current = append(current, r)
			}
			continue
		}

		switch {
		case r == '\'':
			inSingle = true
		case r == '"':
			inDouble = true
		case unicode.IsSpace(r):
			if len(current) > 0 {
				args = append(args, string(current))
				current = nil
			}
		default:
			current = append(current, r)
		}
	}

	if escaped {
		current = append(current, '\\')
	}

	if len(current) > 0 {
		args = append(args, string(current))
	}

	return args
}
