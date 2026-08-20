#!/usr/bin/env python3
"""
Generate _OBF_CHR sequences for compile-time string obfuscation (ROT16).

Usage:
    python scripts/obfuscate-strings.py "ntdll.dll"
    python scripts/obfuscate-strings.py "ntdll.dll" "RtlAddFunctionTable"

Outputs a C array initializer using _OBF_CHR() for each character.
"""
import sys

KEY = 16
INDENT = "\t"

def obfuscate(s):
    chars = []
    for c in s:
        chars.append(f"_OBF_CHR('{c}')")
    chars.append("0")
    return ",\n".join(INDENT + ch for ch in chars)

def main():
    if len(sys.argv) < 2:
        print("Usage: python obfuscate-strings.py STRING [STRING...]", file=sys.stderr)
        print("Example: python scripts/obfuscate-strings.py \"ntdll.dll\"", file=sys.stderr)
        sys.exit(1)

    for arg in sys.argv[1:]:
        body = obfuscate(arg)
        var = arg.replace(".", "_").replace(" ", "_")
        print(f"static const unsigned char _enc_{var}[] = {{\n{body}\n}};\n")

if __name__ == "__main__":
    main()