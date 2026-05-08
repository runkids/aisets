use anyhow::{Context, Result, anyhow, bail};
use image::DynamicImage;
use std::ffi::CStr;
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

    let mut config = libwebp_sys::WebPConfig::new()
        .map_err(|_| anyhow!("failed to initialize animated WebP encoder config"))?;
    config.quality = quality as f32;
    config.thread_level = 1;
    config.alpha_compression = 1;

    let mut encoder = AnimatedWebPEncoder::new(target_w, target_h, &config)?;
    let mut timestamp_ms = 0i32;
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
        encoder.add_frame(rgba.as_raw(), timestamp_ms)?;
        timestamp_ms = timestamp_ms.saturating_add(delay_ms);
        frame_count += 1;
    }

    if frame_count == 0 {
        bail!("animated GIF has no frames");
    }

    encoder.write(output, timestamp_ms, loop_count)
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

struct AnimatedWebPEncoder {
    encoder: *mut libwebp_sys::WebPAnimEncoder,
    width: u32,
    height: u32,
}

impl AnimatedWebPEncoder {
    fn new(width: u32, height: u32, config: &libwebp_sys::WebPConfig) -> Result<Self> {
        if unsafe { libwebp_sys::WebPValidateConfig(config) } == 0 {
            bail!("invalid animated WebP encoder config");
        }

        let mux_abi = unsafe { libwebp_sys::WebPGetMuxABIVersion() };
        let mut options = std::mem::MaybeUninit::<libwebp_sys::WebPAnimEncoderOptions>::uninit();
        let ok = unsafe {
            libwebp_sys::WebPAnimEncoderOptionsInitInternal(options.as_mut_ptr(), mux_abi)
        };
        if ok == 0 {
            bail!("failed to initialize animated WebP encoder options");
        }
        let encoder = unsafe {
            libwebp_sys::WebPAnimEncoderNewInternal(
                width as i32,
                height as i32,
                options.as_ptr(),
                mux_abi,
            )
        };
        if encoder.is_null() {
            bail!("failed to create animated WebP encoder");
        }
        Ok(Self {
            encoder,
            width,
            height,
        })
    }

    fn add_frame(&mut self, rgba: &[u8], timestamp_ms: i32) -> Result<()> {
        let expected = self.width as usize * self.height as usize * 4;
        if rgba.len() < expected {
            bail!("frame buffer is too small for animated WebP encoding");
        }
        let mut picture = libwebp_sys::WebPPicture::new()
            .map_err(|_| anyhow!("failed to initialize animated WebP frame"))?;
        picture.use_argb = 1;
        picture.width = self.width as i32;
        picture.height = self.height as i32;
        let imported = unsafe {
            libwebp_sys::WebPPictureImportRGBA(&mut picture, rgba.as_ptr(), (self.width * 4) as i32)
        };
        if imported == 0 {
            unsafe { libwebp_sys::WebPPictureFree(&mut picture) };
            bail!("failed to import GIF frame for animated WebP encoding");
        }

        let added = unsafe {
            libwebp_sys::WebPAnimEncoderAdd(
                self.encoder,
                &mut picture,
                timestamp_ms,
                std::ptr::null(),
            )
        };
        let error_code = picture.error_code;
        unsafe { libwebp_sys::WebPPictureFree(&mut picture) };
        if added == 0 {
            bail!("animated WebP frame encode failed: {error_code:?}");
        }
        Ok(())
    }

    fn write(&mut self, output: &str, final_timestamp_ms: i32, loop_count: i32) -> Result<()> {
        unsafe {
            libwebp_sys::WebPAnimEncoderAdd(
                self.encoder,
                std::ptr::null_mut(),
                final_timestamp_ms,
                std::ptr::null(),
            );
        }

        let mut data = libwebp_sys::WebPData::default();
        let assembled = unsafe { libwebp_sys::WebPAnimEncoderAssemble(self.encoder, &mut data) };
        if assembled == 0 {
            let err = animated_webp_error(self.encoder);
            bail!("animated WebP assemble failed: {err}");
        }

        let mux_abi = unsafe { libwebp_sys::WebPGetMuxABIVersion() };
        let mux = unsafe { libwebp_sys::WebPMuxCreateInternal(&data, 1, mux_abi) };
        if mux.is_null() {
            unsafe { libwebp_sys::WebPDataClear(&mut data) };
            bail!("failed to create animated WebP mux");
        }

        let params = libwebp_sys::WebPMuxAnimParams {
            bgcolor: 0,
            loop_count,
        };
        let mux_error = unsafe { libwebp_sys::WebPMuxSetAnimationParams(mux, &params) };
        if mux_error != libwebp_sys::WebPMuxError::WEBP_MUX_OK {
            unsafe {
                libwebp_sys::WebPMuxDelete(mux);
                libwebp_sys::WebPDataClear(&mut data);
            }
            bail!("failed to set animated WebP loop count: {mux_error:?}");
        }

        let mut muxed = libwebp_sys::WebPData::default();
        let mux_error = unsafe { libwebp_sys::WebPMuxAssemble(mux, &mut muxed) };
        unsafe {
            libwebp_sys::WebPMuxDelete(mux);
            libwebp_sys::WebPDataClear(&mut data);
        }
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

impl Drop for AnimatedWebPEncoder {
    fn drop(&mut self) {
        if !self.encoder.is_null() {
            unsafe { libwebp_sys::WebPAnimEncoderDelete(self.encoder) };
        }
    }
}

fn animated_webp_error(encoder: *mut libwebp_sys::WebPAnimEncoder) -> String {
    let ptr = unsafe { libwebp_sys::WebPAnimEncoderGetError(encoder) };
    if ptr.is_null() {
        return "unknown error".into();
    }
    unsafe { CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned()
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
