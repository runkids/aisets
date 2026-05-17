package server

import (
	"fmt"
	"sort"
	"strings"
)

func withCanvasToolParameters(tools []canvasToolDef) []canvasToolDef {
	for i := range tools {
		tools[i].Parameters = canvasToolParameters(tools[i].Name)
	}
	return tools
}

func canvasToolParamsText(schema map[string]any) string {
	if schema == nil {
		return "{}"
	}
	return canvasSchemaPromptText(schema, false)
}

func canvasSchemaPromptText(schema map[string]any, required bool) string {
	kind, _ := schema["type"].(string)
	var text string
	switch kind {
	case "object":
		props, _ := schema["properties"].(map[string]any)
		if len(props) == 0 {
			text = "{}"
			break
		}
		requiredKeys := map[string]bool{}
		for _, key := range canvasSchemaRequired(schema) {
			requiredKeys[key] = true
		}
		keys := make([]string, 0, len(props))
		for key := range props {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, key := range keys {
			propSchema, ok := props[key].(map[string]any)
			if !ok {
				continue
			}
			parts = append(parts, fmt.Sprintf("%q: %s", key, canvasSchemaPromptText(propSchema, requiredKeys[key])))
		}
		text = "{" + strings.Join(parts, ", ") + "}"
	case "array":
		itemSchema, _ := schema["items"].(map[string]any)
		text = "[" + canvasSchemaPromptText(itemSchema, false) + "]"
	case "string", "number", "integer", "boolean":
		text = canvasSchemaScalarPromptText(schema, kind)
	default:
		text = "any"
	}
	notes := canvasSchemaPromptNotes(schema, required)
	if len(notes) == 0 {
		return text
	}
	return fmt.Sprintf("%s (%s)", text, strings.Join(notes, "; "))
}

func canvasSchemaScalarPromptText(schema map[string]any, kind string) string {
	rawEnum, ok := schema["enum"].([]any)
	if !ok || len(rawEnum) == 0 {
		return kind
	}
	values := make([]string, 0, len(rawEnum))
	for _, value := range rawEnum {
		values = append(values, fmt.Sprint(value))
	}
	return strings.Join(values, "|")
}

func canvasSchemaPromptNotes(schema map[string]any, required bool) []string {
	var notes []string
	if required {
		notes = append(notes, "required")
	}
	if description, _ := schema["description"].(string); strings.TrimSpace(description) != "" {
		notes = append(notes, strings.TrimSpace(description))
	}
	return notes
}

func canvasToolParameters(name string) map[string]any {
	switch name {
	case "focus_card":
		return canvasObjectSchema([]string{"cardId"}, map[string]any{
			"cardId": canvasStringSchema("Canvas card ID to focus."),
		})
	case "search_assets":
		return canvasObjectSchema(nil, map[string]any{
			"q":       canvasStringSchema("Catalog search query. Use an empty string with hasText=true to list all assets that already have readable OCR text."),
			"limit":   canvasIntegerSchema("Maximum result count."),
			"hasText": canvasBooleanSchema("When true, return assets that have ready non-empty OCR text."),
		})
	case "add_assets_to_canvas":
		return canvasObjectSchema([]string{"assetIds"}, canvasAssetTargetProperties(nil))
	case "extract_ocr_text":
		return canvasObjectSchema(nil, canvasMixedImageTargetProperties(map[string]any{
			"mode":           canvasStringEnumSchema("OCR mode.", "vlm"),
			"saveToMetadata": canvasBooleanSchema("Whether to save OCR into metadata."),
		}))
	case "get_asset_detail":
		return canvasObjectSchema([]string{"assetId"}, map[string]any{
			"assetId": canvasStringSchema("Catalog asset ID."),
		})
	case "create_comment":
		return canvasObjectSchema([]string{"anchorCardId", "text"}, map[string]any{
			"anchorCardId": canvasStringSchema("Canvas card ID to attach the comment to."),
			"text":         canvasStringSchema("Comment text."),
			"region":       canvasRegionSchema("Normalized bounding box for one exact visual object or area being annotated, relative to the anchored card image, not the whole canvas screenshot. If the target sits on a host object, box only the requested target, not the host or surrounding context. For multiple targets, call create_comment once per target."),
			"visualCue":    canvasVisualCueSchema("Optional English-only visual cue for region refinement. Use this for small objects or text so the tool can snap the region to the actual target pixels."),
		})
	case "update_comment":
		return canvasObjectSchema([]string{"commentCardId"}, map[string]any{
			"commentCardId": canvasStringSchema("Comment card ID."),
			"text":          canvasStringSchema("Optional replacement comment text."),
			"region":        canvasRegionSchema("Optional replacement normalized bounding box for the exact visual object or area being annotated, relative to the existing comment anchor image. If the target sits on a host object, box only the requested target, not the host or surrounding context."),
			"visualCue":     canvasVisualCueSchema("Optional English-only visual cue for region refinement. Use this for small objects or text so the tool can snap the region to the actual target pixels."),
		})
	case "delete_comment":
		return canvasObjectSchema([]string{"commentCardId"}, map[string]any{
			"commentCardId": canvasStringSchema("Comment card ID."),
		})
	case "select_cards", "remove_cards":
		return canvasObjectSchema([]string{"cardIds"}, map[string]any{
			"cardIds": canvasStringArraySchema("Canvas card IDs."),
		})
	case "duplicate_cards":
		return canvasObjectSchema(nil, canvasCardTargetProperties(map[string]any{
			"count":  canvasIntegerSchema("Number of new copies per source card."),
			"layout": canvasStringSchema("Optional layout hint such as row, walk, or scatter."),
		}))
	case "group_cards":
		return canvasObjectSchema([]string{"cardIds"}, map[string]any{
			"cardIds": canvasStringArraySchema("Two or more image canvas card IDs to group."),
			"name":    canvasStringSchema("Optional group name/label."),
		})
	case "ungroup_card":
		return canvasObjectSchema([]string{"cardId"}, map[string]any{
			"cardId": canvasStringSchema("Canvas group card ID to ungroup."),
		})
	case "rename_group":
		return canvasObjectSchema([]string{"cardId", "name"}, map[string]any{
			"cardId": canvasStringSchema("Canvas group card ID to rename."),
			"name":   canvasStringSchema("New group name/label."),
		})
	case "move_card":
		return canvasObjectSchema([]string{"cardId", "x", "y"}, map[string]any{
			"cardId": canvasStringSchema("Canvas card ID."),
			"x":      canvasNumberSchema("New top-left X coordinate."),
			"y":      canvasNumberSchema("New top-left Y coordinate."),
		})
	case "arrange_cards":
		return canvasObjectSchema([]string{"positions"}, map[string]any{
			"positions": canvasObjectArraySchema("Card positions.", []string{"cardId", "x", "y"}, map[string]any{
				"cardId": canvasStringSchema("Canvas card ID."),
				"x":      canvasNumberSchema("New top-left X coordinate."),
				"y":      canvasNumberSchema("New top-left Y coordinate."),
			}),
		})
	case "align_cards":
		return canvasObjectSchema([]string{"cardIds", "axis"}, map[string]any{
			"cardIds": canvasStringArraySchema("Canvas card IDs."),
			"axis":    canvasStringEnumSchema("Alignment axis.", "left", "center", "right", "top", "middle", "bottom"),
		})
	case "distribute_cards":
		return canvasObjectSchema([]string{"cardIds", "direction"}, map[string]any{
			"cardIds":   canvasStringArraySchema("Canvas card IDs."),
			"direction": canvasStringEnumSchema("Distribution direction.", "horizontal", "vertical"),
			"gap":       canvasNumberSchema("Optional gap in canvas pixels."),
		})
	case "resize_card":
		return canvasObjectSchema([]string{"cardId", "width"}, map[string]any{
			"cardId": canvasStringSchema("Canvas card ID."),
			"width":  canvasNumberSchema("Displayed card width in canvas pixels."),
		})
	case "bring_cards_to_front":
		return canvasObjectSchema([]string{"cardIds"}, map[string]any{
			"cardIds":     canvasStringArraySchema("Canvas card IDs to bring forward."),
			"afterCardId": canvasStringSchema("Optional target card ID these cards should be placed above."),
		})
	case "inspect_canvas":
		return canvasObjectSchema([]string{"reason"}, map[string]any{
			"reason": canvasStringSchema("What visual uncertainty needs inspection."),
		})
	case "capture_viewport", "capture_canvas", "capture_selected":
		return canvasObjectSchema(nil, map[string]any{
			"transparent": canvasBooleanSchema("Use transparent background when true."),
		})
	case "compare_assets":
		return canvasObjectSchema(nil, canvasAssetTargetProperties(nil))
	case "find_similar_assets":
		return canvasObjectSchema(nil, canvasAssetTargetProperties(map[string]any{
			"limit": canvasIntegerSchema("Maximum result count."),
		}))
	case "inspect_image_quality":
		return canvasObjectSchema([]string{"assetIds"}, canvasAssetTargetProperties(nil))
	case "generate_alt_text":
		return canvasObjectSchema(nil, canvasAssetTargetProperties(map[string]any{
			"style": canvasStringEnumSchema("Alt text style.", "concise", "descriptive"),
		}))
	case "compress_image":
		return canvasObjectSchema([]string{"assetIds", "outputFormat"}, canvasAssetTargetProperties(map[string]any{
			"outputFormat": canvasStringEnumSchema("Output image format.", "webp", "avif", "png"),
			"quality":      canvasIntegerSchema("Output quality from 1 to 100."),
		}))
	case "resize_image":
		return canvasObjectSchema([]string{"assetIds", "maxDimensionPx"}, canvasAssetTargetProperties(map[string]any{
			"maxDimensionPx": canvasIntegerSchema("Maximum longest-side dimension in pixels."),
		}))
	case "convert_image":
		return canvasObjectSchema([]string{"assetIds", "outputFormat"}, canvasAssetTargetProperties(map[string]any{
			"outputFormat": canvasStringEnumSchema("Output image format.", "webp", "avif", "png", "jpg"),
		}))
	case "mirror_image":
		return canvasObjectSchema([]string{"assetIds"}, canvasAssetTargetProperties(map[string]any{
			"flip":         canvasStringEnumSchema("Flip direction.", "horizontal", "vertical", "both"),
			"outputFormat": canvasStringEnumSchema("Optional output image format.", "png", "jpg", "webp", "avif"),
		}))
	case "rotate_image":
		return canvasObjectSchema([]string{"assetIds", "degrees"}, canvasAssetTargetProperties(map[string]any{
			"degrees":      canvasIntegerSchema("Clockwise rotation degrees. Use any integer angle from 0 to 359; default to 90 only when the user does not specify an angle."),
			"outputFormat": canvasStringEnumSchema("Optional output image format.", "png", "jpg", "webp", "avif"),
		}))
	case "update_tags":
		return canvasObjectSchema([]string{"tags"}, canvasAssetTargetProperties(map[string]any{
			"tags": canvasStringArraySchema("Replacement tags."),
		}))
	case "batch_update_tags":
		return canvasObjectSchema([]string{"assetIds", "tags"}, map[string]any{
			"assetIds": canvasStringArraySchema("Catalog asset IDs."),
			"tags":     canvasStringArraySchema("Replacement tags."),
		})
	case "update_description":
		return canvasObjectSchema(nil, canvasAssetTargetProperties(map[string]any{
			"description":          canvasStringSchema("Description to apply."),
			"perAssetDescriptions": canvasPerAssetTextArraySchema("description", "Per-asset descriptions."),
		}))
	case "update_ocr_text":
		return canvasObjectSchema(nil, canvasAssetTargetProperties(map[string]any{
			"text":          canvasStringSchema("OCR text to apply."),
			"perAssetTexts": canvasPerAssetTextArraySchema("text", "Per-asset OCR texts."),
		}))
	case "rename_asset":
		return canvasObjectSchema([]string{"assetId", "newName"}, map[string]any{
			"assetId": canvasStringSchema("Catalog asset ID."),
			"newName": canvasStringSchema("New filename with extension."),
		})
	case "move_asset":
		return canvasObjectSchema([]string{"destDir"}, canvasAssetTargetProperties(map[string]any{
			"destDir": canvasStringSchema("Destination directory path."),
		}))
	case "copy_asset":
		return canvasObjectSchema(nil, canvasAssetTargetProperties(map[string]any{
			"destPath":          canvasStringSchema("Full destination path including filename."),
			"destDir":           canvasStringSchema("Destination directory for batch copy."),
			"perAssetDestPaths": canvasPerAssetTextArraySchema("destPath", "Per-asset destination paths including filenames."),
		}))
	case "delete_asset":
		return canvasObjectSchema(nil, canvasAssetTargetProperties(nil))
	case "favorite_asset":
		return canvasObjectSchema([]string{"favorite"}, canvasAssetTargetProperties(map[string]any{
			"favorite": canvasBooleanSchema("Favorite status to apply."),
		}))
	case "batch_favorite_assets":
		return canvasObjectSchema([]string{"assetIds", "favorite"}, map[string]any{
			"assetIds": canvasStringArraySchema("Catalog asset IDs."),
			"favorite": canvasBooleanSchema("Favorite status to apply."),
		})
	case "export_asset":
		return canvasObjectSchema([]string{"outputDir"}, canvasAssetTargetProperties(map[string]any{
			"outputDir": canvasStringSchema("Output directory path."),
		}))
	default:
		return canvasObjectSchema(nil, map[string]any{})
	}
}

func canvasObjectSchema(required []string, properties map[string]any) map[string]any {
	if properties == nil {
		properties = map[string]any{}
	}
	schema := map[string]any{
		"type":                 "object",
		"properties":           properties,
		"additionalProperties": false,
	}
	if len(required) > 0 {
		schema["required"] = required
	}
	return schema
}

func canvasStringSchema(description string) map[string]any {
	return canvasTypedSchema("string", description)
}

func canvasNumberSchema(description string) map[string]any {
	return canvasTypedSchema("number", description)
}

func canvasIntegerSchema(description string) map[string]any {
	return canvasTypedSchema("integer", description)
}

func canvasBooleanSchema(description string) map[string]any {
	return canvasTypedSchema("boolean", description)
}

func canvasTypedSchema(kind, description string) map[string]any {
	schema := map[string]any{"type": kind}
	if description != "" {
		schema["description"] = description
	}
	return schema
}

func canvasStringEnumSchema(description string, values ...string) map[string]any {
	enum := make([]any, 0, len(values))
	for _, value := range values {
		enum = append(enum, value)
	}
	schema := canvasStringSchema(description)
	schema["enum"] = enum
	return schema
}

func canvasIntegerEnumSchema(description string, values ...int) map[string]any {
	enum := make([]any, 0, len(values))
	for _, value := range values {
		enum = append(enum, value)
	}
	schema := canvasIntegerSchema(description)
	schema["enum"] = enum
	return schema
}

func canvasStringArraySchema(description string) map[string]any {
	schema := map[string]any{
		"type":  "array",
		"items": canvasStringSchema(""),
	}
	if description != "" {
		schema["description"] = description
	}
	return schema
}

func canvasObjectArraySchema(description string, required []string, properties map[string]any) map[string]any {
	schema := map[string]any{
		"type":  "array",
		"items": canvasObjectSchema(required, properties),
	}
	if description != "" {
		schema["description"] = description
	}
	return schema
}

func canvasAssetTargetProperties(extra map[string]any) map[string]any {
	props := map[string]any{
		"assetIds": canvasStringArraySchema("Catalog asset IDs."),
		"assetId":  canvasStringSchema("Legacy single catalog asset ID."),
	}
	for key, value := range extra {
		props[key] = value
	}
	return props
}

func canvasCardTargetProperties(extra map[string]any) map[string]any {
	props := map[string]any{
		"cardIds": canvasStringArraySchema("Canvas card IDs."),
		"cardId":  canvasStringSchema("Legacy single canvas card ID."),
	}
	for key, value := range extra {
		props[key] = value
	}
	return props
}

func canvasMixedImageTargetProperties(extra map[string]any) map[string]any {
	props := canvasAssetTargetProperties(canvasCardTargetProperties(nil))
	for key, value := range extra {
		props[key] = value
	}
	return props
}

func canvasRegionSchema(description string) map[string]any {
	normalizedNumber := func(description string) map[string]any {
		schema := canvasNumberSchema(description)
		schema["minimum"] = 0
		schema["maximum"] = 1
		return schema
	}
	schema := canvasObjectSchema([]string{"x", "y", "width", "height"}, map[string]any{
		"x":      normalizedNumber("Normalized left edge of the target box, 0 to 1. This is the top-left corner, not the center point."),
		"y":      normalizedNumber("Normalized top edge of the target box, 0 to 1. Y increases downward. This is the top-left corner, not the center point."),
		"width":  normalizedNumber("Normalized target box width, 0 to 1. Use a tight box around only the visible target object or area. If the target sits on a host object, do not include the host or surrounding context. For text, box the glyphs/characters only, not the full sign, banner, label, or container."),
		"height": normalizedNumber("Normalized target box height, 0 to 1. Use a tight box around only the visible target object or area. If the target sits on a host object, do not include the host or surrounding context. For text, box the glyphs/characters only, not the full sign, banner, label, or container."),
	})
	if description != "" {
		schema["description"] = description
	}
	return schema
}

func canvasVisualCueSchema(description string) map[string]any {
	schema := canvasObjectSchema(nil, map[string]any{
		"targetDescription": canvasStringSchema("English-only description of the exact target pixels, not the host object."),
		"colorHex":          canvasStringSchema("Optional dominant target pixel color as #RRGGBB, for example #f26aa0 for a small pink mark or #ffffff for white text."),
	})
	if description != "" {
		schema["description"] = description
	}
	return schema
}

func canvasPerAssetTextArraySchema(field, description string) map[string]any {
	return canvasObjectArraySchema(description, []string{"assetId", field}, map[string]any{
		"assetId": canvasStringSchema("Catalog asset ID."),
		field:     canvasStringSchema("Text for this asset."),
	})
}
