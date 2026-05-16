package server

import (
	"image"
	"image/color"
	"math"
	"sort"
	"strings"
)

func inferCanvasTextRegionFromImage(img image.Image, bounds image.Rectangle, region canvasRegion, cue canvasRegionVisualCue) (canvasRegion, bool) {
	width := bounds.Dx()
	height := bounds.Dy()
	if width <= 0 || height <= 0 {
		return canvasRegion{}, false
	}
	colors := canvasCandidateTextColors(img, bounds, cue)
	if len(colors) == 0 {
		return canvasRegion{}, false
	}

	var best canvasTextRegionCandidate
	bestScore := math.Inf(1)
	fullSearch := image.Rect(0, 0, width, height)
	minPixels := minCanvasRegionColorMatchPixels(width, height)
	for _, candidateColor := range colors {
		components := canvasColorComponents(img, bounds, fullSearch, candidateColor, minPixels)
		for _, candidate := range canvasTextRegionCandidatesFromColorComponents(components, region, width, height, candidateColor, cue) {
			if candidate.Score < bestScore {
				best = candidate
				bestScore = candidate.Score
			}
		}
	}
	if math.IsInf(bestScore, 1) {
		return canvasRegion{}, false
	}
	return clampCanvasRegion(best.Region), true
}

type canvasTextColorBucket struct {
	Key   int
	Count int
	R     int
	G     int
	B     int
}

func canvasCandidateTextColors(img image.Image, bounds image.Rectangle, cue canvasRegionVisualCue) []color.RGBA {
	buckets := map[int]*canvasTextColorBucket{}
	for y := 0; y < bounds.Dy(); y++ {
		for x := 0; x < bounds.Dx(); x++ {
			r16, g16, b16, a16 := img.At(bounds.Min.X+x, bounds.Min.Y+y).RGBA()
			if a16 < 0x4000 {
				continue
			}
			r := int(r16 >> 8)
			g := int(g16 >> 8)
			b := int(b16 >> 8)
			key := ((r / 32) << 6) | ((g / 32) << 3) | (b / 32)
			bucket := buckets[key]
			if bucket == nil {
				bucket = &canvasTextColorBucket{Key: key}
				buckets[key] = bucket
			}
			bucket.Count++
			bucket.R += r
			bucket.G += g
			bucket.B += b
		}
	}

	ranked := make([]*canvasTextColorBucket, 0, len(buckets))
	for _, bucket := range buckets {
		if bucket.Count < 4 {
			continue
		}
		ranked = append(ranked, bucket)
	}
	sort.Slice(ranked, func(i, j int) bool {
		return canvasTextColorBucketRank(ranked[i]) > canvasTextColorBucketRank(ranked[j])
	})

	colors := make([]color.RGBA, 0, min(len(ranked)+1, 32))
	if cue.HasColor {
		colors = append(colors, cue.Color)
	}
	for _, bucket := range ranked {
		if len(colors) >= 32 {
			break
		}
		c := color.RGBA{
			R: uint8(bucket.R / bucket.Count),
			G: uint8(bucket.G / bucket.Count),
			B: uint8(bucket.B / bucket.Count),
			A: 255,
		}
		if canvasColorAlreadyIncluded(colors, c) {
			continue
		}
		colors = append(colors, c)
	}
	return colors
}

func canvasTextColorBucketRank(bucket *canvasTextColorBucket) float64 {
	if bucket == nil || bucket.Count == 0 {
		return 0
	}
	r := float64(bucket.R / bucket.Count)
	g := float64(bucket.G / bucket.Count)
	b := float64(bucket.B / bucket.Count)
	maxC := math.Max(r, math.Max(g, b))
	minC := math.Min(r, math.Min(g, b))
	saturation := maxC - minC
	luma := 0.2126*r + 0.7152*g + 0.0722*b
	contrast := math.Max(math.Abs(luma-255), math.Abs(luma-0)) / 255
	return float64(bucket.Count) * (1 + saturation/255 + contrast*0.45)
}

