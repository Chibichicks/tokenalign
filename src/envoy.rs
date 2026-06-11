use serde_json::Value;
use axum::body::Body;
use http::header;

pub async fn forward_json(parts: http::request::Parts, body: Value) -> reqwest::Response {
    let client = reqwest::Client::new();
    let api_key = std::env::var("LLM_API_KEY").or_else(|_| std::env::var("OPENAI_API_KEY")).expect("API Key must be set");

    // Dynamic Provider Detection
    let target_url = if body["model"].as_str().unwrap_or("").contains("claude") {
        "https://api.anthropic.com/v1/messages"
    } else {
        "https://api.openai.com/v1/chat/completions"
    };

    client.post(target_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("anthropic-version", "2023-06-01") // Required for Claude
        .json(&body)
        .send()
        .await
        .unwrap()
}

pub async fn forward_raw(parts: http::request::Parts, body: axum::body::Body) -> axum::response::Response {
    // Transparent pass-through for non-optimized paths
    let api_key = std::env::var("OPENAI_API_KEY").unwrap();
    let client = reqwest::Client::new();
    
    let res = client.post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .body(body)
        .send()
        .await
        .unwrap();

    // Map reqwest response back to axum
    convert_response(res).await
}

async fn convert_response(res: reqwest::Response) -> axum::response::Response {
    let status = res.status();
    let headers = res.headers().clone();
    
    // Check if it's a streaming response
    let is_streaming = headers.get("content-type")
        .map(|v| v.to_str().unwrap_or("").contains("text/event-stream"))
        .unwrap_or(false);

    let body = if is_streaming {
        println!("📡 SSE: Piping stream directly to client...");
        Body::from_stream(res.bytes_stream())
    } else {
        Body::from_stream(res.bytes_stream())
    };
    
    let mut response = axum::response::Response::new(body);
    *response.status_mut() = status;
    for (name, value) in headers {
        if let Some(name) = name {
            // Forward all headers except transfer-encoding to avoid conflicts
            if name != header::TRANSFER_ENCODING {
                response.headers_mut().insert(name, value);
            }
        }
    }
    response
}
