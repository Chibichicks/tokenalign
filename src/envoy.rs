use serde_json::Value;
use axum::body::Body;
use axum::http::{header, StatusCode};
use axum::response::Response;
use futures_util::StreamExt;
use http_body_util::BodyExt;

pub async fn forward_json(_parts: http::request::Parts, body: Value) -> reqwest::Response {
    let client = reqwest::Client::new();
    let api_key = std::env::var("LLM_API_KEY").or_else(|_| std::env::var("OPENAI_API_KEY")).expect("API Key must be set");

    let target_url = if body["model"].as_str().unwrap_or("").contains("claude") {
        "https://api.anthropic.com/v1/messages"
    } else {
        "https://api.openai.com/v1/chat/completions"
    };

    client.post(target_url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .unwrap()
}

pub async fn forward_raw(_parts: http::request::Parts, body: Body) -> Response {
    let api_key = std::env::var("LLM_API_KEY").or_else(|_| std::env::var("OPENAI_API_KEY")).unwrap();
    let client = reqwest::Client::new();
    
    // Convert Axum body to Reqwest body
    let stream = body.into_data_stream();
    let req_body = reqwest::Body::wrap_stream(stream);

    let res = client.post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .body(req_body)
        .send()
        .await
        .unwrap();

    convert_response(res).await
}

async fn convert_response(res: reqwest::Response) -> Response {
    let status = StatusCode::from_u16(res.status().as_u16()).unwrap();
    let headers = res.headers().clone();
    
    let stream = res.bytes_stream().map(|result| result.map_err(|e| e.to_string()));
    let body = Body::from_stream(stream);
    
    let mut response = Response::new(body);
    *response.status_mut() = status;
    for (name, value) in headers {
        if let Some(name) = name {
            if name != header::TRANSFER_ENCODING {
                response.headers_mut().insert(name, value);
            }
        }
    }
    response
}