func canvasColorAlreadyIncluded(colors []color.RGBA, candidate color.RGBA) bool {
	for _, existing := range colors {
		if canvasColorDistance(existing, candidate) <= 38 {
			return true
		}
	}
	return false
}

func canvasColorDistance(a color.RGBA, b color.RGBA) float64 {
	dr := float64(int(a.R) - int(b.R))
	dg := float64(int(a.G) - int(b.G))
	db := float64(int(a.B) - int(b.B))
	return math.Sqrt(dr*dr + dg*dg + db*db)
}

func canvasTextRegionCandidatesFromColorComponents(components []canvasColorComponent, region canvasRegion, width, height int, candidateColor color.RGBA, cue canvasRegionVisualCue) []canvasTextRegionCandidate {
	clusters := canvasTextComponentClusters(components, width, height)
	if len(clusters) == 0 {
		return nil
	}
	regionCenterX := region.X + region.Width/2
	regionCenterY := region.Y + region.Height/2
	totalAreaPx := float64(width * height)
	var candidates []canvasTextRegionCandidate
	for _, cluster := range clusters {
		if len(cluster) < 2 {
			continue
		}
		minX, minY := width, height
		maxX, maxY := -1, -1
		pixels := 0
		for _, component := range cluster {
			minX = min(minX, component.MinX)
			minY = min(minY, component.MinY)
			maxX = max(maxX, component.MaxX)
			maxY = max(maxY, component.MaxY)
			pixels += component.Pixels
		}
		if maxX < minX || maxY < minY {
			continue
		}
		clusterBox := canvasColorComponent{MinX: minX, MinY: minY, MaxX: maxX, MaxY: maxY, Pixels: pixels}
		boxArea := float64(clusterBox.boxArea())
		if boxArea <= 0 || boxArea > totalAreaPx*0.18 {
			continue
		}
		refined := canvasRegionFromColorComponent(clusterBox, width, height)
		if refined.Width > 0.72 || refined.Height > 0.68 {
			continue
		}
		if refined.Width > 0.35 && refined.Height > 0.45 {
			continue
		}
		if canvasTextRegionLooksLikeEdgeDecoration(refined) {
			continue
		}
		centerX := refined.X + refined.Width/2
		centerY := refined.Y + refined.Height/2
		dist := math.Hypot(centerX-regionCenterX, centerY-regionCenterY)
		density := float64(pixels) / boxArea
		elongation := math.Max(refined.Width/math.Max(refined.Height, 0.001), refined.Height/math.Max(refined.Width, 0.001))
		componentBonus := math.Log1p(float64(len(cluster))) * 0.42
		pixelBonus := math.Min(math.Log1p(float64(pixels))/8, 0.7) * 0.28
		shapeBonus := math.Min(elongation, 5) * 0.07
		densePenalty := math.Max(density-0.72, 0) * 0.45
		areaPenalty := boxArea / totalAreaPx * 1.4
		cueColorBonus := 0.0
		if cue.HasColor && canvasColorDistance(candidateColor, cue.Color) <= 70 {
			cueColorBonus = 0.06
		}
		score := dist*0.45 + areaPenalty + densePenalty - componentBonus - pixelBonus - shapeBonus - cueColorBonus
		candidates = append(candidates, canvasTextRegionCandidate{
			Region:         refined,
			Color:          candidateColor,
			ComponentCount: len(cluster),
			Pixels:         pixels,
			BoxArea:        boxArea,
			Score:          score,
		})
	}
	return candidates
}

func canvasTextRegionLooksLikeEdgeDecoration(region canvasRegion) bool {
	if region.Width >= 0.16 || region.Height <= 0.22 {
		return false
	}
	return region.X <= 0.08 || region.X+region.Width >= 0.92
}

