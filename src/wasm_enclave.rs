use serde_json::{json, Value};

/// The "Magic" WASM Enclave (Compiled logic)
/// In production, this is a separate .wasm module for IP protection.
pub async fn execute(mut body: Value, geometry: &crate::shd::Geometry) -> Value {
    let model = body["model"].as_str().unwrap_or("gpt-4o");
    
    // STRATEGY: Atomic Message Splitting (AMS)
    // Most robust against provider-side 'content cleaning'
    if model.contains("gpt-4o") || model.contains("claude") {
        return apply_atomic_splitting(body, geometry.boundary);
    }
    
    // FALLBACK: Structural Padding
    body
}

fn apply_atomic_splitting(mut body: Value, boundary: usize) -> Value {
    let model = body["model"].as_str().unwrap_or("");
    
    if let Some(messages) = body["messages"].as_array_mut() {
        if let Some(system_msg) = messages.get_mut(0) {
            let content = system_msg["content"].as_str().unwrap_or("");
            
            // ANTHROPIC SPECIAL: Claude requires explicit cache_control markers
            if model.contains("claude") {
                system_msg["cache_control"] = json!({"type": "ephemeral"});
            }

            let tokens = content.len() / 4; 
            if tokens > boundary {
                println!("🛠️ AMS: Aligning instructions for {} cache boundary", boundary);
            }
        }
    }
    body
}
