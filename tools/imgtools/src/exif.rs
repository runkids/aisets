use anyhow::Result;
use serde::Serialize;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExifResult {
    pub has_exif: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gps_latitude: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gps_longitude: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub camera_make: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub camera_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_time_original: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orientation: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dpi_x: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dpi_y: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn run(input: &str) -> Result<()> {
    let result = extract(input);
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}

fn extract(path: &str) -> ExifResult {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if !matches!(
        ext.as_str(),
        "jpg" | "jpeg" | "tif" | "tiff" | "heic" | "heif"
    ) {
        return ExifResult::default();
    }

    let file = match File::open(path) {
        Ok(f) => f,
        Err(e) => {
            return ExifResult {
                error: Some(format!("failed to open file: {e}")),
                ..Default::default()
            };
        }
    };

    let exif_data = match exif::Reader::new().read_from_container(&mut BufReader::new(file)) {
        Ok(data) => data,
        Err(_) => {
            // No EXIF data found
            return ExifResult::default();
        }
    };

    let mut result = ExifResult {
        has_exif: true,
        ..Default::default()
    };

    // Camera make
    if let Some(field) = exif_data.get_field(exif::Tag::Make, exif::In::PRIMARY) {
        result.camera_make = Some(
            field
                .display_value()
                .to_string()
                .trim_matches('"')
                .to_string(),
        );
    }

    // Camera model
    if let Some(field) = exif_data.get_field(exif::Tag::Model, exif::In::PRIMARY) {
        result.camera_model = Some(
            field
                .display_value()
                .to_string()
                .trim_matches('"')
                .to_string(),
        );
    }

    // Date/time original
    if let Some(field) = exif_data.get_field(exif::Tag::DateTimeOriginal, exif::In::PRIMARY) {
        result.date_time_original = Some(
            field
                .display_value()
                .to_string()
                .trim_matches('"')
                .to_string(),
        );
    }

    // Orientation
    if let Some(field) = exif_data.get_field(exif::Tag::Orientation, exif::In::PRIMARY)
        && let exif::Value::Short(ref v) = field.value
        && let Some(&val) = v.first()
    {
        result.orientation = Some(u32::from(val));
    }

    // DPI (XResolution / YResolution)
    if let Some(field) = exif_data.get_field(exif::Tag::XResolution, exif::In::PRIMARY)
        && let exif::Value::Rational(ref v) = field.value
        && let Some(r) = v.first()
    {
        result.dpi_x = r.num.checked_div(r.denom);
    }
    if let Some(field) = exif_data.get_field(exif::Tag::YResolution, exif::In::PRIMARY)
        && let exif::Value::Rational(ref v) = field.value
        && let Some(r) = v.first()
    {
        result.dpi_y = r.num.checked_div(r.denom);
    }

    // GPS coordinates
    let lat = extract_gps_coord(
        &exif_data,
        exif::Tag::GPSLatitude,
        exif::Tag::GPSLatitudeRef,
    );
    let lon = extract_gps_coord(
        &exif_data,
        exif::Tag::GPSLongitude,
        exif::Tag::GPSLongitudeRef,
    );
    result.gps_latitude = lat;
    result.gps_longitude = lon;

    result
}

fn extract_gps_coord(
    exif_data: &exif::Exif,
    coord_tag: exif::Tag,
    ref_tag: exif::Tag,
) -> Option<f64> {
    let field = exif_data.get_field(coord_tag, exif::In::PRIMARY)?;
    let rationals = match &field.value {
        exif::Value::Rational(v) if v.len() >= 3 => v,
        _ => return None,
    };

    let d = rationals[0].num as f64 / rationals[0].denom as f64;
    let m = rationals[1].num as f64 / rationals[1].denom as f64;
    let s = rationals[2].num as f64 / rationals[2].denom as f64;
    let mut decimal = d + m / 60.0 + s / 3600.0;

    // Negate for South or West
    if let Some(ref_field) = exif_data.get_field(ref_tag, exif::In::PRIMARY) {
        let ref_val = ref_field
            .display_value()
            .to_string()
            .trim_matches('"')
            .to_string();
        if ref_val == "S" || ref_val == "W" {
            decimal = -decimal;
        }
    }

    Some(decimal)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_non_jpeg_returns_no_exif() {
        let result = extract("test.png");
        assert!(!result.has_exif);
        assert!(result.gps_latitude.is_none());
        assert!(result.camera_make.is_none());
    }

    #[test]
    fn test_missing_file_returns_error() {
        let result = extract("/nonexistent/path.jpg");
        assert!(!result.has_exif);
        assert!(result.error.is_some());
        assert!(result.error.unwrap().contains("failed to open file"));
    }
}
