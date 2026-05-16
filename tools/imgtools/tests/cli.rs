use image::{Rgba, RgbaImage};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static NEXT_ID: AtomicUsize = AtomicUsize::new(0);

struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new() -> Self {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "aisets-imgtools-test-{}-{nanos}-{id}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }

    fn path(&self, name: &str) -> PathBuf {
        self.path.join(name)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn imgtools() -> Command {
    Command::new(env!("CARGO_BIN_EXE_aisets-imgtools"))
}

fn run(args: &[&str]) -> Output {
    imgtools().args(args).output().expect("run imgtools")
}

fn assert_success(output: Output) -> String {
    assert!(
        output.status.success(),
        "expected success, got status {:?}\nstderr:\n{}",
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("stdout should be utf-8")
}

fn write_rgba_png(path: &Path, width: u32, height: u32, pixel: Rgba<u8>) {
    let img = RgbaImage::from_pixel(width, height, pixel);
    img.save(path).expect("write png fixture");
}

fn write_animated_gif(path: &Path) {
    use image::codecs::gif::{GifEncoder, Repeat};
    use image::{Delay, Frame};

    let file = fs::File::create(path).expect("create gif fixture");
    let mut encoder = GifEncoder::new(file);
    encoder.set_repeat(Repeat::Infinite).expect("set repeat");
    let red = RgbaImage::from_pixel(4, 2, Rgba([255, 0, 0, 255]));
    let green = RgbaImage::from_pixel(4, 2, Rgba([0, 255, 0, 255]));
    encoder
        .encode_frame(Frame::from_parts(
            red,
            0,
            0,
            Delay::from_numer_denom_ms(40, 1),
        ))
        .expect("encode first gif frame");
    encoder
        .encode_frame(Frame::from_parts(
            green,
            0,
            0,
            Delay::from_numer_denom_ms(60, 1),
        ))
        .expect("encode second gif frame");
}

#[test]
fn version_prints_package_name_and_version() {
    let stdout = assert_success(run(&["version"]));

    assert_eq!(stdout.trim(), "aisets-imgtools 0.1.0");
}

#[test]
fn distance_outputs_hamming_distance_json() {
    let stdout = assert_success(run(&[
        "distance",
        "--hash1",
        "0000000000000000",
        "--hash2",
        "ffffffffffffffff",
    ]));
    let json: Value = serde_json::from_str(&stdout).expect("parse distance json");

    assert_eq!(json["distance"], 64);
}

#[test]
fn probe_reports_png_dimensions_and_alpha() {
    let temp = TempDir::new();
    let input = temp.path("alpha.png");
    let mut img = RgbaImage::from_pixel(4, 2, Rgba([10, 20, 30, 255]));
    img.put_pixel(1, 1, Rgba([10, 20, 30, 12]));
    img.save(&input).expect("write png fixture");

    let stdout = assert_success(run(&["probe", input.to_str().expect("path utf-8")]));
    let json: Value = serde_json::from_str(&stdout).expect("parse probe json");

    assert_eq!(json["format"], "png");
    assert_eq!(json["width"], 4);
    assert_eq!(json["height"], 2);
    assert_eq!(json["animated"], false);
    assert_eq!(json["alpha"], true);
    assert_eq!(json["pages"], 1);
}

#[test]
fn resize_copies_image_when_it_already_fits() {
    let temp = TempDir::new();
    let input = temp.path("input.png");
    let output = temp.path("output.png");
    write_rgba_png(&input, 2, 2, Rgba([40, 50, 60, 255]));

    assert_success(run(&[
        "resize",
        "--max-dimension",
        "10",
        input.to_str().expect("path utf-8"),
        output.to_str().expect("path utf-8"),
    ]));

    assert_eq!(
        fs::read(&output).expect("read output"),
        fs::read(&input).expect("read input")
    );
}

#[test]
fn transform_mirrors_and_rotates_image() {
    let temp = TempDir::new();
    let input = temp.path("source.png");
    let output = temp.path("output.png");
    let mut img = RgbaImage::new(2, 1);
    img.put_pixel(0, 0, Rgba([255, 0, 0, 255]));
    img.put_pixel(1, 0, Rgba([0, 0, 255, 255]));
    img.save(&input).expect("write source image");

    assert_success(run(&[
        "transform",
        "--flip",
        "horizontal",
        "--rotate",
        "90",
        input.to_str().expect("path utf-8"),
        output.to_str().expect("path utf-8"),
    ]));

    let out = image::open(&output).expect("open output").to_rgba8();
    assert_eq!(out.dimensions(), (1, 2));
    assert_eq!(out.get_pixel(0, 0).0, [0, 0, 255, 255]);
    assert_eq!(out.get_pixel(0, 1).0, [255, 0, 0, 255]);
}

#[test]
fn thumbnail_preserves_aspect_ratio_within_requested_size() {
    let temp = TempDir::new();
    let input = temp.path("input.png");
    let output = temp.path("thumb.png");
    write_rgba_png(&input, 80, 40, Rgba([120, 90, 30, 255]));

    assert_success(run(&[
        "thumbnail",
        "--size",
        "16",
        input.to_str().expect("path utf-8"),
        output.to_str().expect("path utf-8"),
    ]));

    let thumb = image::open(&output).expect("open thumbnail");
    assert_eq!((thumb.width(), thumb.height()), (16, 8));
}

#[test]
fn convert_resizes_and_writes_requested_format() {
    let temp = TempDir::new();
    let input = temp.path("input.png");
    let output = temp.path("output.jpg");
    write_rgba_png(&input, 64, 32, Rgba([200, 10, 80, 255]));

    assert_success(run(&[
        "convert",
        "--format",
        "jpeg",
        "--quality",
        "85",
        "--resize",
        "16",
        input.to_str().expect("path utf-8"),
        output.to_str().expect("path utf-8"),
    ]));

    let converted = image::open(&output).expect("open converted image");
    assert_eq!((converted.width(), converted.height()), (16, 8));
}

#[test]
fn convert_decodes_avif_input_when_writing_webp() {
    let temp = TempDir::new();
    let source = temp.path("source.png");
    let avif = temp.path("source.avif");
    let output = temp.path("output.webp");
    write_rgba_png(&source, 18, 10, Rgba([80, 120, 200, 180]));

    assert_success(run(&[
        "convert",
        "--format",
        "avif",
        "--quality",
        "80",
        source.to_str().expect("path utf-8"),
        avif.to_str().expect("path utf-8"),
    ]));

    assert_success(run(&[
        "convert",
        "--format",
        "webp",
        "--quality",
        "80",
        avif.to_str().expect("path utf-8"),
        output.to_str().expect("path utf-8"),
    ]));

    let converted = image::open(&output).expect("open converted webp");
    assert_eq!((converted.width(), converted.height()), (18, 10));
}

#[test]
fn convert_preserves_animated_gif_when_writing_webp() {
    let temp = TempDir::new();
    let input = temp.path("animated.gif");
    let output = temp.path("animated.webp");
    write_animated_gif(&input);

    assert_success(run(&[
        "convert",
        "--format",
        "webp",
        "--quality",
        "80",
        input.to_str().expect("path utf-8"),
        output.to_str().expect("path utf-8"),
    ]));

    let bytes = fs::read(&output).expect("read animated webp");
    let anim = webp::AnimDecoder::new(&bytes)
        .decode()
        .expect("decode animated webp");
    assert!(anim.has_animation(), "output should remain animated");
    assert_eq!(anim.len(), 2);
    assert_eq!(anim.loop_count, 0);
    let frame = anim.get_frame(0).expect("first frame");
    assert_eq!((frame.width(), frame.height()), (4, 2));
}

#[test]
fn convert_rejects_unsupported_format() {
    let temp = TempDir::new();
    let input = temp.path("input.png");
    let output = temp.path("output.tiff");
    write_rgba_png(&input, 2, 2, Rgba([1, 2, 3, 255]));

    let output = run(&[
        "convert",
        "--format",
        "tiff",
        input.to_str().expect("path utf-8"),
        output.to_str().expect("path utf-8"),
    ]);

    assert!(
        !output.status.success(),
        "expected unsupported format to fail"
    );
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("unsupported output format: tiff"),
        "stderr should explain unsupported format, got: {stderr}"
    );
}

#[test]
fn vlm_normalize_resizes_large_png_to_max_size() {
    let temp = TempDir::new();
    let input = temp.path("large.png");
    let output = temp.path("normalized.png");
    write_rgba_png(&input, 2000, 1000, Rgba([100, 150, 200, 255]));

    assert_success(run(&[
        "vlm-normalize",
        "--purpose",
        "tag",
        "--max-size",
        "768",
        input.to_str().expect("path utf-8"),
        output.to_str().expect("path utf-8"),
    ]));

    let img = image::open(&output).expect("open normalized");
    assert_eq!(img.width(), 768);
    assert_eq!(img.height(), 384);
}

#[test]
fn vlm_normalize_does_not_upscale_small_image() {
    let temp = TempDir::new();
    let input = temp.path("small.png");
    let output = temp.path("normalized.png");
    write_rgba_png(&input, 100, 50, Rgba([10, 20, 30, 255]));

    assert_success(run(&[
        "vlm-normalize",
        "--purpose",
        "tag",
        "--max-size",
        "768",
        input.to_str().expect("path utf-8"),
        output.to_str().expect("path utf-8"),
    ]));

    let img = image::open(&output).expect("open normalized");
    assert_eq!((img.width(), img.height()), (100, 50));
}

#[test]
fn vlm_normalize_flattens_alpha_on_white() {
    let temp = TempDir::new();
    let input = temp.path("alpha.png");
    let output = temp.path("normalized.png");
    write_rgba_png(&input, 2, 2, Rgba([255, 0, 0, 128]));

    assert_success(run(&[
        "vlm-normalize",
        "--purpose",
        "ocr",
        "--max-size",
        "1536",
        "--background",
        "white",
        input.to_str().expect("path utf-8"),
        output.to_str().expect("path utf-8"),
    ]));

    let img = image::open(&output).expect("open normalized").to_rgba8();
    let px = img.get_pixel(0, 0);
    assert_eq!(px[3], 255, "alpha should be fully opaque after flatten");
    assert!(
        px[0] > 127,
        "red channel blended with white should be > 127"
    );
    assert!(
        px[1] > 60,
        "green channel blended with white should be > 60"
    );
}

#[test]
fn vlm_normalize_svg_rasterizes_to_png() {
    let temp = TempDir::new();
    let input = temp.path("test.svg");
    let output = temp.path("normalized.png");
    fs::write(
        &input,
        r#"<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect fill="red" width="200" height="100"/></svg>"#,
    )
    .expect("write svg fixture");

    assert_success(run(&[
        "vlm-normalize",
        "--purpose",
        "tag",
        "--max-size",
        "768",
        input.to_str().expect("path utf-8"),
        output.to_str().expect("path utf-8"),
    ]));

    let img = image::open(&output).expect("open normalized");
    assert_eq!((img.width(), img.height()), (200, 100));
}

#[test]
fn visual_sample_outputs_16x16_rgba_hex() {
    let temp = TempDir::new();
    let input = temp.path("red.png");
    write_rgba_png(&input, 64, 64, Rgba([255, 0, 0, 255]));

    let stdout = assert_success(run(&["visual-sample", input.to_str().expect("path utf-8")]));
    let json: Value = serde_json::from_str(&stdout).expect("parse visual-sample json");

    assert_eq!(json["width"], 16);
    assert_eq!(json["height"], 16);
    let rgba = json["rgba"].as_str().expect("rgba should be string");
    assert_eq!(
        rgba.len(),
        16 * 16 * 4 * 2,
        "16x16 RGBA = 1024 bytes = 2048 hex chars"
    );
    let decoded: Vec<u8> = (0..rgba.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&rgba[i..i + 2], 16).expect("hex byte"))
        .collect();
    assert_eq!(decoded[0], 255, "R");
    assert_eq!(decoded[1], 0, "G");
    assert_eq!(decoded[2], 0, "B");
    assert_eq!(decoded[3], 255, "A");
}

#[test]
fn visual_sample_svg_works() {
    let temp = TempDir::new();
    let input = temp.path("icon.svg");
    fs::write(
        &input,
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect fill="#00ff00" width="100" height="100"/></svg>"##,
    )
    .expect("write svg fixture");

    let stdout = assert_success(run(&["visual-sample", input.to_str().expect("path utf-8")]));
    let json: Value = serde_json::from_str(&stdout).expect("parse json");

    assert_eq!(json["width"], 16);
    assert_eq!(json["height"], 16);
    let rgba = json["rgba"].as_str().expect("rgba");
    let decoded: Vec<u8> = (0..rgba.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&rgba[i..i + 2], 16).expect("hex byte"))
        .collect();
    assert_eq!(decoded[1], 255, "green SVG should have G=255");
}

