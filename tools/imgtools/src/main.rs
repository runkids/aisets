mod composite;
mod convert;
mod exif;
mod hash;
mod probe;
mod svg;
mod transform;
mod vlm_normalize;

use clap::{Parser, Subcommand};
use std::process;

#[derive(Parser)]
#[command(name = "aisets-imgtools", about = "Image processing CLI for Aisets")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Convert image format (WebP, AVIF, GIF, PNG, JPEG)
    Convert {
        /// Output format
        #[arg(long)]
        format: String,
        /// Quality (0-100)
        #[arg(long, default_value_t = 80)]
        quality: u8,
        /// AVIF encoder speed (1=slow/best, 10=fast/worst)
        #[arg(long, default_value_t = 6)]
        speed: u8,
        /// Resize to fit within this max dimension before converting
        #[arg(long)]
        resize: Option<u32>,
        /// Input file path
        input: String,
        /// Output file path
        output: String,
    },
    /// Resize image to fit within max dimension
    Resize {
        /// Maximum width or height in pixels
        #[arg(long)]
        max_dimension: u32,
        /// Input file path
        input: String,
        /// Output file path
        output: String,
    },
    /// Extract image metadata (format, dimensions, alpha, animation)
    Probe {
        /// Input file path
        input: String,
    },
    /// Compute perceptual hash (DHash) of an image
    Dhash {
        /// Input file path
        input: String,
    },
    /// Compute hamming distance between two hex hashes
    Distance {
        /// First hash (hex)
        #[arg(long)]
        hash1: String,
        /// Second hash (hex)
        #[arg(long)]
        hash2: String,
    },
    /// Compute 16×16 RGBA visual sample of an image (for near-duplicate pre-computation)
    VisualSample {
        /// Input file path
        input: String,
    },
    /// Compute pixel-level visual distance between two images
    VisualDistance {
        /// First image path
        input_a: String,
        /// Second image path
        input_b: String,
        /// Flip second image horizontally before comparison
        #[arg(long, default_value_t = false)]
        flip_b: bool,
    },
    /// Generate a thumbnail
    Thumbnail {
        /// Max dimension (default 256)
        #[arg(long, default_value_t = 256)]
        size: u32,
        /// Input file path
        input: String,
        /// Output file path
        output: String,
    },
    /// Rasterize SVG to PNG using resvg
    SvgToPng {
        /// Max dimension (default 512)
        #[arg(long, default_value_t = 512)]
        max_size: u32,
        /// Input SVG file path
        input: String,
        /// Output PNG file path
        output: String,
    },
    /// Normalize image for VLM input (resize, flatten alpha, convert to PNG)
    VlmNormalize {
        /// Purpose: "tag" (max 768) or "ocr" (max 1536)
        #[arg(long)]
        purpose: String,
        /// Max dimension in pixels
        #[arg(long, default_value_t = 768)]
        max_size: u32,
        /// Background color for alpha compositing
        #[arg(long, default_value = "white")]
        background: String,
        /// Input file path
        input: String,
        /// Output PNG file path
        output: String,
    },
    /// Composite multiple images onto a canvas (JSON spec via stdin)
    Composite {
        /// Output PNG file path (default: stdout)
        #[arg(long)]
        output: Option<String>,
    },
    /// Mirror and/or rotate an image
    Transform {
        /// Flip mode: none, horizontal, vertical, both
        #[arg(long, default_value = "none")]
        flip: String,
        /// Clockwise rotation degrees: 0, 90, 180, 270
        #[arg(long, default_value_t = 0)]
        rotate: i32,
        /// Input file path
        input: String,
        /// Output file path
        output: String,
    },
    /// Extract EXIF metadata (GPS, camera, date, orientation, DPI)
    Exif {
        /// Input file path
        input: String,
    },
    /// Print version
    Version,
}

fn main() {
    let cli = Cli::parse();
    let result = match cli.command {
        Command::Convert {
            format,
            quality,
            speed,
            resize,
            input,
            output,
        } => convert::run(&input, &output, &format, quality, speed, resize),
        Command::Resize {
            max_dimension,
            input,
            output,
        } => resize(&input, &output, max_dimension),
        Command::Probe { input } => probe::run(&input),
        Command::Dhash { input } => hash::run_dhash(&input),
        Command::Distance { hash1, hash2 } => hash::run_distance(&hash1, &hash2),
        Command::VisualSample { input } => hash::run_visual_sample(&input),
        Command::VisualDistance {
            input_a,
            input_b,
            flip_b,
        } => hash::run_visual_distance(&input_a, &input_b, flip_b),
        Command::Thumbnail {
            size,
            input,
            output,
        } => thumbnail(&input, &output, size),
        Command::SvgToPng {
            max_size,
            input,
            output,
        } => svg::svg_to_png(&input, &output, max_size),
        Command::VlmNormalize {
            purpose,
            max_size,
            background,
            input,
            output,
        } => vlm_normalize::run(&input, &output, &purpose, max_size, &background),
        Command::Composite { output } => composite::run(output.as_deref()),
        Command::Transform {
            flip,
            rotate,
            input,
            output,
        } => transform::run(&input, &output, &flip, rotate),
        Command::Exif { input } => exif::run(&input),
        Command::Version => {
            println!("aisets-imgtools {}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
    };
    if let Err(e) = result {
        eprintln!("error: {e:#}");
        process::exit(1);
    }
}

fn resize(input: &str, output: &str, max_dimension: u32) -> anyhow::Result<()> {
    let img = image::open(input)?;
    let (w, h) = (img.width(), img.height());
    if w <= max_dimension && h <= max_dimension {
        std::fs::copy(input, output)?;
        return Ok(());
    }
    let resized = img.resize(
        max_dimension,
        max_dimension,
        image::imageops::FilterType::Lanczos3,
    );
    resized.save(output)?;
    Ok(())
}

fn thumbnail(input: &str, output: &str, size: u32) -> anyhow::Result<()> {
    let img = image::open(input)?;
    let resized = img.resize(size, size, image::imageops::FilterType::CatmullRom);
    resized.save(output)?;
    Ok(())
}
