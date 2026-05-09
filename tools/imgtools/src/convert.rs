use anyhow::{Context, Result, bail};
use image::DynamicImage;
use std::fs;
use std::path::Path;

pub fn run(
    input: &str,
    output: &str,
    format: &str,
    quality: u8,
    speed: u8,
    resize: Option<u32>,
) -> Result<()> {
    if format == "webp" && is_animated_gif(input) {
        return encode_animated_gif_as_webp(input, output, quality, resize);
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

fn is_gif_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("gif"))
}

fn is_animated_gif(path: &str) -> bool {
    use image::AnimationDecoder;
    use image::codecs::gif::GifDecoder;
    use std::fs::File;
    use std::io::BufReader;

    if !is_gif_path(path) {
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

fn encode_animated_gif_as_webp(
    input: &str,
    output: &str,
    quality: u8,
    resize: Option<u32>,
) -> Result<()> {
    use image::codecs::gif::GifDecoder;
    use image::metadata::LoopCount;
    use image::{AnimationDecoder, ImageDecoder};
    use std::fs::File;
    use std::io::BufReader;

    let file = File::open(input).with_context(|| format!("failed to open {input}"))?;
    let decoder = GifDecoder::new(BufReader::new(file)).with_context(|| "failed to decode GIF")?;
    let (source_w, source_h) = decoder.dimensions();
    let (target_w, target_h) = fit_dimensions(source_w, source_h, resize);
    let loop_count = match decoder.loop_count() {
        LoopCount::Infinite => 0,
        LoopCount::Finite(count) => count.get().min(i32::MAX as u32) as i32,
    };

    let mut encoder = AnimatedWebPEncoder::new(target_w, target_h, quality, loop_count)?;
    let mut frame_count = 0usize;

    for frame in decoder.into_frames() {
        let frame = frame.with_context(|| "failed to decode GIF frame")?;
        let delay_ms = frame_delay_ms(frame.delay());
        let mut rgba = frame.into_buffer();
        if (rgba.width(), rgba.height()) != (target_w, target_h) {
            rgba = DynamicImage::ImageRgba8(rgba)
                .resize_exact(target_w, target_h, image::imageops::FilterType::Lanczos3)
                .to_rgba8();
        }
        encoder.add_frame(rgba, delay_ms)?;
        frame_count += 1;
    }

    if frame_count == 0 {
        bail!("animated GIF has no frames");
    }

    encoder.write(output)
}

fn frame_delay_ms(delay: image::Delay) -> i32 {
    let (numerator, denominator) = delay.numer_denom_ms();
    if denominator == 0 {
        return 1;
    }
    let rounded = ((numerator as f64) / (denominator as f64)).round() as i64;
    rounded.clamp(1, i32::MAX as i64) as i32
}

fn fit_dimensions(width: u32, height: u32, max_dimension: Option<u32>) -> (u32, u32) {
    let Some(max_dimension) = max_dimension else {
        return (width, height);
    };
    if width <= max_dimension && height <= max_dimension {
        return (width, height);
    }
    let ratio = (max_dimension as f64 / width as f64).min(max_dimension as f64 / height as f64);
    let target_w = ((width as f64 * ratio).round() as u32).max(1);
    let target_h = ((height as f64 * ratio).round() as u32).max(1);
    (target_w, target_h)
}

struct AnimatedFrameChunk {
    bytes: Vec<u8>,
    x: u32,
    y: u32,
    duration_ms: i32,
}

struct AnimatedWebPEncoder {
    width: u32,
    height: u32,
    quality: u8,
    loop_count: i32,
    previous: Vec<u8>,
    chunks: Vec<AnimatedFrameChunk>,
}

impl AnimatedWebPEncoder {
    fn new(width: u32, height: u32, quality: u8, loop_count: i32) -> Result<Self> {
        if width == 0 || height == 0 {
            bail!("animated WebP dimensions must be non-zero");
        }
        let pixels = width as usize * height as usize * 4;
        Ok(Self {
            width,
            height,
            quality,
            loop_count,
            previous: vec![0; pixels],
            chunks: Vec::new(),
        })
    }

    fn add_frame(&mut self, rgba: image::RgbaImage, duration_ms: i32) -> Result<()> {
        let current = rgba.into_raw();
        let bounds = changed_bounds(&self.previous, &current, self.width, self.height);
        let Some((x, y, width, height)) = bounds else {
            if let Some(last) = self.chunks.last_mut() {
                last.duration_ms = last.duration_ms.saturating_add(duration_ms);
            } else {
                self.push_chunk(vec![0, 0, 0, 0], 0, 0, 1, 1, duration_ms)?;
            }
            self.previous = current;
            return Ok(());
        };

        let crop = crop_rgba(&current, self.width, x, y, width, height);
        self.push_chunk(crop, x, y, width, height, duration_ms)?;
        self.previous = current;
        Ok(())
    }

    fn push_chunk(
        &mut self,
        rgba: Vec<u8>,
        x: u32,
        y: u32,
        width: u32,
        height: u32,
        duration_ms: i32,
    ) -> Result<()> {
        let encoded = webp::Encoder::from_rgba(&rgba, width, height).encode(self.quality as f32);
        self.chunks.push(AnimatedFrameChunk {
            bytes: encoded.to_vec(),
            x,
            y,
            duration_ms,
        });
        Ok(())
    }

    fn write(&self, output: &str) -> Result<()> {
        if self.chunks.is_empty() {
            bail!("animated GIF has no encodable frames");
        }

        let mux = libwebp_sys::WebPMuxNew();
        if mux.is_null() {
            bail!("failed to create animated WebP mux");
        }

        let result = self.write_mux(mux, output);
        unsafe { libwebp_sys::WebPMuxDelete(mux) };
        result
    }

    fn write_mux(&self, mux: *mut libwebp_sys::WebPMux, output: &str) -> Result<()> {
        let canvas_error = unsafe {
            libwebp_sys::WebPMuxSetCanvasSize(mux, self.width as i32, self.height as i32)
        };
        if canvas_error != libwebp_sys::WebPMuxError::WEBP_MUX_OK {
            bail!("failed to set animated WebP canvas size: {canvas_error:?}");
        }

        let params = libwebp_sys::WebPMuxAnimParams {
            bgcolor: 0,
            loop_count: self.loop_count,
        };
        let mux_error = unsafe { libwebp_sys::WebPMuxSetAnimationParams(mux, &params) };
        if mux_error != libwebp_sys::WebPMuxError::WEBP_MUX_OK {
            bail!("failed to set animated WebP loop count: {mux_error:?}");
        }

        for chunk in &self.chunks {
            let data = libwebp_sys::WebPData {
                bytes: chunk.bytes.as_ptr(),
                size: chunk.bytes.len(),
            };
            let frame = libwebp_sys::WebPMuxFrameInfo {
                bitstream: data,
                x_offset: chunk.x as i32,
                y_offset: chunk.y as i32,
                duration: chunk.duration_ms,
                id: libwebp_sys::WebPChunkId::WEBP_CHUNK_ANMF,
                dispose_method: libwebp_sys::WebPMuxAnimDispose::WEBP_MUX_DISPOSE_NONE,
                blend_method: libwebp_sys::WebPMuxAnimBlend::WEBP_MUX_NO_BLEND,
                pad: [0],
            };
            let mux_error = unsafe { libwebp_sys::WebPMuxPushFrame(mux, &frame, 1) };
            if mux_error != libwebp_sys::WebPMuxError::WEBP_MUX_OK {
                bail!("failed to add animated WebP frame: {mux_error:?}");
            }
        }

        let mut muxed = libwebp_sys::WebPData::default();
        let mux_error = unsafe { libwebp_sys::WebPMuxAssemble(mux, &mut muxed) };
        if mux_error != libwebp_sys::WebPMuxError::WEBP_MUX_OK {
            bail!("failed to assemble animated WebP mux: {mux_error:?}");
        }

        let bytes = unsafe { std::slice::from_raw_parts(muxed.bytes, muxed.size) };
        let write_result =
            fs::write(output, bytes).with_context(|| format!("failed to write {output}"));
        unsafe { libwebp_sys::WebPDataClear(&mut muxed) };
        write_result
    }
}

fn changed_bounds(
    previous: &[u8],
    current: &[u8],
    width: u32,
    height: u32,
) -> Option<(u32, u32, u32, u32)> {
    let mut min_x = width;
    let mut min_y = height;
    let mut max_x = 0;
    let mut max_y = 0;
    for y in 0..height {
        for x in 0..width {
            let index = ((y * width + x) * 4) as usize;
            if previous[index..index + 4] != current[index..index + 4] {
                min_x = min_x.min(x);
                min_y = min_y.min(y);
                max_x = max_x.max(x + 1);
                max_y = max_y.max(y + 1);
            }
        }
    }
    if min_x == width {
        return None;
    }

    // WebP animation frame offsets must be even. Expand the changed rectangle
    // instead of shifting it so every changed pixel remains covered.
    min_x -= min_x % 2;
    min_y -= min_y % 2;
    Some((min_x, min_y, max_x - min_x, max_y - min_y))
}

fn crop_rgba(source: &[u8], source_width: u32, x: u32, y: u32, width: u32, height: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity(width as usize * height as usize * 4);
    let row_bytes = width as usize * 4;
    for row in y..y + height {
        let start = ((row * source_width + x) * 4) as usize;
        out.extend_from_slice(&source[start..start + row_bytes]);
    }
    out
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
