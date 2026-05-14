package server

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

type canvasActionValidationIssue struct {
	Tool   string `json:"tool"`
	Reason string `json:"reason"`
}

func normalizeCanvasActions(actions []canvasAction, requireFields bool) ([]canvasAction, []canvasActionValidationIssue) {
	normalized := make([]canvasAction, 0, len(actions))
	var issues []canvasActionValidationIssue
	for _, act := range actions {
		if canvasToolCardinality(act.Tool) == "" {
			continue
		}
		next, err := normalizeCanvasAction(act, requireFields)
		if err != nil {
			issues = append(issues, canvasActionValidationIssue{Tool: act.Tool, Reason: err.Error()})
			continue
		}
		normalized = append(normalized, next)
	}
	return normalized, issues
}

func normalizeCanvasAction(act canvasAction, requireFields bool) (canvasAction, error) {
	if act.Params == nil {
		act.Params = map[string]any{}
	}
	params := normalizeCanvasActionAliases(act.Tool, act.Params)
	schema := canvasToolParameters(act.Tool)
	normalized, err := normalizeCanvasValueForSchema(params, schema, act.Tool, requireFields)
	if err != nil {
		return canvasAction{}, err
	}
	next := act
	if normalizedParams, ok := normalized.(map[string]any); ok {
		next.Params = normalizedParams
	} else {
		next.Params = map[string]any{}
	}
	return next, nil
}

func normalizeCanvasActionAliases(tool string, params map[string]any) map[string]any {
	next := make(map[string]any, len(params)+2)
	for key, value := range params {
		next[key] = value
	}
	aliases := map[string]string{
		"asset_id":         "assetId",
		"asset_ids":        "assetIds",
		"card_id":          "cardId",
		"card_ids":         "cardIds",
		"comment_card_id":  "commentCardId",
		"anchor_card_id":   "anchorCardId",
		"after_card_id":    "afterCardId",
		"new_name":         "newName",
		"dest_dir":         "destDir",
		"dest_path":        "destPath",
		"output_format":    "outputFormat",
		"max_dimension_px": "maxDimensionPx",
		"save_to_metadata": "saveToMetadata",
	}
	if tool == "rotate_image" {
		aliases["rotateDegrees"] = "degrees"
		aliases["rotate_degrees"] = "degrees"
	}
	for from, to := range aliases {
		if _, ok := next[to]; ok {
			continue
		}
		if value, ok := next[from]; ok {
			next[to] = value
			delete(next, from)
		}
	}
	if _, ok := next["cardIds"]; !ok && canvasToolAcceptsCardIDs(tool) {
		if value, ok := next["cardId"]; ok {
			next["cardIds"] = value
		}
	}
	if _, ok := next["assetIds"]; !ok && canvasToolCanUseSelectedAssetIDs(tool) {
		if value, ok := next["assetId"]; ok {
			next["assetIds"] = value
		}
	}
	return next
}

func canvasToolAcceptsCardIDs(tool string) bool {
	schema := canvasToolParameters(tool)
	props, _ := schema["properties"].(map[string]any)
	_, ok := props["cardIds"]
	return ok
}

