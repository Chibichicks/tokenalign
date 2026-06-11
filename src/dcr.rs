use serde_json::{json, Value};

/// Differential Context Re-ordering (DCR)
/// Ensures the 'Pivot Point' between history and new query hits a 128/1024 boundary.
pub fn align_history(mut body: Value, geometry: &crate::shd::Geometry) -> Value {
    if let Some(messages) = body["messages"].as_array_mut() {
        if messages.len() < 2 { return body; }

        let mut current_tokens = 0;
        let mut pivot_index = 0;

        // 1. Identify the 'Static Anchor' (System Prompt + Early History)
        for (i, msg) in messages.iter().enumerate() {
            let tokens = estimate_tokens(msg["content"].as_str().unwrap_or(""));
            current_tokens += tokens;
            
            // If we are approaching a boundary, this is our pivot
            if current_tokens % geometry.boundary < 20 {
                pivot_index = i;
            }
        }

        // 2. Structural Padding (Invisible to model, rigid for cache)
        if pivot_index > 0 {
            let remainder = current_tokens % geometry.boundary;
            if remainder != 0 {
                let padding_needed = geometry.boundary - remainder;
                
                // FIX: Use a comment block that is semantically null but structurally rigid
                let padding_marker = format!("\n/* CACHE_SYNC_ID: {} */", "0".repeat(padding_needed));
                
                if let Some(content) = messages[pivot_index]["content"].as_str() {
                    let new_content = format!("{}{}", content, padding_marker);
                    messages[pivot_index]["content"] = json!(new_content);
                }
            }
        }
    }
    body
}

fn estimate_tokens(text: &str) -> usize {
    // Placeholder: In production, this calls the WASM-based Tiktoken
    text.len() / 4
}
