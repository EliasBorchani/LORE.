use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const MAX_FAILURES: usize = 5;
const WINDOW: Duration = Duration::from_secs(15 * 60);
const MAX_TRACKED_LOGINS: usize = 10_000;

/// Failed logins per login name, in memory: after 5 failures in 15 minutes, that login is refused until the oldest
/// failure leaves the window. Per-address limits belong to the reverse proxy, which sees the real client address.
#[derive(Default)]
pub struct LoginLimiter {
    failures: Mutex<HashMap<String, VecDeque<Instant>>>,
}

impl LoginLimiter {
    /// `Err` holds how long to wait.
    pub fn check(&self, login: &str) -> Result<(), Duration> {
        let mut failures = self.failures.lock().unwrap();
        let Some(times) = failures.get_mut(&key(login)) else {
            return Ok(());
        };
        let now = Instant::now();
        prune(times, now);
        if times.len() < MAX_FAILURES {
            return Ok(());
        }
        Err(WINDOW.saturating_sub(now - times[0]))
    }

    pub fn failure(&self, login: &str) {
        let mut failures = self.failures.lock().unwrap();
        let now = Instant::now();
        if failures.len() >= MAX_TRACKED_LOGINS {
            failures.retain(|_, times| {
                prune(times, now);
                !times.is_empty()
            });
        }
        failures.entry(key(login)).or_default().push_back(now);
    }

    pub fn success(&self, login: &str) {
        self.failures.lock().unwrap().remove(&key(login));
    }
}

fn key(login: &str) -> String {
    login.trim().to_lowercase()
}

fn prune(times: &mut VecDeque<Instant>, now: Instant) {
    while times.front().is_some_and(|time| now - *time >= WINDOW) {
        times.pop_front();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_after_five_failures_and_success_resets() {
        let limiter = LoginLimiter::default();
        for _ in 0..MAX_FAILURES {
            assert!(limiter.check("Alice").is_ok());
            limiter.failure("alice");
        }
        assert!(limiter.check("ALICE").is_err());
        assert!(limiter.check("bob").is_ok());
        limiter.success("alice");
        assert!(limiter.check("alice").is_ok());
    }
}
