package server

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func writeCanvasRegionFixturePNG(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	img := image.NewNRGBA(image.Rect(0, 0, 100, 100))
	for y := 0; y < 100; y++ {
		for x := 0; x < 100; x++ {
			img.Set(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: 0})
		}
	}
	for y := 12; y < 38; y++ {
		for x := 38; x < 58; x++ {
			img.Set(x, y, color.NRGBA{R: 20, G: 25, B: 32, A: 255})
		}
	}
	for y := 12; y < 38; y++ {
		for x := 50; x < 66; x++ {
			img.Set(x, y, color.NRGBA{R: 242, G: 106, B: 160, A: 255})
		}
	}
	for y := 21; y < 28; y++ {
		for x := 32; x < 39; x++ {
			img.Set(x, y, color.NRGBA{R: 242, G: 106, B: 160, A: 255})
		}
	}
	if err := png.Encode(file, img); err != nil {
		t.Fatal(err)
	}
}

func writeCanvasTextRegionFixturePNG(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	img := image.NewNRGBA(image.Rect(0, 0, 120, 120))
	for y := 0; y < 120; y++ {
		for x := 0; x < 120; x++ {
			img.Set(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: 0})
		}
	}
	// Non-text white headband near the wrong model-provided region.
	for y := 42; y < 57; y++ {
		for x := 32; x < 68; x++ {
			img.Set(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: 255})
		}
	}
	// Three white glyph-like components on a sign far from the wrong region.
	for y := 16; y < 30; y++ {
		for x := 82; x < 96; x++ {
			img.Set(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: 255})
		}
	}
	for y := 42; y < 62; y++ {
		for x := 80; x < 100; x++ {
			img.Set(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: 255})
		}
	}
	for y := 76; y < 84; y++ {
		for x := 82; x < 99; x++ {
			img.Set(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: 255})
		}
	}
	if err := png.Encode(file, img); err != nil {
		t.Fatal(err)
	}
}

func writeCanvasRedTextWithWhiteDistractorPNG(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	img := image.NewNRGBA(image.Rect(0, 0, 120, 120))
	for y := 0; y < 120; y++ {
		for x := 0; x < 120; x++ {
			img.Set(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: 0})
		}
	}
	// Wrong-color distractor that should not win when the model guesses white text.
	for y := 58; y < 75; y++ {
		for x := 34; x < 48; x++ {
			img.Set(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: 255})
		}
	}
	for y := 58; y < 75; y++ {
		for x := 54; x < 68; x++ {
			img.Set(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: 255})
		}
	}
	// Tall spine-like decoration must not be mistaken for the title text.
	for _, top := range []int{12, 25, 38, 51, 64, 77, 90} {
		for y := top; y < top+5; y++ {
			for x := 5; x < 11; x++ {
				img.Set(x, y, color.NRGBA{R: 214, G: 38, B: 34, A: 255})
			}
		}
	}
	// Same-color non-text artwork below the title must not be merged into the text box.
	for y := 64; y < 94; y++ {
		for x := 50; x < 78; x++ {
			img.Set(x, y, color.NRGBA{R: 214, G: 38, B: 34, A: 255})
		}
	}
	// Red glyph-like title components near the top of the image.
	for _, left := range []int{24, 39, 54, 69} {
		for y := 16; y < 39; y++ {
			for x := left; x < left+11; x++ {
				img.Set(x, y, color.NRGBA{R: 214, G: 38, B: 34, A: 255})
			}
		}
	}
	if err := png.Encode(file, img); err != nil {
		t.Fatal(err)
	}
}

