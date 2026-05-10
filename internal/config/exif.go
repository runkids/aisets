package config

import (
	"database/sql"

	"aisets/internal/imageproc"
)

type EXIFRecord struct {
	AssetID          string
	HasGPS           bool
	GPSLatitude      *float64
	GPSLongitude     *float64
	CameraMake       string
	CameraModel      string
	DateTimeOriginal string
	Orientation      int
	DPIX             int
	DPIY             int
}

func (s *Store) recordEXIFBatch(tx *sql.Tx, scanID int64, records []EXIFRecord) error {
	if len(records) == 0 {
		return nil
	}
	stmt, err := tx.Prepare(`
		INSERT INTO exif_data (scan_id, asset_id, has_gps, gps_latitude, gps_longitude,
			camera_make, camera_model, datetime_original, orientation, dpi_x, dpi_y)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, r := range records {
		hasGPS := 0
		if r.HasGPS {
			hasGPS = 1
		}
		if _, err := stmt.Exec(scanID, r.AssetID, hasGPS, r.GPSLatitude, r.GPSLongitude,
			r.CameraMake, r.CameraModel, r.DateTimeOriginal, r.Orientation, r.DPIX, r.DPIY); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) CatalogEXIFEnrich(scanID int64, assetIDs []string) (map[string]*imageproc.EXIFData, error) {
	if len(assetIDs) == 0 {
		return nil, nil
	}
	idClause, idArgs := inClauseSQL("asset_id", assetIDs)
	args := append([]any{scanID}, idArgs...)
	rows, err := s.rdb.Query(`SELECT asset_id, has_gps, gps_latitude, gps_longitude, camera_make, camera_model,
		datetime_original, orientation, dpi_x, dpi_y
		FROM exif_data WHERE scan_id = ? AND `+idClause, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make(map[string]*imageproc.EXIFData, len(assetIDs))
	for rows.Next() {
		var (
			assetID    string
			hasGPS     int
			lat, lon   sql.NullFloat64
			make_      string
			model      string
			dt         string
			orient     int
			dpiX, dpiY int
		)
		if err := rows.Scan(&assetID, &hasGPS, &lat, &lon, &make_, &model, &dt, &orient, &dpiX, &dpiY); err != nil {
			return nil, err
		}
		data := &imageproc.EXIFData{
			HasEXIF:          true,
			CameraMake:       make_,
			CameraModel:      model,
			DateTimeOriginal: dt,
			Orientation:      orient,
			DPIX:             dpiX,
			DPIY:             dpiY,
		}
		if hasGPS == 1 && lat.Valid && lon.Valid {
			data.GPSLatitude = &lat.Float64
			data.GPSLongitude = &lon.Float64
		}
		result[assetID] = data
	}
	return result, rows.Err()
}

type EXIFFacets struct {
	HasGPS    int `json:"hasGps"`
	HasCamera int `json:"hasCamera"`
}

func (s *Store) CatalogEXIFFacetCounts(scanID int64, projectName, ext string) (EXIFFacets, error) {
	baseWhere := "e.scan_id = ?"
	args := []any{scanID}
	if projectName != "" {
		baseWhere += " AND EXISTS (SELECT 1 FROM asset_snapshots a WHERE a.scan_id = e.scan_id AND a.asset_id = e.asset_id AND a.project_name = ?)"
		args = append(args, projectName)
	}
	if ext != "" {
		baseWhere += " AND EXISTS (SELECT 1 FROM asset_snapshots a WHERE a.scan_id = e.scan_id AND a.asset_id = e.asset_id AND a.ext = ?)"
		args = append(args, ext)
	}
	var facets EXIFFacets
	row := s.rdb.QueryRow(`SELECT COUNT(*) FROM exif_data e WHERE `+baseWhere+` AND e.has_gps = 1`, args...)
	_ = row.Scan(&facets.HasGPS)
	row = s.rdb.QueryRow(`SELECT COUNT(*) FROM exif_data e WHERE `+baseWhere+` AND (e.camera_make != '' OR e.camera_model != '')`, args...)
	_ = row.Scan(&facets.HasCamera)
	return facets, nil
}
