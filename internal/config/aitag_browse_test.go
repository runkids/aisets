package config

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"aisets/internal/aitag"
)

func seedTagData(t *testing.T, store *Store) {
	t.Helper()
	rows := []aitag.Result{
		{ProjectID: "proj1", RepoPath: "a.png", ContentHash: "h1", HashAlgorithm: "sha256", ProviderName: "ollama", ModelName: "llava", Status: aitag.StatusReady, Category: "icon", Tags: []string{"dark-mode", "navigation", "sidebar"}, UpdatedAt: "2026-01-01T00:00:00Z"},
		{ProjectID: "proj1", RepoPath: "b.png", ContentHash: "h2", HashAlgorithm: "sha256", ProviderName: "ollama", ModelName: "llava", Status: aitag.StatusReady, Category: "photo", Tags: []string{"dark-mode", "hero-section"}, UpdatedAt: "2026-01-01T00:00:00Z"},
		{ProjectID: "proj2", RepoPath: "c.svg", ContentHash: "h3", HashAlgorithm: "sha256", ProviderName: "ollama", ModelName: "llava", Status: aitag.StatusReady, Category: "icon", Tags: []string{"navigation", "mobile"}, UpdatedAt: "2026-01-01T00:00:00Z"},
		{ProjectID: "proj2", RepoPath: "d.png", ContentHash: "h4", HashAlgorithm: "sha256", ProviderName: "ollama", ModelName: "llava", Status: aitag.StatusFailed, Category: "", Tags: []string{"should-not-appear"}, UpdatedAt: "2026-01-01T00:00:00Z"},
		{ProjectID: "proj1", RepoPath: "e.jpg", ContentHash: "h5", HashAlgorithm: "sha256", ProviderName: "ollama", ModelName: "llava", Status: aitag.StatusReady, Category: "photo", Tags: []string{"boxing", "sports"}, TagsI18n: map[string][]string{"zh-TW": {"拳擊", "運動"}, "ja": {"ボクシング", "スポーツ"}}, UpdatedAt: "2026-01-01T00:00:00Z"},
	}
	for _, r := range rows {
		if err := store.UpsertAITagResult(r); err != nil {
			t.Fatal(err)
		}
	}
}

func TestAITagList_Basic(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	seedTagData(t, store)

	page, err := store.AITagList(AITagListQuery{})
	if err != nil {
		t.Fatal(err)
	}

	if page.Total != 7 {
		t.Fatalf("expected 7 unique tags, got %d", page.Total)
	}
	if page.TotalTaggedAssets != 4 {
		t.Fatalf("expected 4 tagged assets, got %d", page.TotalTaggedAssets)
	}
	if page.TopCategory != "icon" {
		t.Fatalf("expected top category 'icon', got %q", page.TopCategory)
	}

	if len(page.Tags) < 2 {
		t.Fatal("expected at least 2 tags")
	}
	first := page.Tags[0]
	if first.Tag != "dark-mode" {
		t.Fatalf("expected first tag 'dark-mode', got %q", first.Tag)
	}
	if first.Count != 2 {
		t.Fatalf("expected count 2, got %d", first.Count)
	}
}

