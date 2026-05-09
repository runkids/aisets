package apierr

import (
	"errors"
	"testing"
)

func TestConstructorsAndErrorString(t *testing.T) {
	err := New("missing", "not found")
	if err.Code != "missing" || err.Message != "not found" || err.Error() != "not found" {
		t.Fatalf("New() = %#v, Error() = %q", err, err.Error())
	}

	withParams := WithParams("invalid", "bad input", map[string]any{"field": "name"})
	if withParams.Code != "invalid" || withParams.Params["field"] != "name" {
		t.Fatalf("WithParams() = %#v", withParams)
	}

	codeOnly := New("fallback", "")
	if codeOnly.Error() != "fallback" {
		t.Fatalf("code-only Error() = %q", codeOnly.Error())
	}
}

func TestFromPreservesCodedErrorsAndFallbacks(t *testing.T) {
	if got := From(nil, "fallback"); got.Code != "fallback" || got.Message != "" {
		t.Fatalf("From(nil) = %#v", got)
	}

	coded := New("known", "known message")
	if got := From(coded, "fallback"); got.Code != coded.Code || got.Message != coded.Message {
		t.Fatalf("From(coded) = %#v, want %#v", got, coded)
	}

	if got := From(errors.New("boom"), "fallback"); got.Code != "fallback" || got.Message != "boom" {
		t.Fatalf("From(generic, fallback) = %#v", got)
	}

	if got := From(errors.New("boom"), ""); got.Code != "internal_error" || got.Message != "boom" {
		t.Fatalf("From(generic, empty fallback) = %#v", got)
	}
}
