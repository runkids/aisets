use anyhow::{Context, Result, bail};
use image::DynamicImage;
use std::fs;
use std::path::Path;

pub fn run(input: &str, output: &str, format: &str, quality: u8) -> Result<()> {
    let img = image::open(input).with_context(|| format!("failed to open {input}"))?;

    match format {
        "webp" => encode_webp(&img, output, quality),
        "gif" => encode_gif(input, output),
        "png" => encode_png(&img, output),
        "jpeg" | "jpg" => encode_jpeg(&img, output, quality),
        _ => bail!("unsupported output format: {format}"),
    }
}

fn encode_webp(img: &DynamicImage, output: &str, quality: u8) -> Result<()> {
    let rgba = img.to_rgba8();
    let (w, h) = (rgba.width(), rgba.height());
    let encoder = webp::Encoder::from_rgba(rgba.as_raw(), w, h);
    let mem = encoder.encode(quality as f32);
    fs::write(output, &*mem).with_context(|| format!("failed to write {output}"))?;
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
    img.save(Path::new(output))
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
