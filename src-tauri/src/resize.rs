use serde::Deserialize;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Corner { Nw, Ne, Sw, Se }

pub fn widget_dimensions(scale: f64) -> (f64, f64) {
    let width = 432.0 * scale;
    let height = if width < 300.0 { 154.0 } else if width < 400.0 { 286.0 } else { 416.0 * scale };
    (width, height)
}

#[derive(Clone, Copy)]
pub struct ResizeFrame {
    pub x: i32, pub y: i32, pub width: u32, pub height: u32,
    pub dpi: f64, pub corner: Corner, pub scale: f64, pub initial_scale: f64,
}
impl ResizeFrame {
    pub fn geometry(&self, scale: f64) -> (i32, i32, u32, u32) {
        let (widget_width, widget_height) = widget_dimensions(scale);
        let width = ((widget_width + 24.0) * self.dpi).round() as u32;
        let height = ((widget_height + 24.0) * self.dpi).round() as u32;
        let x = if matches!(self.corner, Corner::Nw | Corner::Sw) { self.x + self.width as i32 - width as i32 } else { self.x };
        let y = if matches!(self.corner, Corner::Nw | Corner::Ne) { self.y + self.height as i32 - height as i32 } else { self.y };
        (x, y, width, height)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_corner_keeps_its_opposite_corner_fixed_at_each_dpi() {
        for dpi in [1.0, 1.25, 1.5, 2.0] {
            for corner in [Corner::Nw, Corner::Ne, Corner::Sw, Corner::Se] {
                let frame = ResizeFrame { x: -720, y: 48, width: (456.0 * dpi) as u32, height: (440.0 * dpi) as u32, dpi, corner, scale: 1.0, initial_scale: 1.0 };
                for scale in [0.7, 0.85, 1.0, 1.33, 1.6] {
                    let (x, y, width, height) = frame.geometry(scale);
                    if matches!(corner, Corner::Nw | Corner::Sw) { assert_eq!(x + width as i32, frame.x + frame.width as i32); } else { assert_eq!(x, frame.x); }
                    if matches!(corner, Corner::Nw | Corner::Ne) { assert_eq!(y + height as i32, frame.y + frame.height as i32); } else { assert_eq!(y, frame.y); }
                    assert!((width as f64 - (432.0 * scale + 24.0) * dpi).abs() <= 0.5);
                    assert!((height as f64 - (widget_dimensions(scale).1 + 24.0) * dpi).abs() <= 0.5);
                }
            }
        }
    }
    #[test]
    fn custom_scale_persists_and_legacy_settings_keep_default() {
        let mut preferences = crate::timer::Preferences::default();
        preferences.widget_size = "custom".into(); preferences.widget_scale = 1.33;
        let restored: crate::timer::Preferences = serde_json::from_str(&serde_json::to_string(&preferences).unwrap()).unwrap();
        assert!(restored.validate().is_ok());
        assert_eq!(restored.widget_dimensions(), (432.0 * 1.33, 416.0 * 1.33));
        let legacy: crate::timer::Preferences = serde_json::from_str("{\"widgetSize\":\"small\"}").unwrap();
        assert_eq!(legacy.widget_scale, 1.0); assert!(legacy.validate().is_ok());
        for scale in [0.0, 0.49, 1.61, f64::INFINITY, f64::NAN] {
            preferences.widget_scale = scale; assert!(preferences.validate().is_err());
        }
    }
}
