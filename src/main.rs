use axum::{
    body::Body,
    extract::{Request, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
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

    let addr = SocketAddr::from(([127, 0, 0, 1], 8080));
    println!("🛡️ TokenAlign v37 [Production Candidate]");
    println!("🚀 Token-Saving Gateway active on http://{}", addr);
    println!("💎 Strategy: Atomic Alignment + Structural Cache Sync");
    axum_server::bind(addr)
        .serve(app.into_make_service())
        .await
        .unwrap();
}

async fn proxy_handler(
    State(state): State<Arc<AppState>>,
    req: Request<Body>,
) -> impl IntoResponse {
    // 1. Extract Target and Model
    let (parts, body) = req.into_parts();
    let path = parts.uri.path().to_string();
    
    // 2. Only optimize Chat Completions
    if !path.ends_with("/chat/completions") {
        return envoy::forward_raw(parts, body).await;
    }

    // 3. Transform Request (The Magic)
    let body_bytes = axum::body::to_bytes(body, usize::MAX).await.unwrap();
    let mut json_body: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();
    
    let model = json_body["model"].as_str().unwrap_or("unknown").to_string();
    let geometry = state.discovery.get_geometry(&model).await;

    // Apply DCR (Differential Context Re-ordering)
    json_body = dcr::align_history(json_body, &geometry);

    // Apply WASM Enclave Strategy (Hidden Logic)
    json_body = wasm_enclave::execute(json_body, &geometry).await;

    // 4. Forward to Provider
    let response = envoy::forward_json(parts, json_body).await;

    // 5. Billing & Attestation (Async)
    let billing_clone = state.billing.clone();
    tokio::spawn(async move {
        billing_clone.process_response(response).await;
    });

    StatusCode::OK.into_response() // Simplified for now
}
