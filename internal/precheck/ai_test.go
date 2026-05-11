package precheck

import "testing"

func TestParseAIResponseCleanJSON(t *testing.T) {
	raw := `{
		"category": "Photo",
		"tags": ["landscape", "mountain"],
		"description": "A mountain at sunset.",
		"quality": {"score": 4, "issues": [], "assessment": "Good clarity."},
		"suggestion": {"recommendedFilename": "mountain-sunset", "formatRecommendation": "", "suitability": "Good", "suitabilityReason": "High quality photo."}
	}`
	r := ParseAIResponse("test.png", raw)
	if r.Status != "ready" {
		t.Fatalf("status = %s, error = %s", r.Status, r.ErrorMsg)
	}
	if r.Category != "photo" {
		t.Fatalf("category = %q, want photo", r.Category)
	}
	if len(r.Tags) != 2 || r.Tags[0] != "landscape" {
		t.Fatalf("tags = %v", r.Tags)
	}
	if r.Quality.Score != 4 {
		t.Fatalf("quality.score = %d, want 4", r.Quality.Score)
	}
	if r.Suggestion.Suitability != "good" {
		t.Fatalf("suitability = %q, want good", r.Suggestion.Suitability)
	}
}

func TestParseAIResponseMarkdownFences(t *testing.T) {
	raw := "```json\n" + `{"category":"icon","tags":["ui"],"description":"An icon.","quality":{"score":5,"issues":[],"assessment":"Perfect."},"suggestion":{"recommendedFilename":"icon","formatRecommendation":"","suitability":"good","suitabilityReason":"Clean icon."}}` + "\n```"
	r := ParseAIResponse("icon.svg", raw)
	if r.Status != "ready" || r.Category != "icon" {
		t.Fatalf("status=%s category=%q error=%s", r.Status, r.Category, r.ErrorMsg)
	}
}

func TestParseAIResponseTrailingComma(t *testing.T) {
	raw := `{"category":"photo","tags":["a",],"description":"Test.","quality":{"score":3,"issues":["blurry",],"assessment":"Ok."},"suggestion":{"recommendedFilename":"a","formatRecommendation":"","suitability":"acceptable","suitabilityReason":"Ok.",}}`
	r := ParseAIResponse("test.jpg", raw)
	if r.Status != "ready" {
		t.Fatalf("status = %s, error = %s", r.Status, r.ErrorMsg)
	}
	if len(r.Quality.Issues) != 1 || r.Quality.Issues[0] != "blurry" {
		t.Fatalf("issues = %v", r.Quality.Issues)
	}
}

func TestParseAIResponseInvalidJSON(t *testing.T) {
	r := ParseAIResponse("bad.png", "not json at all")
	if r.Status != "failed" || r.ErrorCode != "precheck_ai_parse_failed" {
		t.Fatalf("expected failed status, got %s / %s", r.Status, r.ErrorCode)
	}
	if r.Name != "bad.png" {
		t.Fatalf("name = %q, want bad.png", r.Name)
	}
}

func TestParseAIResponseNilCollections(t *testing.T) {
	raw := `{"category":"photo","description":"A photo.","quality":{"score":3,"assessment":"Ok."},"suggestion":{"recommendedFilename":"photo","formatRecommendation":"","suitability":"good","suitabilityReason":"Fine."}}`
	r := ParseAIResponse("photo.jpg", raw)
	if r.Status != "ready" {
		t.Fatalf("status = %s", r.Status)
	}
	if r.Tags == nil {
		t.Fatal("tags should be empty slice, not nil")
	}
	if r.Quality.Issues == nil {
		t.Fatal("issues should be empty slice, not nil")
	}
}
