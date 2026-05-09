package scanner

import (
	"context"
	"encoding/hex"
	"io"
	"os"

	"github.com/zeebo/blake3"
)

const contentHashAlgorithm = "blake3"

func ContentHash(ctx context.Context, path string) (string, string, error) {
	sum, err := contentHashFile(ctx, path)
	if err != nil {
		return "", "", err
	}
	return sum, contentHashAlgorithm, nil
}

func contentHashFile(ctx context.Context, path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := blake3.New()
	buf := make([]byte, 128*1024)
	for {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		n, err := file.Read(buf)
		if n > 0 {
			if _, writeErr := hash.Write(buf[:n]); writeErr != nil {
				return "", writeErr
			}
		}
		if err == io.EOF {
			return hex.EncodeToString(hash.Sum(nil)), nil
		}
		if err != nil {
			return "", err
		}
	}
}

func stableID(value string) string {
	sum := blake3.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])[:12]
}