func bestCanvasTextRegionFromColorComponents(components []canvasColorComponent, region canvasRegion, width, height int) (canvasRegion, bool) {
	clusters := canvasTextComponentClusters(components, width, height)
	if len(clusters) == 0 {
		return canvasRegion{}, false
	}
	regionCenterX := region.X + region.Width/2
	regionCenterY := region.Y + region.Height/2
	totalAreaPx := float64(width * height)

	var best canvasRegion
	bestScore := math.Inf(1)
	for _, cluster := range clusters {
		if len(cluster) < 2 {
			continue
		}
		minX, minY := width, height
		maxX, maxY := -1, -1
		pixels := 0
		for _, component := range cluster {
			minX = min(minX, component.MinX)
			minY = min(minY, component.MinY)
			maxX = max(maxX, component.MaxX)
			maxY = max(maxY, component.MaxY)
			pixels += component.Pixels
		}
		if maxX < minX || maxY < minY {
			continue
		}
		clusterBox := canvasColorComponent{MinX: minX, MinY: minY, MaxX: maxX, MaxY: maxY, Pixels: pixels}
		boxArea := float64(clusterBox.boxArea())
		if boxArea <= 0 || boxArea > totalAreaPx*0.18 {
			continue
		}
		refined := canvasRegionFromColorComponent(clusterBox, width, height)
		if refined.Width > 0.75 || refined.Height > 0.8 {
			continue
		}
		centerX := refined.X + refined.Width/2
		centerY := refined.Y + refined.Height/2
		dist := math.Hypot(centerX-regionCenterX, centerY-regionCenterY)
		density := float64(pixels) / boxArea
		elongation := math.Max(refined.Width/math.Max(refined.Height, 0.001), refined.Height/math.Max(refined.Width, 0.001))
		score := dist*0.12 - float64(len(cluster))*0.55 - math.Min(elongation, 5)*0.08 - density*0.2
		if score < bestScore {
			best = refined
			bestScore = score
		}
	}
	return clampCanvasRegion(best), !math.IsInf(bestScore, 1)
}

func canvasTextComponentClusters(components []canvasColorComponent, width, height int) [][]canvasColorComponent {
	totalArea := width * height
	filtered := make([]canvasColorComponent, 0, len(components))
	for _, component := range components {
		if component.boxArea() > max(16, totalArea/12) {
			continue
		}
		if component.width() > max(12, width/3) || component.height() > max(12, height/3) {
			continue
		}
		filtered = append(filtered, component)
	}
	visited := make([]bool, len(filtered))
	var clusters [][]canvasColorComponent
	for i := range filtered {
		if visited[i] {
			continue
		}
		visited[i] = true
		cluster := []canvasColorComponent{filtered[i]}
		queue := []int{i}
		for len(queue) > 0 {
			current := queue[len(queue)-1]
			queue = queue[:len(queue)-1]
			for next := range filtered {
				if visited[next] {
					continue
				}
				if !canvasTextComponentsNear(filtered[current], filtered[next], width, height) {
					continue
				}
				visited[next] = true
				cluster = append(cluster, filtered[next])
				queue = append(queue, next)
			}
		}
		clusters = append(clusters, cluster)
	}
	return clusters
}

func canvasTextComponentsNear(a, b canvasColorComponent, width, height int) bool {
	ax := float64(a.MinX+a.MaxX+1) / 2
	ay := float64(a.MinY+a.MaxY+1) / 2
	bx := float64(b.MinX+b.MaxX+1) / 2
	by := float64(b.MinY+b.MaxY+1) / 2
	xClose := math.Abs(ax-bx) <= math.Max(float64(max(a.width(), b.width()))*0.9, float64(width)*0.08)
	yClose := math.Abs(ay-by) <= math.Max(float64(max(a.height(), b.height()))*0.9, float64(height)*0.08)
	xGap := float64(max(max(a.MinX-b.MaxX-1, b.MinX-a.MaxX-1), 0))
	yGap := float64(max(max(a.MinY-b.MaxY-1, b.MinY-a.MaxY-1), 0))
	verticalStack := xClose && yGap <= math.Max(float64(max(a.height(), b.height()))*0.7, float64(height)*0.045)
	horizontalRun := yClose && xGap <= math.Min(float64(max(a.width(), b.width()))*0.8, float64(width)*0.08)
	return verticalStack || horizontalRun
}

