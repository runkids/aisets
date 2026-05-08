use anyhow::{Context, Result, bail};
use image::DynamicImage;
use std::fs;

pub fn run(
    input: &str,
    output: &str,
    format: &str,
    quality: u8,
    speed: u8,
    resize: Option<u32>,
) -> Result<()> {
    if format == "webp" && is_animated_gif(input) {
        bail!("animated GIF cannot be converted to static WebP without losing animation");
    }

    let mut img = image::open(input).with_context(|| format!("failed to open {input}"))?;

    if let Some(max_dim) = resize {
        let (w, h) = (img.width(), img.height());
        if w > max_dim || h > max_dim {
            img = img.resize(max_dim, max_dim, image::imageops::FilterType::Lanczos3);
        }
    }

    match format {
        "webp" => encode_webp(&img, output, quality),
        "avif" => encode_avif(&img, output, quality, speed),
        "gif" => encode_gif(input, output),
        "png" => encode_png(&img, output),
        "jpeg" | "jpg" => encode_jpeg(&img, output, quality),
        _ => bail!("unsupported output format: {format}"),
    }
}

fn is_animated_gif(path: &str) -> bool {
    use image::AnimationDecoder;
    use image::codecs::gif::GifDecoder;
    use std::fs::File;
    use std::io::BufReader;

    if !path.to_lowercase().ends_with(".gif") {
        return false;
    }
    let Ok(file) = File::open(path) else {
        return false;
    };
    let Ok(decoder) = GifDecoder::new(BufReader::new(file)) else {
        return false;
    };
    decoder.into_frames().take(2).count() > 1
}

fn encode_webp(img: &DynamicImage, output: &str, quality: u8) -> Result<()> {
    let rgba = img.to_rgba8();
    let (w, h) = (rgba.width(), rgba.height());
    let encoder = webp::Encoder::from_rgba(rgba.as_raw(), w, h);
    let mem = encoder.encode(quality as f32);
    fs::write(output, &*mem).with_context(|| format!("failed to write {output}"))?;
    Ok(())
}

fn encode_avif(img: &DynamicImage, output: &str, quality: u8, speed: u8) -> Result<()> {
    let rgba = img.to_rgba8();
    let (w, h) = (rgba.width() as usize, rgba.height() as usize);
    let pixels: Vec<rgb::RGBA8> = rgba
        .pixels()
        .map(|p| rgb::RGBA8::new(p[0], p[1], p[2], p[3]))
        .collect();
    let img_ref = ravif::Img::new(&pixels[..], w, h);
    let encoder = ravif::Encoder::new()
        .with_quality(quality as f32)
        .with_speed(speed);
    let result = encoder
        .encode_rgba(img_ref)
        .with_context(|| "AVIF encode failed")?;
    fs::write(output, result.avif_file).with_context(|| format!("failed to write {output}"))?;
    Ok(())
}

fn encode_gif(input: &str, output: &str) -> Result<()> {
    use image::AnimationDecoder;
    use image::codecs::gif::{GifDecoder, GifEncoder, Repeat};
    use std::fs::File;
    use std::io::BufReader;

    let file = File::open(input).with_context(|| format!("failed to open {input}"))?;
    let decoder = GifDecoder::new(BufReader::new(file)).with_context(|| "failed to decode GIF")?;
    let frames: Vec<_> = decoder.into_frames().collect::<Result<Vec<_>, _>>()?;

    let out = File::create(output).with_context(|| format!("failed to create {output}"))?;
    let mut encoder = GifEncoder::new(out);
    encoder.set_repeat(Repeat::Infinite)?;
    for frame in frames {
        encoder.encode_frame(frame)?;
    }
    Ok(())
}

fn encode_png(img: &DynamicImage, output: &str) -> Result<()> {
    use image::codecs::png::{CompressionType, FilterType, PngEncoder};
    use std::fs::File;
    use std::io::BufWriter;

    let file = File::create(output)?;
    let writer = BufWriter::new(file);
    let encoder = PngEncoder::new_with_quality(writer, CompressionType::Best, FilterType::Adaptive);
    img.write_with_encoder(encoder)
        .with_context(|| format!("failed to write PNG to {output}"))?;
    Ok(())
}

fn encode_jpeg(img: &DynamicImage, output: &str, quality: u8) -> Result<()> {
    use image::codecs::jpeg::JpegEncoder;
    use std::fs::File;
    use std::io::BufWriter;

    let file = File::create(output)?;
    let writer = BufWriter::new(file);
    let encoder = JpegEncoder::new_with_quality(writer, quality);
    img.to_rgb8().write_with_encoder(encoder)?;
    Ok(())
}
