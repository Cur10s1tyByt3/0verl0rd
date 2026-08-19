#pragma once

#include <string.h>
#include <malloc.h>

#ifdef __cplusplus
extern "C" {
#endif

#define OBFS_KEY 16

#define _OBF_CHR(c) ((unsigned char)(c) + OBFS_KEY)

static inline char* obfs_dec(char* buf, int len)
{
	for (int i = 0; i < len; i++)
		buf[i] = (char)((unsigned char)buf[i] - OBFS_KEY);
	return buf;
}

#ifdef _MSC_VER
#define OBFS(arr) \
	obfs_dec((char*)memcpy((char*)_alloca(sizeof(arr)), (const char*)(arr), sizeof(arr)), \
	         (int)(sizeof(arr) - 1))
#else
#define OBFS(arr) \
	obfs_dec((char*)memcpy((char[sizeof(arr)]){0}, (const char*)(arr), sizeof(arr)), \
	         (int)(sizeof(arr) - 1))
#endif

// ---- Encrypted string arrays ----
// Use _OBF_CHR() for each character so the compiler folds to constants.

static const unsigned char _enc_ReflectiveLoader[] = {
	_OBF_CHR('R'),_OBF_CHR('e'),_OBF_CHR('f'),_OBF_CHR('l'),
	_OBF_CHR('e'),_OBF_CHR('c'),_OBF_CHR('t'),_OBF_CHR('i'),
	_OBF_CHR('v'),_OBF_CHR('e'),_OBF_CHR('L'),_OBF_CHR('o'),
	_OBF_CHR('a'),_OBF_CHR('d'),_OBF_CHR('e'),_OBF_CHR('r'), 0
};

static const unsigned char _enc_ntdll_dll[] = {
	_OBF_CHR('n'),_OBF_CHR('t'),_OBF_CHR('d'),_OBF_CHR('l'),
	_OBF_CHR('l'),_OBF_CHR('.'),_OBF_CHR('d'),_OBF_CHR('l'),
	_OBF_CHR('l'), 0
};

static const unsigned char _enc_RtlAddFunctionTable[] = {
	_OBF_CHR('R'),_OBF_CHR('t'),_OBF_CHR('l'),_OBF_CHR('A'),
	_OBF_CHR('d'),_OBF_CHR('d'),_OBF_CHR('F'),_OBF_CHR('u'),
	_OBF_CHR('n'),_OBF_CHR('c'),_OBF_CHR('t'),_OBF_CHR('i'),
	_OBF_CHR('o'),_OBF_CHR('n'),_OBF_CHR('T'),_OBF_CHR('a'),
	_OBF_CHR('b'),_OBF_CHR('l'),_OBF_CHR('e'), 0
};

#ifdef __cplusplus
}
#endif