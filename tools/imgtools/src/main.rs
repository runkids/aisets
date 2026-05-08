mod convert;

use clap::{Parser, Subcommand};
use std::process;

#[derive(Parser)]
#[command(
    name = "asset-studio-imgtools",
    about = "Image processing CLI for Asset Studio"
)]
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
    /// Print version
    Version,
}

fn main() {
    let cli = Cli::parse();
    let result = match cli.command {
        Command::Convert {
            format,
            quality,
            input,
            output,
        } => convert::run(&input, &output, &format, quality),
        Command::Resize {
            max_dimension,
            input,
            output,
        } => resize(&input, &output, max_dimension),
        Command::Version => {
            println!("asset-studio-imgtools {}", env!("CARGO_PKG_VERSION"));
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
