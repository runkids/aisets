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
            "asset-studio-imgtools-test-{}-{nanos}-{id}",
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
    Command::new(env!("CARGO_BIN_EXE_asset-studio-imgtools"))
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

    assert_eq!(stdout.trim(), "asset-studio-imgtools 0.1.0");
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