fn write_svg_fixture(path: &Path, fill: &str, width: u32, height: u32) {
    fs::write(
        path,
        format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}"><rect fill="{fill}" width="{width}" height="{height}"/></svg>"#
        ),
    )
    .expect("write svg fixture");
}

#[test]
fn dhash_svg_produces_valid_hash() {
    let temp = TempDir::new();
    let input = temp.path("icon.svg");
    write_svg_fixture(&input, "blue", 200, 100);

    let stdout = assert_success(run(&["dhash", input.to_str().expect("path utf-8")]));
    let json: Value = serde_json::from_str(&stdout).expect("parse dhash json");

    let hash = json["dHash"].as_str().expect("dHash should be string");
    assert_eq!(hash.len(), 16, "dHash should be 16 hex chars");
    u64::from_str_radix(hash, 16).expect("dHash should be valid hex");

    let flipped = json["dHashFlipped"]
        .as_str()
        .expect("dHashFlipped should be string");
    assert_eq!(flipped.len(), 16);
}

#[test]
fn dhash_svg_matches_rasterized_png() {
    let temp = TempDir::new();
    let svg_path = temp.path("rect.svg");
    let png_path = temp.path("rect.png");
    write_svg_fixture(&svg_path, "red", 100, 100);

    assert_success(run(&[
        "svg-to-png",
        "--max-size",
        "512",
        svg_path.to_str().expect("path utf-8"),
        png_path.to_str().expect("path utf-8"),
    ]));

    let svg_out = assert_success(run(&["dhash", svg_path.to_str().expect("path utf-8")]));
    let png_out = assert_success(run(&["dhash", png_path.to_str().expect("path utf-8")]));
    let svg_json: Value = serde_json::from_str(&svg_out).expect("svg json");
    let png_json: Value = serde_json::from_str(&png_out).expect("png json");

    assert_eq!(
        svg_json["dHash"], png_json["dHash"],
        "SVG and its rasterized PNG should produce the same dHash"
    );
}

