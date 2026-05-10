use anyhow::{Context, Result};
use image::imageops::FilterType;
use image::{DynamicImage, GrayImage};
use serde::Serialize;
use std::path::Path;

const HASH_SIZE: u32 = 8;
const SAMPLE_SIZE: u32 = 16;
const SVG_RASTER_MAX: u32 = 512;

#[derive(Serialize)]
pub struct DHashResult {
    #[serde(rename = "dHash")]
    pub d_hash: String,
    #[serde(rename = "dHashFlipped")]
    pub d_hash_flipped: String,
}

#[derive(Serialize)]
pub struct VisualSampleResult {
    pub width: u32,
    pub height: u32,
    pub rgba: String,
}

#[derive(Serialize)]
pub struct DistanceResult {
    pub distance: i32,
}

pub fn run_dhash(input: &str) -> Result<()> {
    let img = open_image(input)?;
    let hash = difference_hash(&img);
    let flipped = difference_hash(&flip_horizontal(&img));
    let result = DHashResult {
        d_hash: format!("{hash:016x}"),
        d_hash_flipped: format!("{flipped:016x}"),
    };
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}

pub fn run_distance(hash1: &str, hash2: &str) -> Result<()> {
    let a = u64::from_str_radix(hash1, 16).with_context(|| format!("invalid hex: {hash1}"))?;
    let b = u64::from_str_radix(hash2, 16).with_context(|| format!("invalid hex: {hash2}"))?;
    let distance = (a ^ b).count_ones() as i32;
    let result = DistanceResult { distance };
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}

pub fn run_visual_sample(input: &str) -> Result<()> {
    let img = open_image(input)?;
    let sample = visual_sample(&img);
    let hex: String = sample.as_raw().iter().map(|b| format!("{b:02x}")).collect();
    let result = VisualSampleResult {
        width: SAMPLE_SIZE,
        height: SAMPLE_SIZE,
        rgba: hex,
    };
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}

pub fn run_visual_distance(input_a: &str, input_b: &str, flip_b: bool) -> Result<()> {
    let img_a = open_image(input_a)?;
    let img_b = open_image(input_b)?;
    let img_b = if flip_b {
        flip_horizontal(&img_b)
    } else {
        img_b
    };

    let sample_a = visual_sample(&img_a);
    let sample_b = visual_sample(&img_b);

    let mut total: i64 = 0;
    let mut count: u32 = 0;
    for y in 0..SAMPLE_SIZE {
        for x in 0..SAMPLE_SIZE {
            let pa = sample_a.get_pixel(x, y);
            let pb = sample_b.get_pixel(x, y);
            if pa[3] == 0 && pb[3] == 0 {
                continue;
            }
            count += 1;
            total += (pa[0] as i64 - pb[0] as i64).abs()
                + (pa[1] as i64 - pb[1] as i64).abs()
                + (pa[2] as i64 - pb[2] as i64).abs()
                + (pa[3] as i64 - pb[3] as i64).abs();
        }
    }
    let distance = if count == 0 {
        255
    } else {
        (total as f64 / (count as f64 * 4.0)).round() as i32
    };
    let result = DistanceResult { distance };
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}

fn difference_hash(img: &DynamicImage) -> u64 {
    let resized = img.resize_exact(HASH_SIZE + 1, HASH_SIZE, FilterType::Lanczos3);
    let gray: GrayImage = resized.to_luma8();
    let mut hash: u64 = 0;
    for y in 0..HASH_SIZE {
        for x in 0..HASH_SIZE {
            let left = gray.get_pixel(x, y)[0];
            let right = gray.get_pixel(x + 1, y)[0];
            if left < right {
                hash |= 1 << (y * HASH_SIZE + x);
            }
        }
    }
    hash
}

fn flip_horizontal(img: &DynamicImage) -> DynamicImage {
    DynamicImage::ImageRgba8(image::imageops::flip_horizontal(&img.to_rgba8()))
}

fn visual_sample(img: &DynamicImage) -> image::RgbaImage {
    img.resize_exact(SAMPLE_SIZE, SAMPLE_SIZE, FilterType::CatmullRom)
        .to_rgba8()
}

fn open_image(input: &str) -> Result<DynamicImage> {
    let ext = Path::new(input)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ext == "svg" {
        rasterize_svg(input)
    } else {
        image::open(input).with_context(|| format!("failed to open {input}"))
    }
}

fn rasterize_svg(input: &str) -> Result<DynamicImage> {
    let svg_data = std::fs::read(input).with_context(|| format!("failed to read SVG: {input}"))?;
    let opt = resvg::usvg::Options::default();
    let tree =
        resvg::usvg::Tree::from_data(&svg_data, &opt).with_context(|| "failed to parse SVG")?;
    let orig = tree.size().to_int_size();
    let (w, h) = fit_size(orig.width(), orig.height(), SVG_RASTER_MAX);
    let mut pixmap = tiny_skia::Pixmap::new(w, h)
        .ok_or_else(|| anyhow::anyhow!("failed to create {w}x{h} pixmap"))?;
    let sx = w as f32 / orig.width() as f32;
    let sy = h as f32 / orig.height() as f32;
    resvg::render(
        &tree,
        tiny_skia::Transform::from_scale(sx, sy),
        &mut pixmap.as_mut(),
    );
    Ok(pixmap_to_dynamic_image(&pixmap))
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

fn pixmap_to_dynamic_image(pixmap: &tiny_skia::Pixmap) -> DynamicImage {
    let w = pixmap.width();
    let h = pixmap.height();
    let data = pixmap.data();
    let mut rgba = Vec::with_capacity(data.len());
    for chunk in data.chunks_exact(4) {
        let a = chunk[3];
        if a == 0 {
            rgba.extend_from_slice(&[0, 0, 0, 0]);
        } else if a == 255 {
            rgba.extend_from_slice(chunk);
        } else {
            let r = ((chunk[0] as u16 * 255) / a as u16).min(255) as u8;
            let g = ((chunk[1] as u16 * 255) / a as u16).min(255) as u8;
            let b = ((chunk[2] as u16 * 255) / a as u16).min(255) as u8;
            rgba.extend_from_slice(&[r, g, b, a]);
        }
    }
    DynamicImage::ImageRgba8(
        image::RgbaImage::from_raw(w, h, rgba).expect("pixmap dimensions must match buffer size"),
    )
}
