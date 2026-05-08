use anyhow::{Context, Result};
use image::GenericImageView;
use serde::Serialize;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

#[derive(Serialize)]
pub struct ProbeResult {
    pub format: String,
    pub width: u32,
    pub height: u32,
    pub animated: bool,
    pub alpha: bool,
    pub pages: u32,
}

pub fn run(input: &str) -> Result<()> {
    let result = probe(input)?;
    println!("{}", serde_json::to_string(&result)?);
    Ok(())
}

fn probe(path: &str) -> Result<ProbeResult> {
    let ext = Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if ext == "gif" {
        return probe_gif(path);
    }

    let img = image::open(path).with_context(|| format!("failed to open {path}"))?;
    let (w, h) = img.dimensions();
    let format = guess_format(path, &ext);
    let alpha = has_alpha(&img);

    Ok(ProbeResult {
        format,
        width: w,
        height: h,
        animated: false,
        alpha,
        pages: 1,
    })
}

fn probe_gif(path: &str) -> Result<ProbeResult> {
    use image::AnimationDecoder;
    use image::ImageDecoder;
    use image::codecs::gif::GifDecoder;

    let file = File::open(path).with_context(|| format!("failed to open {path}"))?;
    let decoder = GifDecoder::new(BufReader::new(file))?;
    let (w, h) = decoder.dimensions();
    let frames: Vec<_> = decoder.into_frames().collect::<Result<Vec<_>, _>>()?;
    let animated = frames.len() > 1;

    Ok(ProbeResult {
        format: "gif".into(),
        width: w,
        height: h,
        animated,
        alpha: false,
        pages: frames.len() as u32,
    })
}

fn guess_format(path: &str, ext: &str) -> String {
    if let Ok(format) = image::ImageFormat::from_path(path) {
        match format {
            image::ImageFormat::Png => "png",
            image::ImageFormat::Jpeg => "jpeg",
            image::ImageFormat::Gif => "gif",
            image::ImageFormat::WebP => "webp",
            image::ImageFormat::Avif => "avif",
            _ => ext,
        }
        .into()
    } else {
        ext.into()
    }
}

fn has_alpha(img: &image::DynamicImage) -> bool {
    let rgba = img.to_rgba8();
    let (w, h) = (rgba.width() as usize, rgba.height() as usize);
    let step_x = (w / 32).max(1);
    let step_y = (h / 32).max(1);
    for y in (0..h).step_by(step_y) {
        for x in (0..w).step_by(step_x) {
            let pixel = rgba.get_pixel(x as u32, y as u32);
            if pixel[3] < 255 {
                return true;
            }
        }
    }
    false
}
