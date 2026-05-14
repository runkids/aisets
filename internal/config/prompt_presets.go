package config

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"
)

type PromptVariableType string

const (
	PromptVarTags   PromptVariableType = "tags"
	PromptVarText   PromptVariableType = "text"
	PromptVarSelect PromptVariableType = "select"
)

type PromptVariable struct {
	Type   PromptVariableType `json:"type"`
	Values []string           `json:"values"`
}

type PromptPresetContent struct {
	Template  string                    `json:"template"`
	Variables map[string]PromptVariable `json:"variables"`
}

type PromptPreset struct {
	ID        string              `json:"id"`
	Type      string              `json:"type"`
	Name      string              `json:"name"`
	Content   PromptPresetContent `json:"content"`
	IsDefault bool                `json:"isDefault"`
	CreatedAt string              `json:"createdAt"`
	UpdatedAt string              `json:"updatedAt"`
}

var varPattern = regexp.MustCompile(`\{\{(\w+)\}\}`)

func FormatPrompt(content PromptPresetContent) string {
	return varPattern.ReplaceAllStringFunc(content.Template, func(match string) string {
		name := match[2 : len(match)-2]
		v, ok := content.Variables[name]
		if !ok {
			return match
		}
		switch v.Type {
		case PromptVarTags:
			return strings.Join(v.Values, ", ")
		case PromptVarText, PromptVarSelect:
			if len(v.Values) > 0 {
				return v.Values[0]
			}
			return ""
		default:
			return strings.Join(v.Values, ", ")
		}
	})
}

