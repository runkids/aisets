use anyhow::{Context, Result, bail};
use image::DynamicImage;
use std::path::Path;

pub fn run(
    input: &str,
    output: &str,
    _purpose: &str,
    max_size: u32,
    background: &str,
) -> Result<()> {
    let ext = Path::new(input)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    let bg = parse_background(background)?;

    if ext == "svg" {
        normalize_svg(input, output, max_size, bg)
    } else {
        normalize_raster(input, output, max_size, bg)
    }
}

fn parse_background(bg: &str) -> Result<[u8; 3]> {
    match bg {
        "white" => Ok([255, 255, 255]),
        "black" => Ok([0, 0, 0]),
        _ => bail!("unsupported background color: {bg}"),
    }
}

fn normalize_svg(input: &str, output: &str, max_size: u32, bg: [u8; 3]) -> Result<()> {
    let svg_data = std::fs::read(input).with_context(|| format!("failed to read SVG: {input}"))?;

    let opt = resvg::usvg::Options::default();
    let tree =
        resvg::usvg::Tree::from_data(&svg_data, &opt).with_context(|| "failed to parse SVG")?;

    let orig = tree.size().to_int_size();
    let (w, h) = fit_size(orig.width(), orig.height(), max_size);

    let mut pixmap = tiny_skia::Pixmap::new(w, h)
        .ok_or_else(|| anyhow::anyhow!("failed to create {w}x{h} pixmap"))?;

    pixmap.fill(tiny_skia::Color::from_rgba8(bg[0], bg[1], bg[2], 255));

    let sx = w as f32 / orig.width() as f32;
    let sy = h as f32 / orig.height() as f32;
    resvg::render(
        &tree,
        tiny_skia::Transform::from_scale(sx, sy),
        &mut pixmap.as_mut(),
    );

    pixmap
        .save_png(output)
        .with_context(|| format!("failed to write PNG: {output}"))?;

    Ok(())
}

fn normalize_raster(input: &str, output: &str, max_size: u32, bg: [u8; 3]) -> Result<()> {
    let img = image::open(input).with_context(|| format!("failed to open: {input}"))?;

    let mut rgba = img.to_rgba8();
    flatten_alpha(&mut rgba, bg);

    let mut result = DynamicImage::ImageRgba8(rgba);
    let (w, h) = (result.width(), result.height());
    if w > max_size || h > max_size {
        result = result.resize(max_size, max_size, image::imageops::FilterType::Lanczos3);
    }

    encode_png(&result, output)
}

fn flatten_alpha(img: &mut image::RgbaImage, bg: [u8; 3]) {
    for pixel in img.pixels_mut() {
        let a = pixel[3] as f32 / 255.0;
        if a < 1.0 {
            pixel[0] = (pixel[0] as f32 * a + bg[0] as f32 * (1.0 - a)).round() as u8;
            pixel[1] = (pixel[1] as f32 * a + bg[1] as f32 * (1.0 - a)).round() as u8;
            pixel[2] = (pixel[2] as f32 * a + bg[2] as f32 * (1.0 - a)).round() as u8;
            pixel[3] = 255;
        }
    }
}

fn fit_size(width: u32, height: u32, max_size: u32) -> (u32, u32) {
    if width == 0 || height == 0 {
        return (max_size, max_size);
    }
    let scale = (max_size as f64 / width as f64)
        .min(max_size as f64 / height as f64)
        .min(1.0);
    let w = (width as f64 * scale).round().max(1.0) as u32;
    let h = (height as f64 * scale).round().max(1.0) as u32;
    (w, h)
}

fn encode_png(img: &DynamicImage, output: &str) -> Result<()> {
    use image::codecs::png::{CompressionType, FilterType, PngEncoder};
    use std::fs::File;
    use std::io::BufWriter;

    let file = File::create(output)?;
    let writer = BufWriter::new(file);
    let encoder =
        PngEncoder::new_with_quality(writer, CompressionType::Default, FilterType::Adaptive);
    img.write_with_encoder(encoder)
        .with_context(|| format!("failed to write PNG to {output}"))?;
    Ok(())
}