func canvasHarnessDefaultArgs(tool, assetA, assetB string) map[string]any {
	switch tool {
	case "focus_card":
		return map[string]any{"cardId": "card-a", "label": "Focus asset A"}
	case "search_assets":
		return map[string]any{"q": "img", "limit": float64(2)}
	case "add_assets_to_canvas":
		return map[string]any{"assetIds": []any{assetA}, "label": "Add asset A"}
	case "extract_ocr_text":
		return map[string]any{"assetIds": []any{assetA}, "mode": "vlm", "saveToMetadata": false}
	case "get_asset_detail":
		return map[string]any{"assetId": assetA}
	case "create_comment":
		return map[string]any{"anchorCardId": "card-a", "text": "Mark this region", "region": map[string]any{"x": 0.1, "y": 0.2, "width": 0.3, "height": 0.4}}
	case "update_comment":
		return map[string]any{"commentCardId": "comment-a", "text": "Updated note", "region": map[string]any{"x": 0.2, "y": 0.3, "width": 0.4, "height": 0.2}}
	case "delete_comment":
		return map[string]any{"commentCardId": "comment-a"}
	case "select_cards", "remove_cards":
		return map[string]any{"cardIds": []any{"card-a", "card-b"}, "label": "Target both cards"}
	case "duplicate_cards":
		return map[string]any{"cardIds": []any{"card-a"}, "count": float64(2), "layout": "row", "label": "Duplicate asset A"}
	case "move_card":
		return map[string]any{"cardId": "card-a", "x": float64(400), "y": float64(120)}
	case "arrange_cards":
		return map[string]any{"positions": []any{
			map[string]any{"cardId": "card-a", "x": float64(20), "y": float64(20)},
			map[string]any{"cardId": "card-b", "x": float64(360), "y": float64(20)},
		}}
	case "align_cards":
		return map[string]any{"cardIds": []any{"card-a", "card-b"}, "axis": "top", "label": "Align tops"}
	case "distribute_cards":
		return map[string]any{"cardIds": []any{"card-a", "card-b", "comment-a"}, "direction": "horizontal", "gap": float64(80), "label": "Distribute cards"}
	case "resize_card":
		return map[string]any{"cardId": "card-a", "width": float64(320)}
	case "bring_cards_to_front":
		return map[string]any{"cardIds": []any{"card-a"}, "afterCardId": "card-b", "label": "Layer asset A above asset B"}
	case "inspect_canvas":
		return map[string]any{"reason": "Check spacing"}
	case "capture_viewport", "capture_canvas", "capture_selected":
		return map[string]any{"transparent": true}
	case "compare_assets", "find_similar_assets", "inspect_image_quality", "generate_alt_text":
		args := map[string]any{"assetIds": []any{assetA, assetB}}
		if tool == "find_similar_assets" {
			args["limit"] = float64(5)
		}
		if tool == "generate_alt_text" {
			args["style"] = "concise"
		}
		return args
	case "compress_image":
		return map[string]any{"assetIds": []any{assetA}, "outputFormat": "webp", "quality": float64(82)}
	case "resize_image":
		return map[string]any{"assetIds": []any{assetA}, "maxDimensionPx": float64(1200)}
	case "convert_image":
		return map[string]any{"assetIds": []any{assetA}, "outputFormat": "jpg"}
	case "mirror_image":
		return map[string]any{"assetIds": []any{assetA}, "flip": "horizontal", "outputFormat": "png"}
	case "rotate_image":
		return map[string]any{"assetIds": []any{assetA}, "degrees": float64(90), "outputFormat": "png"}
	case "update_tags":
		return map[string]any{"assetIds": []any{assetA}, "tags": []any{"hero", "test"}}
	case "batch_update_tags":
		return map[string]any{"assetIds": []any{assetA, assetB}, "tags": []any{"batch", "test"}}
	case "update_description":
		return map[string]any{"assetIds": []any{assetA}, "description": "Updated description"}
	case "update_ocr_text":
		return map[string]any{"assetIds": []any{assetA}, "text": "Updated OCR text"}
	case "rename_asset":
		return map[string]any{"assetId": assetA, "newName": "renamed.png"}
	case "move_asset":
		return map[string]any{"assetIds": []any{assetA}, "destDir": "assets/icons"}
	case "copy_asset":
		return map[string]any{"assetIds": []any{assetA}, "destPath": "exports/a.png"}
	case "delete_asset":
		return map[string]any{"assetIds": []any{assetA}}
	case "favorite_asset":
		return map[string]any{"assetIds": []any{assetA}, "favorite": true}
	case "batch_favorite_assets":
		return map[string]any{"assetIds": []any{assetA, assetB}, "favorite": true}
	case "export_asset":
		return map[string]any{"assetIds": []any{assetA}, "outputDir": "exports"}
	default:
		return map[string]any{}
	}
}

func canvasHarnessMessageForTool(tool string) string {
	switch tool {
	case "create_comment":
		return "annotate this image"
	case "compress_image":
		return "compress this asset to webp"
	case "resize_image":
		return "resize this asset"
	case "convert_image":
		return "convert this asset to jpg"
	case "mirror_image":
		return "mirror this asset"
	case "rotate_image":
		return "rotate this asset"
	case "update_tags", "batch_update_tags":
		return "update tags on these assets"
	case "update_description":
		return "save a description for this asset"
	case "update_ocr_text":
		return "save OCR text for this asset"
	case "rename_asset":
		return "rename this asset"
	case "move_asset":
		return "move this asset"
	case "copy_asset":
		return "copy this asset"
	case "delete_asset":
		return "delete this asset"
	case "favorite_asset", "batch_favorite_assets":
		return "favorite this asset"
	case "export_asset":
		return "export this asset"
	default:
		return "use the canvas tool"
	}
}
