use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
    pub work_minutes: u32, pub break_minutes: u32,
    pub auto_work: bool, pub auto_break: bool,
    pub sound: bool, pub volume: u32, pub motion: String, pub postpone: bool,
    pub theme: String, pub accent: String, pub widget_size: String, pub widget_scale: f64, pub message_choice: String, pub custom_message: String,
    pub startup: bool, pub remember_position: bool,
    pub tray: bool, pub widget: bool, pub show_clock_seconds: bool, pub window_mode: String,
    pub widget_messages: bool, pub idle_message: String, pub focus_message: String,
}
impl Default for Preferences {
    fn default() -> Self {
        Self { work_minutes: 30, break_minutes: 5, auto_work: false, auto_break: false,
            sound: true, volume: 35, motion: "full".into(), postpone: true, theme: "system".into(),
            accent: "sage".into(), widget_size: "medium".into(), widget_scale: 1.0, message_choice: "rotate".into(), custom_message: String::new(),
            startup: false, remember_position: true, tray: true, widget: true, show_clock_seconds: false, window_mode: "desktop".into(),
            widget_messages: true, idle_message: String::new(), focus_message: String::new() }
    }
}
impl Preferences {
    pub fn widget_dimensions(&self) -> (f64, f64) {
        let scale = match self.widget_size.as_str() { "mini" => 0.6, "small" => 0.85, "large" => 1.2, "custom" => self.widget_scale, _ => 1.0 };
        crate::resize::widget_dimensions(scale)
    }
    pub fn validate(&self) -> Result<(), String> {
        if self.idle_message.chars().count() > 160 || self.focus_message.chars().count() > 160 {
            return Err("Widget messages can contain up to 160 characters each.".into());
        }
        if !(1..=99).contains(&self.work_minutes) || !(1..=60).contains(&self.break_minutes) {
            return Err("Focus must be 1–99 minutes; break must be 1–60 minutes.".into());
        }
        if self.volume > 100 || !["full", "gentle", "none"].contains(&self.motion.as_str())
            || !["system", "dark", "light"].contains(&self.theme.as_str())
            || !["sage", "blue", "lavender", "peach", "rose", "teal"].contains(&self.accent.as_str())
            || !["mini", "small", "medium", "large", "custom"].contains(&self.widget_size.as_str())
            || !["desktop", "top"].contains(&self.window_mode.as_str())
            || !self.widget_scale.is_finite() || !(0.5..=1.6).contains(&self.widget_scale) {
            return Err("Invalid appearance or reminder preference.".into());
        }
        if !["rotate", "custom", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].contains(&self.message_choice.as_str())
            || self.custom_message.chars().count() > 180
            || (self.message_choice == "custom" && self.custom_message.trim().is_empty()) {
            return Err("Choose a break message, or enter your own message (up to 180 characters).".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub phase: String, pub running: bool, pub remaining: u32, pub total: u32,
    pub completed: u32, pub focus_seconds: u32, pub session_active: bool,
}
pub struct Timer {
    pub view: Snapshot,
    pub deadline: Option<u64>,
    pub complete_until: Option<u64>,
}
impl Timer {
    pub fn new(p: &Preferences) -> Self {
        Self { view: Snapshot { phase: "focus".into(), running: false, remaining: p.work_minutes * 60,
            total: p.work_minutes * 60, completed: 0, focus_seconds: 0, session_active: false }, deadline: None, complete_until: None }
    }
    fn phase(&mut self, name: &str, seconds: u32) {
        self.view.phase = name.into(); self.view.remaining = seconds; self.view.total = seconds;
        self.view.running = false; self.deadline = None; self.complete_until = None;
    }
    fn reset(&mut self, p: &Preferences) {
        self.phase("focus", p.work_minutes * 60); self.view.focus_seconds = 0; self.view.session_active = false;
    }
    fn start(&mut self, p: &Preferences, now: u64) {
        if self.view.phase == "reminder" { self.phase("break", p.break_minutes * 60); }
        if self.view.phase == "complete" { self.reset(p); }
        self.view.session_active = true;
        if !self.view.running { self.view.running = true; self.deadline = Some(now + self.view.remaining as u64 * 1000); }
    }
    fn remind(&mut self, p: &Preferences, now: u64) {
        if ["focus", "finishing"].contains(&self.view.phase.as_str()) {
            self.view.focus_seconds += self.view.total - self.view.remaining;
            if self.view.phase == "focus" && self.view.total > self.view.remaining { self.view.completed += 1; }
        }
        self.phase("reminder", p.break_minutes * 60);
        if p.auto_break { self.start(p, now); }
    }
    pub fn tick(&mut self, p: &Preferences, now: u64) {
        if self.view.phase == "complete" && self.complete_until.is_some_and(|end| now >= end) {
            self.reset(p); if p.auto_work { self.start(p, now); } return;
        }
        if let Some(deadline) = self.deadline {
            self.view.remaining = deadline.saturating_sub(now).div_ceil(1000) as u32;
            if self.view.remaining == 0 {
                if self.view.phase == "break" { self.phase("complete", 0); self.complete_until = Some(now + 2800); }
                else { self.remind(p, now); }
            }
        }
    }
    pub fn update_preferences(&mut self, old: &Preferences, next: &Preferences, now: u64) -> Snapshot {
        self.tick(old, now);
        let focus_changed = self.view.phase == "focus" && old.work_minutes != next.work_minutes;
        let break_changed = ["break", "reminder"].contains(&self.view.phase.as_str()) && old.break_minutes != next.break_minutes;
        if focus_changed || break_changed {
            if focus_changed { self.view.focus_seconds += self.view.total.saturating_sub(self.view.remaining); }
            let seconds = if focus_changed { next.work_minutes } else { next.break_minutes } * 60;
            self.view.remaining = seconds; self.view.total = seconds;
            if self.view.running { self.deadline = Some(now + seconds as u64 * 1000); }
        }
        self.view.clone()
    }
    pub fn action(&mut self, action: &str, p: &Preferences, now: u64) -> Result<Snapshot, String> {
        self.tick(p, now);
        match action {
            "start" => self.start(p, now),
            "pause" => { self.view.running = false; self.deadline = None; },
            "restart" | "end" => self.reset(p),
            "break" => self.remind(p, now),
            "postpone" if p.postpone && self.view.phase == "reminder" => { self.phase("finishing", 300); self.start(p, now); },
            "postpone" => {},
            "add" if ["focus", "finishing", "break"].contains(&self.view.phase.as_str()) => {
                self.view.session_active = true;
                let added = 300.min(5999_u32.saturating_sub(self.view.remaining));
                self.view.remaining += added; self.view.total += added;
                if let Some(deadline) = self.deadline { self.deadline = Some(deadline + added as u64 * 1000); }
            },
            "add" => {},
            "next" | "skip" => { self.reset(p); if p.auto_work { self.start(p, now); } },
            _ => return Err("Unknown timer action.".into()),
        }
        Ok(self.view.clone())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn saved_durations_update_current_countdown_without_resetting_run_state() {
        let mut p = Preferences::default(); let mut t = Timer::new(&p);
        let mut next = p.clone(); next.work_minutes = 20;
        t.update_preferences(&p, &next, 0); p = next;
        assert_eq!(t.view.remaining, 1200); assert!(!t.view.session_active);
        t.action("start", &p, 0).unwrap();
        next = p.clone(); next.work_minutes = 10;
        t.update_preferences(&p, &next, 60_000); p = next;
        assert_eq!(t.view.remaining, 600); assert!(t.view.running); assert_eq!(t.view.focus_seconds, 60);
        assert_eq!(t.view.completed, 0); t.tick(&p, 61_000); assert_eq!(t.view.remaining, 599);
        next = p.clone(); next.accent = "blue".into(); next.break_minutes = 8;
        t.update_preferences(&p, &next, 61_000); p = next;
        assert_eq!(t.view.remaining, 599);
        t.action("pause", &p, 61_000).unwrap(); next = p.clone(); next.work_minutes = 25;
        t.update_preferences(&p, &next, 70_000); p = next;
        assert_eq!(t.view.remaining, 1500); assert!(!t.view.running); assert!(t.view.session_active);
        t.tick(&p, 90_000); assert_eq!(t.view.remaining, 1500);
    }
    #[test] fn break_duration_changes_apply_to_reminder_and_break_but_not_postponement() {
        let mut p = Preferences::default(); let mut t = Timer::new(&p);
        t.action("break", &p, 0).unwrap(); let mut next = p.clone(); next.break_minutes = 7;
        t.update_preferences(&p, &next, 0); p = next;
        assert_eq!(t.view.remaining, 420); assert_eq!(t.view.phase, "reminder"); assert!(!t.view.running);
        t.action("postpone", &p, 0).unwrap(); next = p.clone(); next.break_minutes = 10; next.work_minutes = 20;
        t.update_preferences(&p, &next, 1000); p = next;
        assert_eq!(t.view.remaining, 299); assert_eq!(t.view.phase, "finishing");
        t.tick(&p, 300_000); t.action("start", &p, 300_000).unwrap(); next = p.clone(); next.break_minutes = 6;
        t.update_preferences(&p, &next, 310_000); p = next;
        assert_eq!(t.view.remaining, 360); assert!(t.view.running);
        t.tick(&p, 311_000); assert_eq!(t.view.remaining, 359);
        t.action("pause", &p, 311_000).unwrap(); next = p.clone(); next.break_minutes = 8;
        t.update_preferences(&p, &next, 312_000);
        assert_eq!(t.view.remaining, 480); assert!(!t.view.running);
    }
    #[test] fn widget_messages_keep_legacy_defaults_and_validate_unicode_length() {
        let mut p: Preferences = serde_json::from_str("{}").unwrap();
        assert!(p.widget_messages);
        assert!(p.idle_message.is_empty() && p.focus_message.is_empty());
        p.idle_message = "Pause and stretch.".into(); p.focus_message = "Focus on one thing.".into();
        let restored: Preferences = serde_json::from_str(&serde_json::to_string(&p).unwrap()).unwrap();
        assert_eq!(restored.focus_message, p.focus_message);
        p.focus_message = "🌿".repeat(160); assert!(p.validate().is_ok());
        p.focus_message.push('x'); assert!(p.validate().is_err());
    }
    #[test] fn idle_clock_and_active_timer_survive_immediate_pause_and_reset() {
        let mut p = Preferences::default(); p.show_clock_seconds = true;
        let restored: Preferences = serde_json::from_str(&serde_json::to_string(&p).unwrap()).unwrap();
        assert!(restored.show_clock_seconds);
        let mut timer = Timer::new(&p); assert!(!timer.view.session_active);
        timer.action("start", &p, 0).unwrap(); timer.action("pause", &p, 0).unwrap();
        assert!(timer.view.session_active); assert_eq!(timer.view.remaining, timer.view.total);
        timer.action("end", &p, 0).unwrap(); assert!(!timer.view.session_active);
        timer.action("add", &p, 0).unwrap(); assert!(timer.view.session_active);
        timer.action("restart", &p, 0).unwrap(); assert!(!timer.view.session_active);
    }
    #[test] fn pause_and_resume_preserve_time() {
        let p = Preferences::default(); let mut t = Timer::new(&p);
        t.action("start", &p, 0).unwrap(); t.action("pause", &p, 10_500).unwrap();
        assert_eq!(t.view.remaining, 1790);
        t.action("start", &p, 99_000).unwrap(); t.tick(&p, 100_000); assert_eq!(t.view.remaining, 1789);
    }
    #[test] fn sleep_cannot_skip_unstarted_break() {
        let p = Preferences::default(); let mut t = Timer::new(&p);
        t.action("start", &p, 0).unwrap(); t.tick(&p, 9_000_000);
        assert_eq!(t.view.phase, "reminder"); assert_eq!(t.view.remaining, 300); assert!(!t.view.running);
    }
    #[test] fn postponement_returns_to_reminder() {
        let p = Preferences::default(); let mut t = Timer::new(&p);
        t.action("break", &p, 0).unwrap(); t.action("postpone", &p, 0).unwrap();
        assert_eq!(t.view.phase, "finishing"); t.tick(&p, 300_000); assert_eq!(t.view.phase, "reminder");
    }
    #[test] fn completed_break_returns_to_idle_focus() {
        let p = Preferences::default(); let mut t = Timer::new(&p);
        t.action("break", &p, 0).unwrap(); t.action("start", &p, 0).unwrap(); t.tick(&p, 300_000);
        assert_eq!(t.view.phase, "complete"); t.tick(&p, 303_000); assert_eq!(t.view.phase, "focus"); assert!(!t.view.running);
    }
    #[test] fn invalid_settings_rejected() {
        let mut p = Preferences::default(); p.work_minutes = 0; assert!(p.validate().is_err());
    }
    #[test] fn message_preferences_validate_and_round_trip() {
        let mut p = Preferences::default(); p.message_choice = "custom".into();
        assert!(p.validate().is_err()); p.custom_message = "Pause and breathe.".into(); p.accent = "blue".into();
        assert!(p.validate().is_ok());
        let restored: Preferences = serde_json::from_str(&serde_json::to_string(&p).unwrap()).unwrap();
        assert_eq!(restored.custom_message, "Pause and breathe."); assert_eq!(restored.accent, "blue");
        p.message_choice = "10".into(); assert!(p.validate().is_err());
    }
    #[test] fn old_preferences_get_new_defaults() {
        let p: Preferences = serde_json::from_str(r#"{"workMinutes":25}"#).unwrap();
        assert_eq!(p.accent, "sage"); assert_eq!(p.message_choice, "rotate");
        assert_eq!(p.widget_size, "medium");
    }
    #[test] fn widget_size_dimensions_and_preferences() {
        let mut p = Preferences::default();
        for (size, scale) in [("small", 0.85), ("medium", 1.0), ("large", 1.2)] {
            p.widget_size = size.into(); assert!(p.validate().is_ok());
            let (width, height) = p.widget_dimensions();
            assert!((width - 432.0 * scale).abs() < 0.001);
            assert!((height - crate::resize::widget_dimensions(scale).1).abs() < 0.001);
            let restored: Preferences = serde_json::from_str(&serde_json::to_string(&p).unwrap()).unwrap();
            assert_eq!(restored.widget_size, size);
        }
        p.widget_size = "huge".into(); assert!(p.validate().is_err());
    }
}
