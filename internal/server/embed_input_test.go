package server

import (
	"testing"

	"aisets/internal/aitag"
	"aisets/internal/scanner"
)

func TestBuildEmbeddingInputHonorsFields(t *testing.T) {
	item := scanner.AssetItem{RepoPath: "icons/primary-button_icon.png"}
	tag := aitag.Result{
		Status:      aitag.StatusReady,
		Category:    "icon",
		Tags:        []string{"primary-button", "rounded"},
		Description: "A rounded primary button icon",
	}

	got := buildEmbeddingInput(item, tag, "Checkout", []string{"category", "fileName", "ocrText"})
	want := "icon\nprimary button icon\nCheckout"
	if got != want {
		t.Fatalf("embedding input mismatch:\ngot  %q\nwant %q", got, want)
	}
}

func TestBuildEmbeddingInputFallsBackFromInvalidEnglishI18n(t *testing.T) {
	item := scanner.AssetItem{RepoPath: "icons/cart.png"}
	tag := aitag.Result{
		Status:          aitag.StatusReady,
		Category:        "icon",
		Tags:            []string{"cart", "checkout"},
		Description:     "A cart checkout icon",
		CategoryI18n:    map[string]string{"en": "7."},
		TagsI18n:        map[string][]string{"en": {"Cart"}},
		DescriptionI18n: map[string]string{"en": "..."},
	}

	got := buildEmbeddingInput(item, tag, "", []string{"category", "tags", "description"})
	want := "icon\ncart, checkout\nA cart checkout icon"
	if got != want {
		t.Fatalf("embedding input mismatch:\ngot  %q\nwant %q", got, want)
	}
}

func TestParseI18nBackfillResponse(t *testing.T) {
	items, err := parseI18nBackfillResponse(`{"translations":[{"id":2,"category":"Icon","tags":["Button","Primary"],"description":"Primary button"}]}`)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != 2 || items[0].Tags[1] != "Primary" {
		t.Fatalf("unexpected items: %+v", items)
	}
}
