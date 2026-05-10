package server

import (
	"encoding/json"
	"testing"
)

func TestUnmarshalStringOrFirst(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{"string", `"icon"`, "icon"},
		{"array single", `["photo"]`, "photo"},
		{"array multi", `["illustration","character"]`, "illustration"},
		{"empty array", `[]`, ""},
		{"null", `null`, ""},
		{"empty", ``, ""},
		{"number fallback", `42`, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := unmarshalStringOrFirst(json.RawMessage(tt.raw))
			if got != tt.want {
				t.Errorf("unmarshalStringOrFirst(%s) = %q, want %q", tt.raw, got, tt.want)
			}
		})
	}
}
