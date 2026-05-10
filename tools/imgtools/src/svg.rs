use anyhow::{Context, Result};

pub fn svg_to_png(input: &str, output: &str, max_size: u32) -> Result<()> {
    let svg_data = std::fs::read(input).with_context(|| format!("failed to read SVG: {input}"))?;

    let opt = resvg::usvg::Options::default();
    let tree =
        resvg::usvg::Tree::from_data(&svg_data, &opt).with_context(|| "failed to parse SVG")?;

    let orig = tree.size().to_int_size();
    let (w, h) = fit_size(orig.width(), orig.height(), max_size);

    let mut pixmap = tiny_skia::Pixmap::new(w, h)
        .ok_or_else(|| anyhow::anyhow!("failed to create {w}x{h} pixmap"))?;

    let sx = w as f32 / orig.width() as f32;
    let sy = h as f32 / orig.height() as f32;
    resvg::render(
        &tree,
        tiny_skia::Transform::from_scale(sx, sy),
        &mut pixmap.as_mut(),
    );

    pixmap
        .save_png(output)
        .with_context(|| format!("failed to write PNG: {output}"))?;

    Ok(())
}

fn fit_size(width: u32, height: u32, max_size: u32) -> (u32, u32) {
    if width == 0 || height == 0 {
        return (max_size, max_size);
    }
    let scale = (max_size as f64 / width as f64)
        .min(max_size as f64 / height as f64)
        .min(1.0);
    let w = (width as f64 * scale).round().max(1.0) as u32;
    let h = (height as f64 * scale).round().max(1.0) as u32;
    (w, h)
}
