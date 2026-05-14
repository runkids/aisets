use anyhow::{Context, Result, bail};
use image::{DynamicImage, RgbaImage};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FlipMode {
    None,
    Horizontal,
    Vertical,
    Both,
}

pub fn run(input: &str, output: &str, flip: &str, rotate: i32) -> Result<()> {
    let flip = parse_flip(flip)?;
    let rotate = normalize_rotation(rotate)?;

    if flip == FlipMode::None && rotate == 0 {
        std::fs::copy(input, output).with_context(|| format!("failed to copy {input}"))?;
        return Ok(());
    }

    let img = open_image(input)?;
    let transformed = apply_transform(img, flip, rotate);
    save_image(&transformed, output)
}

fn parse_flip(raw: &str) -> Result<FlipMode> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "" | "none" => Ok(FlipMode::None),
        "horizontal" | "h" | "x" | "mirror" => Ok(FlipMode::Horizontal),
        "vertical" | "v" | "y" => Ok(FlipMode::Vertical),
        "both" | "xy" | "yx" => Ok(FlipMode::Both),
        other => bail!("unsupported flip mode: {other}"),
    }
}

fn normalize_rotation(degrees: i32) -> Result<u16> {
    let normalized = degrees.rem_euclid(360) as u16;
    match normalized {
        0 | 90 | 180 | 270 => Ok(normalized),
        _ => bail!("rotation must be one of 0, 90, 180, 270 degrees"),
    }
}

fn apply_transform(img: DynamicImage, flip: FlipMode, rotate: u16) -> DynamicImage {
    let mut out = img.to_rgba8();
    out = match flip {
        FlipMode::None => out,
        FlipMode::Horizontal => image::imageops::flip_horizontal(&out),
        FlipMode::Vertical => image::imageops::flip_vertical(&out),
        FlipMode::Both => image::imageops::flip_vertical(&image::imageops::flip_horizontal(&out)),
    };
    out = match rotate {
        0 => out,
        90 => image::imageops::rotate90(&out),
        180 => image::imageops::rotate180(&out),
        270 => image::imageops::rotate270(&out),
        _ => unreachable!("rotation is normalized before transform"),
    };
    DynamicImage::ImageRgba8(out)
}

fn open_image(path: &str) -> Result<DynamicImage> {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if ext == "svg" {
        let data = std::fs::read(path).with_context(|| format!("failed to read SVG: {path}"))?;
        let opt = resvg::usvg::Options::default();
        let tree = resvg::usvg::Tree::from_data(&data, &opt)
            .with_context(|| format!("failed to parse SVG: {path}"))?;
        let size = tree.size();
        let (w, h) = ((size.width() as u32).max(1), (size.height() as u32).max(1));
        let mut pixmap =
            tiny_skia::Pixmap::new(w, h).with_context(|| "failed to create SVG pixmap")?;
        resvg::render(&tree, tiny_skia::Transform::default(), &mut pixmap.as_mut());
        let rgba = RgbaImage::from_raw(w, h, pixmap.data().to_vec())
            .with_context(|| "failed to convert SVG pixmap")?;
        return Ok(DynamicImage::ImageRgba8(rgba));
    }

    image::open(path).with_context(|| format!("failed to open image: {path}"))
}

fn save_image(img: &DynamicImage, output: &str) -> Result<()> {
    let ext = std::path::Path::new(output)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match ext.as_str() {
        "jpg" | "jpeg" => {
            let file = std::fs::File::create(output)
                .with_context(|| format!("failed to write output: {output}"))?;
            let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(file, 90);
            encoder
                .encode_image(&img.to_rgb8())
                .with_context(|| format!("failed to encode JPEG: {output}"))?;
            Ok(())
        }
        _ => img
            .save(output)
            .with_context(|| format!("failed to write output: {output}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn sample() -> DynamicImage {
        let mut img = RgbaImage::new(2, 1);
        img.put_pixel(0, 0, Rgba([255, 0, 0, 255]));
        img.put_pixel(1, 0, Rgba([0, 0, 255, 255]));
        DynamicImage::ImageRgba8(img)
    }

    #[test]
    fn normalizes_rotation() {
        assert_eq!(normalize_rotation(90).unwrap(), 90);
        assert_eq!(normalize_rotation(-90).unwrap(), 270);
        assert!(normalize_rotation(45).is_err());
    }

    #[test]
    fn flips_horizontally() {
        let out = apply_transform(sample(), FlipMode::Horizontal, 0).to_rgba8();
        assert_eq!(out.get_pixel(0, 0).0, [0, 0, 255, 255]);
        assert_eq!(out.get_pixel(1, 0).0, [255, 0, 0, 255]);
    }

    #[test]
    fn rotates_clockwise() {
        let out = apply_transform(sample(), FlipMode::None, 90).to_rgba8();
        assert_eq!(out.dimensions(), (1, 2));
        assert_eq!(out.get_pixel(0, 0).0, [255, 0, 0, 255]);
        assert_eq!(out.get_pixel(0, 1).0, [0, 0, 255, 255]);
    }
}