func canvasTextRegionFromColorComponents(components []canvasColorComponent, region canvasRegion, width, height int) (canvasRegion, bool) {
	regionCenterX := region.X + region.Width/2
	regionCenterY := region.Y + region.Height/2
	regionAreaPx := math.Max(1, region.Width*float64(width)*region.Height*float64(height))
	totalAreaPx := float64(width * height)
	maxBoxArea := math.Max(regionAreaPx*18, totalAreaPx*0.08)
	maxCenterDist := math.Max(math.Hypot(region.Width, region.Height)*1.8, 0.18)

	minX, minY := width, height
	maxX, maxY := -1, -1
	kept := 0
	for _, component := range components {
		if float64(component.boxArea()) > maxBoxArea {
			continue
		}
		centerX := (float64(component.MinX+component.MaxX) + 1) / 2 / float64(width)
		centerY := (float64(component.MinY+component.MaxY) + 1) / 2 / float64(height)
		if math.Hypot(centerX-regionCenterX, centerY-regionCenterY) > maxCenterDist {
			continue
		}
		minX = min(minX, component.MinX)
		minY = min(minY, component.MinY)
		maxX = max(maxX, component.MaxX)
		maxY = max(maxY, component.MaxY)
		kept++
	}
	if kept == 0 || maxX < minX || maxY < minY {
		return canvasRegion{}, false
	}
	refined := canvasRegionFromColorComponent(canvasColorComponent{MinX: minX, MinY: minY, MaxX: maxX, MaxY: maxY}, width, height)
	if refined.Width > 0.75 || refined.Height > 0.45 {
		return canvasRegion{}, false
	}
	return clampCanvasRegion(refined), true
}

func canvasRegionFromColorComponent(component canvasColorComponent, width, height int) canvasRegion {
	padding := max(2, min(8, max(component.width(), component.height())/4))
	minX := max(component.MinX-padding, 0)
	minY := max(component.MinY-padding, 0)
	maxX := min(component.MaxX+padding+1, width)
	maxY := min(component.MaxY+padding+1, height)
	return canvasRegion{
		X:      float64(minX) / float64(width),
		Y:      float64(minY) / float64(height),
		Width:  float64(maxX-minX) / float64(width),
		Height: float64(maxY-minY) / float64(height),
	}
}

func canvasVisualCueLooksLikeText(cue canvasRegionVisualCue) bool {
	text := strings.ToLower(cue.TargetDescription)
	return strings.Contains(text, "text") ||
		strings.Contains(text, "letter") ||
		strings.Contains(text, "word") ||
		strings.Contains(text, "glyph") ||
		strings.Contains(text, "character") ||
		strings.Contains(text, "writing") ||
		strings.Contains(text, "typography") ||
		strings.Contains(text, "ocr")
}

func canvasVisualCueLooksSmall(cue canvasRegionVisualCue) bool {
	text := strings.ToLower(cue.TargetDescription)
	return strings.Contains(text, "small") ||
		strings.Contains(text, "icon") ||
		strings.Contains(text, "symbol") ||
		strings.Contains(text, "mark") ||
		strings.Contains(text, "detail")
}

func canvasRegionSearchRect(region canvasRegion, width, height int) image.Rectangle {
	cx := region.X + region.Width/2
	cy := region.Y + region.Height/2
	searchW := max(region.Width*6, 0.28)
	searchH := max(region.Height*6, 0.24)
	left := int((cx - searchW/2) * float64(width))
	top := int((cy - searchH/2) * float64(height))
	right := int((cx + searchW/2) * float64(width))
	bottom := int((cy + searchH/2) * float64(height))
	return image.Rect(
		max(left, 0),
		max(top, 0),
		min(right, width),
		min(bottom, height),
	)
}

func canvasPixelMatchesColor(c color.Color, target color.RGBA) bool {
	r16, g16, b16, a16 := c.RGBA()
	if a16 < 0x4000 {
		return false
	}
	r := int(r16 >> 8)
	g := int(g16 >> 8)
	b := int(b16 >> 8)
	dr := r - int(target.R)
	dg := g - int(target.G)
	db := b - int(target.B)
	dist2 := dr*dr + dg*dg + db*db
	return dist2 <= 95*95
}

func minCanvasRegionColorMatchPixels(width, height int) int {
	return max(4, (width*height)/2500)
}