func TestAITagList_Search(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	seedTagData(t, store)

	page, err := store.AITagList(AITagListQuery{Search: "nav"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 {
		t.Fatalf("expected 1 tag matching 'nav', got %d", page.Total)
	}
	if page.Tags[0].Tag != "navigation" {
		t.Fatalf("expected tag 'navigation', got %q", page.Tags[0].Tag)
	}
}

func TestAITagList_ProjectFilter(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	seedTagData(t, store)

	page, err := store.AITagList(AITagListQuery{Project: "proj2"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 2 {
		t.Fatalf("expected 2 tags for proj2, got %d", page.Total)
	}
	if page.TotalTaggedAssets != 1 {
		t.Fatalf("expected 1 tagged asset for proj2, got %d", page.TotalTaggedAssets)
	}
}

func TestAITagList_AlphaSort(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	seedTagData(t, store)

	page, err := store.AITagList(AITagListQuery{Sort: "alpha"})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Tags) < 7 {
		t.Fatalf("expected 7 tags, got %d", len(page.Tags))
	}
	if page.Tags[0].Tag != "boxing" {
		t.Fatalf("expected first alpha tag 'boxing', got %q", page.Tags[0].Tag)
	}
	if page.Tags[1].Tag != "dark-mode" {
		t.Fatalf("expected second alpha tag 'dark-mode', got %q", page.Tags[1].Tag)
	}
}

func TestAITagList_Pagination(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	seedTagData(t, store)

	page, err := store.AITagList(AITagListQuery{Limit: 2, Offset: 0})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Tags) != 2 {
		t.Fatalf("expected 2 tags with limit=2, got %d", len(page.Tags))
	}
	if page.Total != 7 {
		t.Fatalf("total should still be 7, got %d", page.Total)
	}

	page2, err := store.AITagList(AITagListQuery{Limit: 2, Offset: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(page2.Tags) != 2 {
		t.Fatalf("expected 2 tags on page 2, got %d", len(page2.Tags))
	}
	if page2.Tags[0].Tag == page.Tags[0].Tag {
		t.Fatal("page 2 should not repeat page 1 tags")
	}
}

func TestAITagList_EmptyDB(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	page, err := store.AITagList(AITagListQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 0 || page.TotalTaggedAssets != 0 || len(page.Tags) != 0 {
		t.Fatalf("expected empty result, got total=%d assets=%d tags=%d", page.Total, page.TotalTaggedAssets, len(page.Tags))
	}
}

func TestAITagRename(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	seedTagData(t, store)

	affected, err := store.AITagRename("dark-mode", "dark-theme")
	if err != nil {
		t.Fatal(err)
	}
	if affected != 2 {
		t.Fatalf("expected 2 affected rows, got %d", affected)
	}

	// Verify old tag is gone and new tag exists
	page, err := store.AITagList(AITagListQuery{Search: "dark-mode"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 0 {
		t.Fatalf("expected 0 results for old tag 'dark-mode', got %d", page.Total)
	}

	page, err = store.AITagList(AITagListQuery{Search: "dark-theme"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 {
		t.Fatalf("expected 1 result for new tag 'dark-theme', got %d", page.Total)
	}
	if page.Tags[0].Count != 2 {
		t.Fatalf("expected count 2 for 'dark-theme', got %d", page.Tags[0].Count)
	}
}

func TestAITagMerge(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	seedTagData(t, store)

	// Merge "dark-mode" and "hero-section" into "dark-ui"
	affected, err := store.AITagMerge([]string{"dark-mode", "hero-section"}, "dark-ui")
	if err != nil {
		t.Fatal(err)
	}
	if affected != 2 {
		t.Fatalf("expected 2 affected rows, got %d", affected)
	}

	// Verify source tags are gone
	page, err := store.AITagList(AITagListQuery{Search: "dark-mode"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 0 {
		t.Fatalf("expected 0 results for 'dark-mode', got %d", page.Total)
	}
	page, err = store.AITagList(AITagListQuery{Search: "hero-section"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 0 {
		t.Fatalf("expected 0 results for 'hero-section', got %d", page.Total)
	}

	// Verify target tag exists with correct count
	page, err = store.AITagList(AITagListQuery{Search: "dark-ui"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 {
		t.Fatalf("expected 1 result for 'dark-ui', got %d", page.Total)
	}
	if page.Tags[0].Count != 2 {
		t.Fatalf("expected count 2 for 'dark-ui', got %d", page.Tags[0].Count)
	}

	// Row b.png had both "dark-mode" and "hero-section" — verify dedup (only one "dark-ui")
	var tagsRaw string
	err = store.rdb.QueryRow(`SELECT tags_json FROM ai_tags WHERE repo_path = 'b.png' AND status = 'ready'`).Scan(&tagsRaw)
	if err != nil {
		t.Fatal(err)
	}
	var tags []string
	if err := json.Unmarshal([]byte(tagsRaw), &tags); err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, tag := range tags {
		if tag == "dark-ui" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("expected exactly 1 'dark-ui' in b.png tags, got %d (tags: %v)", count, tags)
	}
}

func TestAITagRename_Dedup(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	seedTagData(t, store)

	// Rename "dark-mode" to "navigation" — row a.png already has "navigation"
	affected, err := store.AITagRename("dark-mode", "navigation")
	if err != nil {
		t.Fatal(err)
	}
	if affected != 2 {
		t.Fatalf("expected 2 affected rows, got %d", affected)
	}

	// Verify a.png has exactly one "navigation" (no duplicate)
	var tagsRaw string
	err = store.rdb.QueryRow(`SELECT tags_json FROM ai_tags WHERE repo_path = 'a.png' AND status = 'ready'`).Scan(&tagsRaw)
	if err != nil {
		t.Fatal(err)
	}
	var tags []string
	if err := json.Unmarshal([]byte(tagsRaw), &tags); err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, tag := range tags {
		if tag == "navigation" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("expected exactly 1 'navigation' in a.png tags, got %d (tags: %v)", count, tags)
	}

	// Verify "dark-mode" is gone entirely
	page, err := store.AITagList(AITagListQuery{Search: "dark-mode"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 0 {
		t.Fatalf("expected 0 results for 'dark-mode', got %d", page.Total)
	}
}

func TestAITagDelete(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	seedTagData(t, store)

	affected, err := store.AITagDelete([]string{"dark-mode", "mobile"})
	if err != nil {
		t.Fatal(err)
	}
	if affected != 3 {
		t.Fatalf("expected 3 affected rows, got %d", affected)
	}

	page, err := store.AITagList(AITagListQuery{Search: "dark-mode"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 0 {
		t.Fatalf("expected 0 results for 'dark-mode', got %d", page.Total)
	}
	page, err = store.AITagList(AITagListQuery{Search: "mobile"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 0 {
		t.Fatalf("expected 0 results for 'mobile', got %d", page.Total)
	}

	page, err = store.AITagList(AITagListQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 5 {
		t.Fatalf("expected 5 remaining tags, got %d", page.Total)
	}
}

func TestAITagDelete_EmptyResult(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	seedTagData(t, store)

	affected, err := store.AITagDelete([]string{"nonexistent-tag"})
	if err != nil {
		t.Fatal(err)
	}
	if affected != 0 {
		t.Fatalf("expected 0 affected rows, got %d", affected)
	}
}

func TestAITagSetForAsset_Update(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	seedTagData(t, store)

	key := AITagSetForAssetKey{
		ProjectID:     "proj1",
		RepoPath:      "a.png",
		ContentHash:   "h1",
		HashAlgorithm: "sha256",
	}

	err = store.AITagSetForAsset(key, []string{"new-tag-1", "new-tag-2"})
	if err != nil {
		t.Fatal(err)
	}

	var tagsRaw string
	err = store.rdb.QueryRow(`SELECT tags_json FROM ai_tags WHERE project_id = 'proj1' AND repo_path = 'a.png' AND status = 'ready' ORDER BY updated_at DESC LIMIT 1`).Scan(&tagsRaw)
	if err != nil {
		t.Fatal(err)
	}
	var resultTags []string
	if err := json.Unmarshal([]byte(tagsRaw), &resultTags); err != nil {
		t.Fatal(err)
	}
	if len(resultTags) != 2 || resultTags[0] != "new-tag-1" || resultTags[1] != "new-tag-2" {
		t.Fatalf("expected [new-tag-1, new-tag-2], got %v", resultTags)
	}
}

func TestAITagSetForAsset_Insert(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	seedTagData(t, store)

	key := AITagSetForAssetKey{
		ProjectID:     "proj1",
		RepoPath:      "new-asset.png",
		ContentHash:   "h99",
		HashAlgorithm: "sha256",
	}

	err = store.AITagSetForAsset(key, []string{"manual-tag"})
	if err != nil {
		t.Fatal(err)
	}

	var tagsRaw, status, providerName string
	err = store.rdb.QueryRow(`SELECT tags_json, status, provider_name FROM ai_tags WHERE project_id = 'proj1' AND repo_path = 'new-asset.png'`).Scan(&tagsRaw, &status, &providerName)
	if err != nil {
		t.Fatal(err)
	}
	if status != "ready" {
		t.Fatalf("expected status 'ready', got %q", status)
	}
	if providerName != "manual" {
		t.Fatalf("expected provider 'manual', got %q", providerName)
	}
	var resultTags []string
	if err := json.Unmarshal([]byte(tagsRaw), &resultTags); err != nil {
		t.Fatal(err)
	}
	if len(resultTags) != 1 || resultTags[0] != "manual-tag" {
		t.Fatalf("expected [manual-tag], got %v", resultTags)
	}
}

func TestAITagSuggest(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	seedTagData(t, store)

	suggestions, err := store.AITagSuggest("dark", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(suggestions) != 1 || suggestions[0] != "dark-mode" {
		t.Fatalf("expected [dark-mode], got %v", suggestions)
	}

	suggestions, err = store.AITagSuggest("nav", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(suggestions) != 1 || suggestions[0] != "navigation" {
		t.Fatalf("expected [navigation], got %v", suggestions)
	}

	suggestions, err = store.AITagSuggest("", 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(suggestions) != 3 {
		t.Fatalf("expected 3 suggestions with limit=3, got %d", len(suggestions))
	}
}

func TestAITagSuggest_NoResults(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	seedTagData(t, store)

	suggestions, err := store.AITagSuggest("zzz-nonexistent", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(suggestions) != 0 {
		t.Fatalf("expected 0 suggestions, got %v", suggestions)
	}
}

func TestAITagList_I18nSearch(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	seedTagData(t, store)

	page, err := store.AITagList(AITagListQuery{Search: "拳擊"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total == 0 {
		t.Fatal("expected i18n search '拳擊' to find tags, got 0")
	}
	found := false
	for _, tag := range page.Tags {
		if tag.Tag == "boxing" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected 'boxing' in results for i18n search '拳擊', got %v", page.Tags)
	}

	page, err = store.AITagList(AITagListQuery{Search: "ボクシング"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total == 0 {
		t.Fatal("expected i18n search 'ボクシング' to find tags, got 0")
	}
}

func TestAITagSuggest_I18n(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	seedTagData(t, store)

	suggestions, err := store.AITagSuggest("拳", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(suggestions) == 0 {
		t.Fatal("expected suggestions for i18n prefix '拳', got 0")
	}
	found := false
	for _, s := range suggestions {
		if s == "boxing" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected 'boxing' in suggestions for i18n prefix '拳', got %v", suggestions)
	}
}

func TestAITagList_CategoryFilter(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	seedTagData(t, store)

	page, err := store.AITagList(AITagListQuery{Category: "icon"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 4 {
		t.Fatalf("expected 4 tags for category 'icon', got %d", page.Total)
	}

	page, err = store.AITagList(AITagListQuery{Category: "photo"})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 4 {
		t.Fatalf("expected 4 tags for category 'photo', got %d", page.Total)
	}
}

func readI18n(t *testing.T, store *Store, projectID, repoPath string) map[string][]string {
	t.Helper()
	var raw string
	err := store.rdb.QueryRow(
		`SELECT COALESCE(tags_i18n_json, '{}') FROM ai_tags WHERE project_id = ? AND repo_path = ? AND status = 'ready' ORDER BY updated_at DESC LIMIT 1`,
		projectID, repoPath,
	).Scan(&raw)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string][]string
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestAITagSetForAsset_SyncsI18n(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	seedTagData(t, store)

	key := AITagSetForAssetKey{
		ProjectID: "proj1", RepoPath: "e.jpg",
		ContentHash: "h5", HashAlgorithm: "sha256",
	}
	// Remove "sports" (index 1), keep "boxing" (index 0)
	if err := store.AITagSetForAsset(key, []string{"boxing"}); err != nil {
		t.Fatal(err)
	}

	i18n := readI18n(t, store, "proj1", "e.jpg")
	if got := i18n["zh-TW"]; len(got) != 1 || got[0] != "拳擊" {
		t.Fatalf("zh-TW should be [拳擊], got %v", got)
	}
	if got := i18n["ja"]; len(got) != 1 || got[0] != "ボクシング" {
		t.Fatalf("ja should be [ボクシング], got %v", got)
	}
}

func TestAITagDelete_SyncsI18n(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	seedTagData(t, store)

	if _, err := store.AITagDelete([]string{"sports"}); err != nil {
		t.Fatal(err)
	}

	i18n := readI18n(t, store, "proj1", "e.jpg")
	if got := i18n["zh-TW"]; len(got) != 1 || got[0] != "拳擊" {
		t.Fatalf("zh-TW should be [拳擊], got %v", got)
	}
	if got := i18n["ja"]; len(got) != 1 || got[0] != "ボクシング" {
		t.Fatalf("ja should be [ボクシング], got %v", got)
	}
}

func TestAITagMerge_SyncsI18n(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_DATA_HOME", filepath.Join(root, "data"))
	store, err := OpenStore()
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	seedTagData(t, store)

	// Merge "boxing" → "combat-sports"; "sports" remains
	if _, err := store.AITagMerge([]string{"boxing"}, "combat-sports"); err != nil {
		t.Fatal(err)
	}

	i18n := readI18n(t, store, "proj1", "e.jpg")
	// "boxing" (idx 0) was merged away, "sports" (idx 1) kept
	// combat-sports is new, has no old i18n entry → only "sports" i18n remains
	if got := i18n["zh-TW"]; len(got) != 1 || got[0] != "運動" {
		t.Fatalf("zh-TW should be [運動], got %v", got)
	}
	if got := i18n["ja"]; len(got) != 1 || got[0] != "スポーツ" {
		t.Fatalf("ja should be [スポーツ], got %v", got)
	}
}
