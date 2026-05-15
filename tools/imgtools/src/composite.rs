use anyhow::{Context, Result, bail};
use image::imageops::FilterType;
use image::{GenericImageView, RgbaImage};
use serde::Deserialize;
use std::io::Read;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompositeSpec {
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub transparent: bool,
    pub items: Vec<CompositeItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompositeItem {
    pub path: String,
    pub x: i64,
    pub y: i64,
    pub fit_width: u32,
    pub fit_height: u32,
}

fn open_image(path: &str) -> Result<image::DynamicImage> {
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
        let (w, h) = (size.width() as u32, size.height() as u32);
        let w = w.max(1);
        let h = h.max(1);
        let mut pixmap =
            tiny_skia::Pixmap::new(w, h).with_context(|| "failed to create SVG pixmap")?;
        resvg::render(&tree, tiny_skia::Transform::default(), &mut pixmap.as_mut());
        let rgba = RgbaImage::from_raw(w, h, pixmap.data().to_vec())
            .with_context(|| "failed to convert SVG pixmap")?;
        return Ok(image::DynamicImage::ImageRgba8(rgba));
    }

    image::open(path).with_context(|| format!("failed to open image: {path}"))
}

fn fit_dimensions(src_w: u32, src_h: u32, fit_w: u32, fit_h: u32) -> (u32, u32) {
    if src_w == 0 || src_h == 0 || fit_w == 0 || fit_h == 0 {
        return (fit_w.max(1), fit_h.max(1));
    }
    let scale = (fit_w as f64 / src_w as f64).min(fit_h as f64 / src_h as f64);
    let w = ((src_w as f64 * scale).round() as u32).max(1);
    let h = ((src_h as f64 * scale).round() as u32).max(1);
    (w, h)
}

pub fn run(output: Option<&str>) -> Result<()> {
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .context("failed to read stdin")?;
    let spec: CompositeSpec =
        serde_json::from_str(&input).context("failed to parse composite JSON")?;

    if spec.width == 0 || spec.height == 0 {
        bail!("canvas width and height must be > 0");
    }

    let bg: [u8; 4] = if spec.transparent {
        [0, 0, 0, 0]
    } else {
        [0xff, 0xff, 0xff, 0xff]
    };

    let mut canvas = RgbaImage::from_pixel(spec.width, spec.height, image::Rgba(bg));

    for item in &spec.items {
        let img = match open_image(&item.path) {
            Ok(img) => img,
            Err(e) => {
                eprintln!("warning: skipping {}: {e:#}", item.path);
                continue;
            }
        };

        let (src_w, src_h) = img.dimensions();
        let (draw_w, draw_h) = fit_dimensions(src_w, src_h, item.fit_width, item.fit_height);
        let resized = if draw_w == src_w && draw_h == src_h {
            img.to_rgba8()
        } else {
            image::imageops::resize(&img, draw_w, draw_h, FilterType::Lanczos3)
        };

        let cx = item.x + (item.fit_width as i64 - draw_w as i64) / 2;
        let cy = item.y + (item.fit_height as i64 - draw_h as i64) / 2;

        image::imageops::overlay(&mut canvas, &resized, cx, cy);
    }

    match output {
        Some(path) => {
            canvas
                .save(path)
                .with_context(|| format!("failed to write output: {path}"))?;
        }
        None => {
            let mut buf = Vec::new();
            let encoder = image::codecs::png::PngEncoder::new(&mut buf);
            canvas
                .write_with_encoder(encoder)
                .context("failed to encode PNG")?;
            use std::io::Write;
            std::io::stdout()
                .write_all(&buf)
                .context("failed to write to stdout")?;
        }
    }

    Ok(())
}
