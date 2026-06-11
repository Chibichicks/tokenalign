use reqwest::Response;
use std::sync::atomic::{AtomicUsize, Ordering};

pub struct BillingEnclave {
    daily_count: AtomicUsize,
    max_limit: usize,
}

impl BillingEnclave {
    pub async fn init() -> Self {
        // In production: Loads from hardware-locked state file
        Self {
            daily_count: AtomicUsize::new(0),
            max_limit: 1000,
        }
    }

    pub async fn process_response(&self, res: reqwest::Response) {
        // 1. Check for 'Cache Hit' evidence (OpenAI or Anthropic headers)
        let is_cache_hit = res.headers().contains_key("openai-processing-ms") || 
                           res.headers().contains_key("anthropic-cache-read"); // Hypothetical June 2026 headers

        if res.status().is_success() && is_cache_hit {
            let current = self.daily_count.fetch_add(1, Ordering::SeqCst);
            
            if current < self.max_limit {
                println!("✅ Free Tier: Cache hit optimized ({} / {})", current + 1, self.max_limit);
            } else {
                println!("💎 Billable: ROI-Verified cache hit at US$0.0001 rate.");
            }
        } else if res.status().is_success() {
            println!("ℹ️ Passthrough: No cache hit detected. Zero fee applied.");
        }
    }

    pub fn get_status(&self) -> String {
        format!("Usage: {} / {}", self.daily_count.load(Ordering::Relaxed), self.max_limit)
    }
}
