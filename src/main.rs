use axum::{
    body::Body,
    extract::{Request, State},
    http::StatusCode,
    response::IntoResponse,
    routing::post,
    Router,
};
use std::net::SocketAddr;
use std::sync::Arc;

mod dcr;
mod shd;
mod wasm_enclave;
mod envoy;
mod billing;

struct AppState {
    discovery: Arc<shd::DiscoveryEngine>,
    billing: Arc<billing::BillingEnclave>,
}

#[tokio::main]
async fn main() {
    let state = Arc::new(AppState {
        discovery: Arc::new(shd::DiscoveryEngine::new()),
        billing: Arc::new(billing::BillingEnclave::init().await),
    });

    let app = Router::new()
        .fallback(proxy_handler)
        .with_state(state);

    let port = std::env::var("PORT").unwrap_or_else(|_| "8080".to_string());
    let addr: SocketAddr = format!("127.0.0.1:{}", port).parse().unwrap();
    
    println!("🛡️ TokenAlign v1.0.4 [Final Build]");
    println!("🚀 Proxy Gateway active on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn proxy_handler(
    State(state): State<Arc<AppState>>,
    req: Request,
) -> Response {
    let (parts, body) = req.into_parts();
    let path = parts.uri.path().to_string();
    
    if !path.ends_with("/chat/completions") {
        return envoy::forward_raw(parts, body).await;
    }

    let body_bytes = match axum::body::to_bytes(body, 10 * 1024 * 1024).await {
        Ok(bytes) => bytes,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };

    let mut json_body: serde_json::Value = match serde_json::from_slice(&body_bytes) {
        Ok(val) => val,
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    
    let model = json_body["model"].as_str().unwrap_or("unknown").to_string();
    let geometry = state.discovery.get_geometry(&model).await;

    json_body = dcr::align_history(json_body, &geometry);
    json_body = wasm_enclave::execute(json_body, &geometry).await;

    let response = envoy::forward_json(parts, json_body).await;

    let billing_clone = state.billing.clone();
    tokio::spawn(async move {
        billing_clone.process_response(response).await;
    });

    StatusCode::OK.into_response()
}

use axum::response::Response;