func normalizeCanvasValueForSchema(value any, schema map[string]any, path string, requireFields bool) (any, error) {
	kind, _ := schema["type"].(string)
	switch kind {
	case "object":
		raw, ok := value.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("%s must be an object", path)
		}
		props, _ := schema["properties"].(map[string]any)
		out := make(map[string]any, len(raw))
		for key, propSchemaRaw := range props {
			propSchema, ok := propSchemaRaw.(map[string]any)
			if !ok {
				continue
			}
			rawValue, exists := raw[key]
			if !exists || canvasValueEmpty(rawValue) {
				continue
			}
			normalized, err := normalizeCanvasValueForSchema(rawValue, propSchema, path+"."+key, requireFields)
			if err != nil {
				return nil, err
			}
			out[key] = normalized
		}
		if requireFields {
			for _, key := range canvasSchemaRequired(schema) {
				if canvasValueEmpty(out[key]) {
					return nil, fmt.Errorf("%s.%s is required", path, key)
				}
			}
		}
		return out, nil
	case "array":
		itemsSchema, _ := schema["items"].(map[string]any)
		rawItems, ok := value.([]any)
		if !ok {
			if stringsSchema, ok := value.([]string); ok {
				rawItems = make([]any, 0, len(stringsSchema))
				for _, item := range stringsSchema {
					rawItems = append(rawItems, item)
				}
			} else {
				rawItems = []any{value}
			}
		}
		out := make([]any, 0, len(rawItems))
		for i, rawItem := range rawItems {
			normalized, err := normalizeCanvasValueForSchema(rawItem, itemsSchema, fmt.Sprintf("%s[%d]", path, i), requireFields)
			if err != nil {
				return nil, err
			}
			out = append(out, normalized)
		}
		return out, nil
	case "string":
		text, ok := value.(string)
		if !ok {
			return nil, fmt.Errorf("%s must be a string", path)
		}
		if err := validateCanvasEnum(text, schema, path); err != nil {
			return nil, err
		}
		return text, nil
	case "number":
		number, err := canvasNumberParam(value)
		if err != nil {
			return nil, fmt.Errorf("%s must be a number", path)
		}
		return number, nil
	case "integer":
		number, err := canvasNumberParam(value)
		if err != nil || number != float64(int(number)) {
			return nil, fmt.Errorf("%s must be an integer", path)
		}
		if err := validateCanvasEnum(number, schema, path); err != nil {
			return nil, err
		}
		return number, nil
	case "boolean":
		boolean, err := canvasBoolParam(value)
		if err != nil {
			return nil, fmt.Errorf("%s must be a boolean", path)
		}
		return boolean, nil
	default:
		return value, nil
	}
}

func canvasSchemaRequired(schema map[string]any) []string {
	raw, ok := schema["required"].([]string)
	if ok {
		return raw
	}
	rawAny, ok := schema["required"].([]any)
	if !ok {
		return nil
	}
	var out []string
	for _, item := range rawAny {
		if text, ok := item.(string); ok {
			out = append(out, text)
		}
	}
	return out
}

func canvasValueEmpty(value any) bool {
	switch v := value.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(v) == ""
	case []any:
		return len(v) == 0
	case []string:
		return len(v) == 0
	default:
		return false
	}
}

func canvasNumberParam(value any) (float64, error) {
	switch v := value.(type) {
	case float64:
		return v, nil
	case float32:
		return float64(v), nil
	case int:
		return float64(v), nil
	case int64:
		return float64(v), nil
	case json.Number:
		return strconv.ParseFloat(v.String(), 64)
	case string:
		return strconv.ParseFloat(strings.TrimSpace(v), 64)
	default:
		return 0, fmt.Errorf("not a number")
	}
}

func canvasBoolParam(value any) (bool, error) {
	switch v := value.(type) {
	case bool:
		return v, nil
	case string:
		return strconv.ParseBool(strings.TrimSpace(v))
	default:
		return false, fmt.Errorf("not a boolean")
	}
}

func validateCanvasEnum(value any, schema map[string]any, path string) error {
	raw, ok := schema["enum"].([]any)
	if !ok || len(raw) == 0 {
		return nil
	}
	for _, allowed := range raw {
		switch v := value.(type) {
		case string:
			if allowedText, ok := allowed.(string); ok && v == allowedText {
				return nil
			}
		case float64:
			switch allowedNumber := allowed.(type) {
			case int:
				if v == float64(allowedNumber) {
					return nil
				}
			case float64:
				if v == allowedNumber {
					return nil
				}
			}
		}
	}
	return fmt.Errorf("%s must be one of %v", path, raw)
}