#[test]
fn visual_distance_svg_vs_svg_identical_is_zero() {
    let temp = TempDir::new();
    let a = temp.path("a.svg");
    let b = temp.path("b.svg");
    write_svg_fixture(&a, "green", 80, 80);
    write_svg_fixture(&b, "green", 80, 80);

    let stdout = assert_success(run(&[
        "visual-distance",
        a.to_str().expect("path utf-8"),
        b.to_str().expect("path utf-8"),
    ]));
    let json: Value = serde_json::from_str(&stdout).expect("parse json");

    assert_eq!(json["distance"], 0, "identical SVGs should have distance 0");
}

#[test]
fn visual_distance_svg_vs_png_works() {
    let temp = TempDir::new();
    let svg_path = temp.path("icon.svg");
    let png_path = temp.path("icon.png");
    write_svg_fixture(&svg_path, "#ff0000", 60, 60);
    write_rgba_png(&png_path, 60, 60, Rgba([255, 0, 0, 255]));

    let stdout = assert_success(run(&[
        "visual-distance",
        svg_path.to_str().expect("path utf-8"),
        png_path.to_str().expect("path utf-8"),
    ]));
    let json: Value = serde_json::from_str(&stdout).expect("parse json");

    let dist = json["distance"].as_i64().expect("distance should be int");
    assert!(
        dist < 5,
        "red SVG vs red PNG should have very low distance, got {dist}"
    );
}

#[test]
fn vlm_normalize_gif_uses_first_frame() {
    let temp = TempDir::new();
    let input = temp.path("animated.gif");
    let output = temp.path("normalized.png");
    write_animated_gif(&input);

    assert_success(run(&[
        "vlm-normalize",
        "--purpose",
        "tag",
        "--max-size",
        "768",
        input.to_str().expect("path utf-8"),
        output.to_str().expect("path utf-8"),
    ]));

    let img = image::open(&output).expect("open normalized").to_rgba8();
    let px = img.get_pixel(0, 0);
    assert!(
        px[0] > 200,
        "first frame should be red (R > 200), got R={}",
        px[0]
    );
}