func (s *Store) RestoreDefaultPromptPresets() error {
	now := nowUTC()
	presets := defaultPromptPresets(now)

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM prompt_presets`); err != nil {
		return err
	}
	for _, preset := range presets {
		contentJSON, err := json.Marshal(preset.Content)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(
			`INSERT INTO prompt_presets (id, type, name, content, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			preset.ID, preset.Type, preset.Name, string(contentJSON), boolToInt(preset.IsDefault), preset.CreatedAt, preset.UpdatedAt,
		); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func defaultPromptPresets(now string) []PromptPreset {
	return []PromptPreset{
		{
			ID:        "tag-built-in-default",
			Type:      "tag",
			Name:      "Built-in Default",
			Content:   PromptPresetContent{Template: defaultTagPrompt(), Variables: map[string]PromptVariable{}},
			IsDefault: true,
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ID:        "ocr-built-in-default",
			Type:      "ocr",
			Name:      "Built-in Default",
			Content:   PromptPresetContent{Template: defaultOCRPrompt(), Variables: map[string]PromptVariable{}},
			IsDefault: true,
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ID:   "optimize-built-in-default",
			Type: "optimize",
			Name: "Built-in Default",
			Content: PromptPresetContent{
				Template: defaultOptimizePrompt(),
				Variables: map[string]PromptVariable{
					"contentTypes": {Type: PromptVarTags, Values: []string{
						"photo", "icon", "screenshot", "diagram", "illustration", "gradient", "pattern", "text-heavy",
					}},
					"formats": {Type: PromptVarTags, Values: []string{
						"avif", "webp", "png", "svg", "jpeg",
					}},
					"rules": {Type: PromptVarText, Values: []string{
						"- Icons with transparency: lossless WebP or AVIF, preserve alpha\n- Photos/banners: lossy WebP/AVIF, quality 70-85\n- Screenshots with text: lossless or quality 95+ to preserve sharpness\n- Diagrams with text: lossless compression, consider SVG if simple shapes\n- Decorative gradients: aggressive lossy, quality 60-70\n- Patterns: lossless PNG or WebP for tile accuracy",
					}},
				},
			},
			IsDefault: true,
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ID:        "duplicate-built-in-default",
			Type:      "duplicate",
			Name:      "Built-in Default",
			Content:   PromptPresetContent{Template: defaultDuplicatePrompt(), Variables: map[string]PromptVariable{}},
			IsDefault: true,
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ID:        "precheck-built-in-default",
			Type:      "precheck",
			Name:      "Built-in Default",
			Content:   PromptPresetContent{Template: defaultPrecheckPrompt(), Variables: map[string]PromptVariable{}},
			IsDefault: true,
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ID:        "canvas-built-in-default",
			Type:      "canvas",
			Name:      "Built-in Default",
			Content:   PromptPresetContent{Template: DefaultCanvasPrompt(), Variables: map[string]PromptVariable{}},
			IsDefault: true,
			CreatedAt: now,
			UpdatedAt: now,
		},
	}
}

func (s *Store) ListPromptPresets(presetType string) ([]PromptPreset, error) {
	var rows *sql.Rows
	var err error
	if presetType != "" {
		rows, err = s.rdb.Query(
			`SELECT id, type, name, content, is_default, created_at, updated_at FROM prompt_presets WHERE type = ? ORDER BY is_default DESC, name`,
			presetType,
		)
	} else {
		rows, err = s.rdb.Query(
			`SELECT id, type, name, content, is_default, created_at, updated_at FROM prompt_presets ORDER BY type, is_default DESC, name`,
		)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var presets []PromptPreset
	for rows.Next() {
		p, err := scanPreset(rows)
		if err != nil {
			return nil, err
		}
		presets = append(presets, p)
	}
	return presets, rows.Err()
}

func (s *Store) GetPromptPreset(id string) (PromptPreset, error) {
	row := s.rdb.QueryRow(
		`SELECT id, type, name, content, is_default, created_at, updated_at FROM prompt_presets WHERE id = ?`,
		id,
	)
	return scanPreset(row)
}

func (s *Store) CreatePromptPreset(p PromptPreset) (PromptPreset, error) {
	if p.Name == "" {
		return PromptPreset{}, fmt.Errorf("preset name is required")
	}
	if p.Type != "tag" && p.Type != "ocr" && p.Type != "optimize" && p.Type != "duplicate" && p.Type != "system" && p.Type != "precheck" && p.Type != "canvas" {
		return PromptPreset{}, fmt.Errorf("preset type must be 'tag', 'ocr', 'optimize', 'duplicate', 'system', 'precheck', or 'canvas'")
	}

	p.ID = uuid.NewString()
	now := nowUTC()
	p.CreatedAt = now
	p.UpdatedAt = now

	contentJSON, err := json.Marshal(p.Content)
	if err != nil {
		return PromptPreset{}, err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return PromptPreset{}, err
	}
	defer tx.Rollback()

	if p.IsDefault {
		if _, err := tx.Exec(`UPDATE prompt_presets SET is_default = 0 WHERE type = ? AND is_default = 1`, p.Type); err != nil {
			return PromptPreset{}, err
		}
	}

	if _, err := tx.Exec(
		`INSERT INTO prompt_presets (id, type, name, content, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		p.ID, p.Type, p.Name, string(contentJSON), boolToInt(p.IsDefault), p.CreatedAt, p.UpdatedAt,
	); err != nil {
		return PromptPreset{}, err
	}

	if err := tx.Commit(); err != nil {
		return PromptPreset{}, err
	}

	if p.IsDefault {
		_ = s.syncDefaultToSettings(p.Type, p.Content)
	}

	return p, nil
}

func (s *Store) UpdatePromptPreset(id string, name *string, content *PromptPresetContent, isDefault *bool) (PromptPreset, error) {
	existing, err := s.GetPromptPreset(id)
	if err != nil {
		return PromptPreset{}, err
	}

	if name != nil {
		if *name == "" {
			return PromptPreset{}, fmt.Errorf("preset name is required")
		}
		existing.Name = *name
	}
	if content != nil {
		existing.Content = *content
	}
	if isDefault != nil {
		existing.IsDefault = *isDefault
	}
	existing.UpdatedAt = nowUTC()

	contentJSON, err := json.Marshal(existing.Content)
	if err != nil {
		return PromptPreset{}, err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return PromptPreset{}, err
	}
	defer tx.Rollback()

	if isDefault != nil && *isDefault {
		if _, err := tx.Exec(`UPDATE prompt_presets SET is_default = 0 WHERE type = ? AND is_default = 1`, existing.Type); err != nil {
			return PromptPreset{}, err
		}
	}

	if _, err := tx.Exec(
		`UPDATE prompt_presets SET name = ?, content = ?, is_default = ?, updated_at = ? WHERE id = ?`,
		existing.Name, string(contentJSON), boolToInt(existing.IsDefault), existing.UpdatedAt, id,
	); err != nil {
		return PromptPreset{}, err
	}

	if err := tx.Commit(); err != nil {
		return PromptPreset{}, err
	}

	if existing.IsDefault {
		_ = s.syncDefaultToSettings(existing.Type, existing.Content)
	}

	return existing, nil
}

func (s *Store) DeletePromptPreset(id string) error {
	existing, err := s.GetPromptPreset(id)
	if err != nil {
		return err
	}
	if existing.IsDefault {
		return fmt.Errorf("cannot delete the default preset; set another preset as default first")
	}
	_, err = s.db.Exec(`DELETE FROM prompt_presets WHERE id = ?`, id)
	return err
}

func (s *Store) SetPromptPresetDefault(id string) (PromptPreset, error) {
	existing, err := s.GetPromptPreset(id)
	if err != nil {
		return PromptPreset{}, err
	}

	tx, err := s.db.Begin()
	if err != nil {
		return PromptPreset{}, err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`UPDATE prompt_presets SET is_default = 0 WHERE type = ? AND is_default = 1`, existing.Type); err != nil {
		return PromptPreset{}, err
	}

	now := nowUTC()
	if _, err := tx.Exec(`UPDATE prompt_presets SET is_default = 1, updated_at = ? WHERE id = ?`, now, id); err != nil {
		return PromptPreset{}, err
	}

	if err := tx.Commit(); err != nil {
		return PromptPreset{}, err
	}

	existing.IsDefault = true
	existing.UpdatedAt = now
	_ = s.syncDefaultToSettings(existing.Type, existing.Content)

	return existing, nil
}

func (s *Store) syncDefaultToSettings(presetType string, content PromptPresetContent) error {
	formatted := FormatPrompt(content)

	settings, err := s.Settings()
	if err != nil {
		return err
	}

	switch presetType {
	case "tag":
		settings.LLMTagPrompt = formatted
	case "ocr":
		settings.LLMOcrPrompt = formatted
	case "system":
		settings.LLMSystemPrompt = formatted
	case "precheck":
		settings.LLMPrecheckPrompt = formatted
	default:
		return nil
	}

	raw, err := json.Marshal(settings)
	if err != nil {
		return err
	}

	_, err = s.db.Exec(
		`INSERT INTO app_settings (key, value, updated_at) VALUES ('app', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		string(raw), nowUTC(),
	)
	return err
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanPreset(s rowScanner) (PromptPreset, error) {
	var p PromptPreset
	var contentJSON string
	var isDefault int
	if err := s.Scan(&p.ID, &p.Type, &p.Name, &contentJSON, &isDefault, &p.CreatedAt, &p.UpdatedAt); err != nil {
		return PromptPreset{}, err
	}
	p.IsDefault = isDefault != 0
	if err := json.Unmarshal([]byte(contentJSON), &p.Content); err != nil {
		p.Content = PromptPresetContent{Template: contentJSON}
	}
	return p, nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
