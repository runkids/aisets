use anyhow::{Context, Result};
use image::imageops::FilterType;
use image::{DynamicImage, GrayImage};
use serde::Serialize;

const HASH_SIZE: u32 = 8;
const SAMPLE_SIZE: u32 = 16;

#[derive(Serialize)]
pub struct DHashResult {
    #[serde(rename = "dHash")]
    pub d_hash: String,
    #[serde(rename = "dHashFlipped")]
    pub d_hash_flipped: String,
}

#[derive(Serialize)]
pub struct DistanceResult {
    pub distance: i32,
}

pub fn run_dhash(input: &str) -> Result<()> {
    let img = image::open(input).with_context(|| format!("failed to open {input}"))?;
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

pub fn run_visual_distance(input_a: &str, input_b: &str, flip_b: bool) -> Result<()> {
    let img_a = image::open(input_a).with_context(|| format!("failed to open {input_a}"))?;
    let img_b = image::open(input_b).with_context(|| format!("failed to open {input_b}"))?;
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
