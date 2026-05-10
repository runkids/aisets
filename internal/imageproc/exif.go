package imageproc

import (
	"os"
	"path/filepath"
	"strings"

	goexif "github.com/rwcarlsen/goexif/exif"
)

type EXIFData struct {
	HasEXIF          bool     `json:"hasExif"`
	GPSLatitude      *float64 `json:"gpsLatitude,omitempty"`
	GPSLongitude     *float64 `json:"gpsLongitude,omitempty"`
	CameraMake       string   `json:"cameraMake,omitempty"`
	CameraModel      string   `json:"cameraModel,omitempty"`
	DateTimeOriginal string   `json:"dateTimeOriginal,omitempty"`
	Orientation      int      `json:"orientation,omitempty"`
	DPIX             int      `json:"dpiX,omitempty"`
	DPIY             int      `json:"dpiY,omitempty"`
}

func ExtractEXIF(path string) (EXIFData, error) {
	var result EXIFData
	if err := runImgtoolsJSON(&result, "exif", path); err == nil {
		return result, nil
	}
	return extractEXIFGoFallback(path)
}

func extractEXIFGoFallback(path string) (EXIFData, error) {
	ext := strings.ToLower(filepath.Ext(path))
	if ext != ".jpg" && ext != ".jpeg" && ext != ".tiff" && ext != ".tif" {
		return EXIFData{}, nil
	}
	f, err := os.Open(path)
	if err != nil {
		return EXIFData{}, nil
	}
	defer f.Close()

	x, err := goexif.Decode(f)
	if err != nil {
		return EXIFData{}, nil
	}

	result := EXIFData{HasEXIF: true}
	if lat, lon, err := x.LatLong(); err == nil {
		result.GPSLatitude = &lat
		result.GPSLongitude = &lon
	}
	if tag, err := x.Get(goexif.Make); err == nil {
		result.CameraMake = strings.Trim(tag.String(), "\"")
	}
	if tag, err := x.Get(goexif.Model); err == nil {
		result.CameraModel = strings.Trim(tag.String(), "\"")
	}
	if t, err := x.DateTime(); err == nil {
		result.DateTimeOriginal = t.Format("2006-01-02T15:04:05")
	}
	if tag, err := x.Get(goexif.Orientation); err == nil {
		if v, err := tag.Int(0); err == nil {
			result.Orientation = v
		}
	}
	if tag, err := x.Get(goexif.XResolution); err == nil {
		if num, denom, err := tag.Rat2(0); err == nil && denom != 0 {
			result.DPIX = int(num / denom)
		}
	}
	if tag, err := x.Get(goexif.YResolution); err == nil {
		if num, denom, err := tag.Rat2(0); err == nil && denom != 0 {
			result.DPIY = int(num / denom)
		}
	}
	return result, nil
}
